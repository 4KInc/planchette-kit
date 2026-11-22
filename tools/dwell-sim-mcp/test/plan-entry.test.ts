import { describe, expect, it } from "vitest";
import { poseAtPx, toPx, type GeometryContext } from "../src/geometry.js";
import { planEntry, type PlanContext } from "../src/plan-entry.js";
import { Purpose, stream, u01 } from "../src/rng.js";
import type { Layout, Pose } from "../src/types.js";

const profile = {
  headGain: 1.3,
  headDeadZone: 1,
  calibrationRangeLeft: 20,
  calibrationRangeRight: 25,
  calibrationRangeUp: 15,
  calibrationRangeDown: 18,
};
const geometry: GeometryContext = {
  profile,
  screen: { width: 1200, height: 900 },
  headRange: { left: 20, right: 25, up: 15, down: 18 },
};
const layout: Layout = {
  screen: geometry.screen,
  targets: [
    { id: "a", rect: { x: 100, y: 400, width: 100, height: 100 }, autoRepeat: false, role: "default" },
    { id: "mid", rect: { x: 500, y: 400, width: 100, height: 100 }, autoRepeat: false, role: "default" },
    { id: "goal", rect: { x: 1000, y: 400, width: 100, height: 100 }, autoRepeat: false, role: "default" },
  ],
};
const WINDOW = 20000;

function makeCtx(
  over: {
    chancePct?: number;
    lengthMs?: { min: number; max: number };
    geometry?: GeometryContext;
    task?: string[];
  } = {},
): PlanContext {
  return {
    geometry: over.geometry ?? geometry,
    layout,
    task: over.task ?? ["goal", "a"],
    user: {
      throughputBitsPerS: 1.42,
      reactionTimeMs: 500,
      readingPauseChancePct: over.chancePct ?? 100,
      readingPauseLengthMs: over.lengthMs ?? { min: 300, max: 900 },
      scatterCapDeg: 0.6,
    },
    analysisWindowMs: WINDOW,
    streams: {
      aim: stream(1, 7, 0, Purpose.Aim),
      readingChance: stream(1, 7, 0, Purpose.ReadingPauseChance),
      readingLength: stream(1, 7, 0, Purpose.ReadingPauseLength),
      start: stream(1, 7, 0, Purpose.Start),
    },
  };
}
const startPose: Pose = poseAtPx(geometry, { x: 150, y: 450 });

describe("planEntry", () => {
  it("starts with the reaction wait at p0", () => {
    const plan = planEntry(makeCtx(), 0, 1000, startPose);
    const first = plan.segments[0];
    expect(first).toEqual({ kind: "hold", t0: 1000, t1: 1500, pose: startPose, phase: "waiting" });
    expect(plan.tEntry).toBe(1000);
    expect(plan.tMove0).toBe(1500);
  });

  it("deadline equals tMove0 + analysis window and the last segment ends there", () => {
    const plan = planEntry(makeCtx(), 0, 1000, startPose);
    expect(plan.deadline).toBe(plan.tMove0 + WINDOW);
    const last = plan.segments[plan.segments.length - 1];
    expect(last).toMatchObject({ kind: "hold", phase: "holding", t1: plan.deadline });
  });

  it("segments are contiguous in time", () => {
    const plan = planEntry(makeCtx(), 0, 0, startPose);
    for (let i = 1; i < plan.segments.length; i++) {
      expect(plan.segments[i]?.t0).toBe(plan.segments[i - 1]?.t1);
    }
  });

  it("a pause piece starts the next move from rest at the pause pose", () => {
    const plan = planEntry(makeCtx(), 0, 0, startPose);
    expect(plan.pauses.map((p) => p.targetId)).toEqual(["mid"]);
    const i = plan.segments.findIndex((s) => s.phase === "reading-pause");
    const pause = plan.segments[i];
    const next = plan.segments[i + 1];
    expect(pause?.kind).toBe("hold");
    expect(next?.kind).toBe("move");
    if (pause?.kind === "hold" && next?.kind === "move") {
      expect(next.from).toEqual(pause.pose);
      expect(next.t0).toBe(pause.t1);
      expect(toPx(geometry, pause.pose).x).toBeGreaterThanOrEqual(500);
      expect(toPx(geometry, pause.pose).x).toBeLessThan(600);
    }
    expect(plan.pauses[0]).toMatchObject({ t0: pause?.t0, t1: pause?.t1 });
  });

  it("pause length follows the length draw of (entry, sorted layout index)", () => {
    const plan = planEntry(makeCtx({ task: ["goal", "goal", "goal", "goal"] }), 3, 0, startPose);
    // sorted ids: a, goal, mid -> mid has index 2
    const u = u01(stream(1, 7, 0, Purpose.ReadingPauseLength), 3, 2);
    const p = plan.pauses[0];
    expect((p?.t1 ?? 0) - (p?.t0 ?? 0)).toBeCloseTo(300 + u * 600, 9);
  });

  it("start on the aim gives a single hold after the reaction wait", () => {
    const first = planEntry(makeCtx(), 0, 0, startPose);
    const plan = planEntry(makeCtx(), 0, 0, first.aim);
    expect(plan.segments).toHaveLength(2);
    expect(plan.segments[1]).toEqual({
      kind: "hold",
      t0: plan.tMove0,
      t1: plan.deadline,
      pose: first.aim,
      phase: "holding",
    });
    expect(plan.pauses).toEqual([]);
  });

  it("has no pauses at 0 %", () => {
    expect(planEntry(makeCtx({ chancePct: 0 }), 0, 0, startPose).pauses).toEqual([]);
  });

  it("never pauses on the aimed target or on a target holding the start point", () => {
    const plan = planEntry(makeCtx({ task: ["mid"] }), 0, 0, startPose);
    expect(plan.pauses).toEqual([]);
    const back = planEntry(makeCtx({ task: ["goal"] }), 0, 0, poseAtPx(geometry, { x: 550, y: 450 }));
    expect(back.pauses).toEqual([]);
  });

  it("clamps the aim to the head range", () => {
    const small: GeometryContext = { ...geometry, headRange: { left: 3, right: 3, up: 3, down: 3 } };
    const plan = planEntry(makeCtx({ geometry: small }), 0, 0, { yaw: 0, pitch: 0 });
    expect(plan.aim.yaw).toBeCloseTo(3, 9);
    expect(Math.abs(plan.aim.pitch)).toBeLessThanOrEqual(3);
    for (const s of plan.segments) {
      const poses = s.kind === "hold" ? [s.pose] : [s.from, s.to];
      for (const p of poses) {
        expect(Math.abs(p.yaw)).toBeLessThanOrEqual(3 + 1e-9);
      }
    }
  });

  it("throws for an entry that names no layout target", () => {
    expect(() => planEntry(makeCtx({ task: ["nope"] }), 0, 0, startPose)).toThrow();
  });
});
