import { describe, expect, it } from "vitest";
import {
  openTrial,
  pushEvent,
  runStartOfSession,
  runTrial,
  runWarmup,
  WARNING_START_CLAMPED,
  type TrialConfig,
} from "../src/run-trial.js";
import type { Layout, LayoutTarget, RawEvent, ResolvedUser } from "../src/types.js";

const screen = { width: 1200, height: 900 };
const rest: LayoutTarget = {
  id: "rest",
  rect: { x: 1000, y: 700, width: 150, height: 150 },
  autoRepeat: false,
  role: "rest-area",
};
const aim: LayoutTarget = {
  id: "a",
  rect: { x: 100, y: 100, width: 150, height: 150 },
  autoRepeat: false,
  role: "default",
};
/** Selectable, covers the screen centre and the first part of the way to the rest area. */
const betweenCentreAndRest: LayoutTarget = {
  id: "mid",
  rect: { x: 550, y: 400, width: 250, height: 200 },
  autoRepeat: true,
  role: "default",
};

const user = (over: Partial<ResolvedUser["params"]> = {}): ResolvedUser => ({
  name: "test",
  key: 7,
  params: {
    throughputBitsPerS: 0.5,
    tremorFrequencyHz: 0,
    tremorPeakToPeakDeg: 0,
    tremorAxis: "yaw",
    tremorDriftFraction: 0.2,
    headRangeDeg: { left: 20, right: 25, up: 15, down: 18 },
    reactionTimeMs: 2000,
    readingPauseChancePct: 0,
    readingPauseLengthMs: { min: 100, max: 200 },
    trackingNoiseDeg: 0,
    scatterCapDeg: 0.5,
    scanReactionTimeMs: 300,
    scanLatePressChancePct: 0,
    scanPressDurationMs: 100,
    ...over,
  },
});

const cfg = (targets: LayoutTarget[], over: Partial<TrialConfig> = {}): TrialConfig => ({
  layout: { screen, targets } as Layout,
  profile: { dwellTime: 300 },
  user: user(),
  mode: "head + dwell",
  task: ["a"],
  fps: 30,
  analysisWindowMs: 10000,
  requestSeed: 1,
  trialIndex: 0,
  ...over,
});

/** Opens a trial, runs warm-up and start, and keeps every event the engine emitted. */
function start(c: TrialConfig) {
  const seen: RawEvent[] = [];
  const d = openTrial({ ...c, observers: { onEvent: (e) => seen.push({ ...e }) } });
  runWarmup(d);
  const warmupEvents = seen.length;
  const s = runStartOfSession(d);
  return { d, s, seen, warmupEvents };
}

