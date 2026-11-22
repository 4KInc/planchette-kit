import { describe, expect, it } from "vitest";
import {
  openTrial,
  runTrial,
  runWarmup,
  warmupCapMs,
  WARNING_CENTRE_STEP_CAP,
  type TrialConfig,
} from "../src/run-trial.js";
import type { Layout, RawEvent, ResolvedUser } from "../src/types.js";

const layout: Layout = {
  screen: { width: 1200, height: 900 },
  targets: [
    { id: "rest", rect: { x: 900, y: 700, width: 250, height: 150 }, autoRepeat: false, role: "rest-area" },
    { id: "a", rect: { x: 100, y: 100, width: 150, height: 150 }, autoRepeat: false, role: "default" },
  ],
};

const user: ResolvedUser = {
  name: "test",
  key: 7,
  params: {
    throughputBitsPerS: 2,
    tremorFrequencyHz: 5,
    tremorPeakToPeakDeg: 0.4,
    tremorAxis: "yaw",
    tremorDriftFraction: 0.2,
    headRangeDeg: { left: 20, right: 25, up: 15, down: 18 },
    reactionTimeMs: 300,
    readingPauseChancePct: 0,
    readingPauseLengthMs: { min: 100, max: 200 },
    trackingNoiseDeg: 0.05,
    scatterCapDeg: 1,
    scanReactionTimeMs: 300,
    scanLatePressChancePct: 0,
    scanPressDurationMs: 100,
  },
};

const cfg = (over: Partial<TrialConfig> = {}): TrialConfig => ({
  layout,
  profile: {},
  user,
  mode: "head + dwell",
  task: ["a"],
  fps: 30,
  analysisWindowMs: 10000,
  requestSeed: 1,
  trialIndex: 0,
  ...over,
});

describe("trial warm-up", () => {
  it("ends at the first centre/done event, on the frame that produced it", () => {
    const d = openTrial(cfg());
    const doneAt: number[] = [];
    d.pl.addEventListener("calibration-step", (e) => {
      if (e.detail.run === "centre" && e.detail.step === "done") doneAt.push(d.sample.now);
    });
    runWarmup(d);
    expect(d.centreDone).toBe(true);
    expect(doneAt).toHaveLength(1);
    expect(d.tDone).toBe(doneAt[0]);
    expect(d.tDone).toBe((d.k - 1) * d.frameMs);
    // Still for calibrationStillnessTime (1500 ms) at least.
    expect(d.tDone).toBeGreaterThanOrEqual(d.eff.calibrationStillnessTime);
    expect(d.warnings).toEqual([]);
    d.pl.destroy();
  });

  it("does not add the warm-up to the result and echoes the effective profile", () => {
    const r = runTrial(cfg());
    // The warm-up is in no entry: one entry for the one task id (the entry loop is tested in run-trial-entries).
    expect(r.entries).toHaveLength(1);
    expect(r.warnings).toEqual([]);
    expect(r.userName).toBe("test");
    expect(r.effectiveProfile.mode).toBe("head + dwell");
  });

  it("shares no instance or state between two trials, and repeats exactly", () => {
    const a = openTrial(cfg());
    const b = openTrial(cfg());
    expect(a.pl).not.toBe(b.pl);
    expect(a.queue).not.toBe(b.queue);
    expect(a.sample).not.toBe(b.sample);
    expect(a.head).not.toBe(b.head);
    runWarmup(a);
    expect(b.k).toBe(0);
    expect(b.centreDone).toBe(false);
    expect(b.queue.length).toBe(0);
    a.pl.destroy();
    b.pl.destroy();
    expect(runTrial(cfg())).toEqual(runTrial(cfg()));
  });

  it("lets caller-set calibration ranges win over the user's head range, per field", () => {
    const r = runTrial(cfg({ profile: { calibrationRangeLeft: 40, calibrationRangeUp: 5 } }));
    expect(r.effectiveProfile.calibrationRangeLeft).toBe(40);
    expect(r.effectiveProfile.calibrationRangeUp).toBe(5);
    expect(r.effectiveProfile.calibrationRangeRight).toBe(25);
    expect(r.effectiveProfile.calibrationRangeDown).toBe(18);
  });

  it("echoes the profile as the skeleton clamped it", () => {
    const r = runTrial(cfg({ profile: { calibrationRangeLeft: 500, calibrationRangeDown: 0.1 } }));
    expect(r.effectiveProfile.calibrationRangeLeft).toBe(90);
    expect(r.effectiveProfile.calibrationRangeDown).toBe(3);
  });

  it("registers the layout targets with their options", () => {
    const d = openTrial(cfg());
    const info = d.pl.getTargets().map((t) => ({ id: t.id, autoRepeat: t.autoRepeat, role: t.role }));
    expect(info).toEqual([
      { id: "rest", autoRepeat: false, role: "rest-area" },
      { id: "a", autoRepeat: false, role: "default" },
    ]);
    d.pl.destroy();
  });

  it("queues warm-up events and tells the observer", () => {
    // A target under the screen centre selects by dwell while the user waits for the step.
    const centred: Layout = {
      screen: layout.screen,
      targets: [
        { id: "mid", rect: { x: 0, y: 0, width: 1200, height: 900 }, autoRepeat: true, role: "default" },
      ],
    };
    const seen: RawEvent[] = [];
    const d = openTrial(
      cfg({
        layout: centred,
        task: ["mid"],
        observers: { onEvent: (e) => seen.push({ ...e }) },
      }),
    );
    runWarmup(d);
    expect(d.queue.length).toBe(seen.length);
    for (let i = 0; i < seen.length; i++) {
      expect(d.queue.slots[i].now).toBe(seen[i].now);
      expect(d.queue.slots[i].kind).toBe(seen[i].kind);
    }
    d.pl.destroy();
  });

  it("stops at the cap and warns when the centre step never finishes", () => {
    const d = openTrial(cfg());
    // The engine always finishes the step by its timeout, so the cap is a safety net. Make
    // the engine ignore every sample to reach it.
    d.pl.feedSamples = () => undefined;
    runWarmup(d);
    const cap = warmupCapMs(d.eff);
    expect(cap).toBe(d.eff.calibrationStepTimeout + 1000);
    expect(d.centreDone).toBe(false);
    expect(d.tDone).toBe(cap);
    expect(d.warnings).toEqual([WARNING_CENTRE_STEP_CAP]);
    expect((d.k - 1) * d.frameMs).toBeLessThanOrEqual(cap);
    expect(d.k * d.frameMs).toBeGreaterThan(cap);
    d.pl.destroy();
  });
});
