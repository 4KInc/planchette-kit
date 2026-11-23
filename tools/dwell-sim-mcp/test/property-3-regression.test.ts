/**
 * Regression for the Property 3 counterexample found at fast-check seed -1448156187.
 *
 * The user's tremor is 5 degrees peak to peak at 3.5e-252 Hz, so during the warm-up it is a constant
 * tilt and the centre the engine captures is not (0, 0). The old simulator planned and built the
 * reachable rectangle with a zero centre, so t0 (162, 400) looked unreachable in the plan and the
 * head, shifted by the real tremor, selected it. With the geometry built from the captured centre
 * (design section 4.1, D2) the entry is a miss and the skeleton emits no select or cancel for t0.
 *
 * The values are the shrunk counterexample that fast-check printed for that seed (user key
 * 2820911237, throughput 1.3386..., reaction time 239.36 ms, the other fields as listed). On the
 * zero-centre code the entry for t0 ends with a select.
 *
 * **Validates: Requirements 11.1, 11.2, 11.11, 11.12**
 */
import { describe, expect, it } from "vitest";
import { openTrial, runTrial, runWarmup, type TrialConfig } from "../src/run-trial.js";
import type { Layout, RawEvent, ResolvedUser } from "../src/types.js";
const layout: Layout = {
  screen: { width: 640, height: 480 },
  targets: [
    { id: "t0", rect: { x: 162, y: 400, width: 40, height: 40 }, autoRepeat: false, role: "default" },
    { id: "rest", rect: { x: 2, y: 2, width: 40, height: 40 }, autoRepeat: false, role: "rest-area" },
  ],
};
const user: ResolvedUser = {
  name: "custom-0",
  key: 2820911237,
  params: {
    throughputBitsPerS: 1.3386216886321551,
    tremorFrequencyHz: 3.498410631170331e-252,
    tremorPeakToPeakDeg: 5,
    tremorAxis: "pitch",
    tremorDriftFraction: 0.2,
    headRangeDeg: { left: 3.8702686676013425, right: 3, up: 7.3638959466089196, down: 3 },
    reactionTimeMs: 239.3569247482464,
    readingPauseChancePct: 4.1203202332378216e-209,
    readingPauseLengthMs: { min: 0, max: 1.1131344302117209e-48 },
    trackingNoiseDeg: 0,
    scatterCapDeg: 0.6,
    scanReactionTimeMs: 500,
    scanLatePressChancePct: 10,
    scanPressDurationMs: 150,
  },
};
const cfg: TrialConfig = {
  layout,
  profile: {
    headGain: 1,
    headDeadZone: 0,
    dwellTime: 400,
    graceTime: 0,
    postSelectionPause: 200,
    calibrationRangeLeft: 5.805403001402014,
    calibrationRangeRight: 4.5,
    calibrationRangeUp: 11.045843919913379,
    calibrationRangeDown: 4.5,
  },
  user,
  mode: "head + dwell",
  task: ["t0"],
  fps: 60,
  analysisWindowMs: 2500,
  requestSeed: 120835692,
  trialIndex: 3,
};
describe("Property 3 regression (seed -1448156187)", () => {
  it("the engine captures a centre that is not (0, 0), and the driver maps through it", () => {
    const d = openTrial(cfg);
    runWarmup(d);
    expect(d.centre).not.toEqual({ yaw: 0, pitch: 0 });
    expect(d.geometry.centre).toEqual(d.centre);
    d.pl.destroy();
  });
  it("t0 gets no select or cancel and its entry is a miss", () => {
    const seen: RawEvent[] = [];
    const result = runTrial({ ...cfg, observers: { onEvent: (e) => seen.push({ ...e }) } });
    expect(seen.filter((e) => e.targetId === "t0")).toEqual([]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ targetId: "t0", outcome: "miss", timeToSelectMs: null });
    expect(result.accidental.filter((a) => a.targetId === "t0")).toEqual([]);
  });
});