describe("start of session", () => {
  it("with a rest area: waits the reaction time, ends inside the rest area, entry 0 starts at tEnd", () => {
    const { d, s } = start(cfg([rest, aim]));
    const p = s.startPlan;
    expect(p.tBegin).toBe(d.tDone);
    expect(p.tEnd).toBeGreaterThan(p.tBegin + 2000);
    expect(s.tEntry).toBe(p.tEnd);
    expect(s.endPose).toBe(p.endPose);
    // The frame at tEnd is not fed by the start of session: it belongs to entry 0.
    expect(s.nextFrame * d.frameMs).toBeGreaterThanOrEqual(p.tEnd);
    expect((s.nextFrame - 1) * d.frameMs).toBeLessThan(p.tEnd);
    d.pl.destroy();
  });

  it("the end pose maps to a pixel inside the rest rectangle", async () => {
    const { d, s } = start(cfg([rest, aim]));
    const { toPx } = await import("../src/geometry.js");
    const p = toPx(d.geometry, s.endPose);
    expect(p.x).toBeGreaterThanOrEqual(rest.rect.x);
    expect(p.x).toBeLessThan(rest.rect.x + rest.rect.width);
    expect(p.y).toBeGreaterThanOrEqual(rest.rect.y);
    expect(p.y).toBeLessThan(rest.rect.y + rest.rect.height);
    expect(s.startPlan.restId).toBe("rest");
    expect(s.startPlan.clamped).toBe(false);
    d.pl.destroy();
  });

  it("without a rest area: zero length, the user stays at the centre, entry 0 starts at tDone", () => {
    const { d, s } = start(cfg([aim]));
    expect(s.startPlan.segments).toEqual([]);
    expect(s.startPlan.tEnd).toBe(d.tDone);
    expect(s.tEntry).toBe(d.tDone);
    expect(s.endPose).toEqual({ yaw: 0, pitch: 0 });
    expect(s.startPlan.restId).toBeNull();
    // No frame is fed after the warm-up.
    expect(s.nextFrame).toBe(d.k);
    expect(d.k * d.frameMs).toBeGreaterThan(d.tDone);
    d.pl.destroy();
  });

  it("a select while waiting at the centre (warm-up) is a start-of-session event, never accidental", () => {
    // The engine holds selection during calibration, so the warm-up queue is normally empty.
    // Queue events by hand, as the listeners would, to cover the warm-up path: one in the
    // middle of the warm-up and one on the frame of the centre/done event. Warm-up events are
    // recorded directly as start events (design section 5/6), not classified: without a rest
    // area tEnd == tDone, so the event at tDone has now == tEnd.
    for (const targets of [[betweenCentreAndRest, aim], [rest, betweenCentreAndRest, aim]]) {
      const d = openTrial(cfg(targets));
      runWarmup(d);
      expect(d.queue.length).toBe(0);
      pushEvent(d.queue, "select", "mid", 500);
      pushEvent(d.queue, "cancel", undefined, d.tDone);
      runStartOfSession(d);
      expect(d.startEvents.slice(0, 2)).toEqual([
        { targetId: "mid", timeMs: 500 },
        { targetId: null, timeMs: d.tDone },
      ]);
      d.pl.destroy();
    }
  });

  it("a select during the reaction wait is a start-of-session event", () => {
    const { d, s, seen, warmupEvents } = start(cfg([rest, betweenCentreAndRest, aim]));
    const p = s.startPlan;
    const inReaction = seen.filter((e) => e.now > p.tBegin && e.now < p.tBegin + 2000);
    expect(inReaction.length).toBeGreaterThan(0);
    expect(d.startEvents.length).toBe(seen.length);
    expect(seen.length).toBeGreaterThan(warmupEvents);
    for (const e of inReaction) {
      expect(d.startEvents.some((r) => r.timeMs === e.now && r.targetId === e.targetId)).toBe(true);
    }
    d.pl.destroy();
  });

  it("a select during the start movement is a start-of-session event", () => {
    // The target sits between the centre and the rest area and the head moves slowly (0.3 bits/s).
    const mid: LayoutTarget = {
      id: "mid",
      rect: { x: 700, y: 480, width: 160, height: 140 },
      autoRepeat: false,
      role: "default",
    };
    const c = cfg([rest, mid, aim], {
      user: user({ throughputBitsPerS: 0.3, reactionTimeMs: 200 }),
      profile: { dwellTime: 150 },
    });
    const { d, s, seen } = start(c);
    const p = s.startPlan;
    const moving = seen.filter((e) => e.now >= p.tBegin + 200 && e.now < p.tEnd);
    expect(moving.length).toBeGreaterThan(0);
    expect(moving.every((e) => e.targetId === "mid")).toBe(true);
    expect(d.startEvents.length).toBe(seen.length);
    d.pl.destroy();
  });

  it("start events are recorded once, in emission order, and none is accidental", () => {
    const { d, seen } = start(cfg([rest, betweenCentreAndRest, aim]));
    expect(seen.length).toBeGreaterThan(0);
    expect(d.startEvents).toEqual(seen.map((e) => ({ targetId: e.targetId ?? null, timeMs: e.now })));
    d.pl.destroy();
    // Through runTrial the start events are the same and the entry loop adds no start event.
    const r = runTrial(cfg([rest, betweenCentreAndRest, aim]));
    expect(r.startEvents).toEqual(d.startEvents);
    expect(r.warnings).toEqual([]);
  });

  it("warns start-clamped when the rest point is outside the head range", () => {
    const small = user({ headRangeDeg: { left: 3, right: 3, up: 3, down: 3 } });
    const r = runTrial(
      cfg([rest, aim], { user: small, profile: { calibrationRangeLeft: 20, calibrationRangeRight: 20 } }),
    );
    expect(r.warnings).toContain(WARNING_START_CLAMPED);
    const ok = runTrial(cfg([rest, aim]));
    expect(ok.warnings).not.toContain(WARNING_START_CLAMPED);
  });

  it("repeats exactly for the same configuration", () => {
    const c = cfg([rest, betweenCentreAndRest, aim]);
    expect(runTrial(c)).toEqual(runTrial(c));
  });
});
