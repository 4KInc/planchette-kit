import { describe, expect, it } from "vitest";
import { MT_MIN } from "../src/fitts.js";
import { poseAtPx, toPx, type GeometryContext } from "../src/geometry.js";
import { planEntry, type PlanContext } from "../src/plan-entry.js";
import { planStart } from "../src/plan-start.js";
import { Purpose, stream } from "../src/rng.js";
import { sampleAim } from "../src/scatter.js";
import type { Layout, LayoutTarget } from "../src/types.js";
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
  centre: { yaw: 0, pitch: 0 },
};
const rest: LayoutTarget = {
  id: "rest",
  rect: { x: 900, y: 700, width: 250, height: 150 },
  autoRepeat: false,
  role: "rest-area",
};
const mid: LayoutTarget = {
  id: "mid",
  rect: { x: 500, y: 400, width: 100, height: 100 },
  autoRepeat: false,
  role: "default",
};
const goal: LayoutTarget = {
  id: "goal",
  rect: { x: 100, y: 100, width: 100, height: 100 },
  autoRepeat: false,
  role: "default",
};
function makeCtx(
  targets: LayoutTarget[] = [mid, rest, goal],
  over: { chancePct?: number; geometry?: GeometryContext } = {},
): PlanContext {
  const layout: Layout = { screen: geometry.screen, targets };
  return {
    geometry: over.geometry ?? geometry,
    layout,
    task: ["goal", "mid"],
    user: {
      throughputBitsPerS: 1.42,
      reactionTimeMs: 500,
      readingPauseChancePct: over.chancePct ?? 0,
      readingPauseLengthMs: { min: 300, max: 900 },
      scatterCapDeg: 0.3,
    },
    analysisWindowMs: 20000,
    streams: {
      aim: stream(1, 7, 0, Purpose.Aim),
      readingChance: stream(1, 7, 0, Purpose.ReadingPauseChance),
      readingLength: stream(1, 7, 0, Purpose.ReadingPauseLength),
      start: stream(1, 7, 0, Purpose.Start),
    },
  };
}
describe("planStart", () => {
  it("waits the reaction time at the centre, then moves to the aim", () => {
    const plan = planStart(makeCtx(), 1000);
    expect(plan.restId).toBe("rest");
    expect(plan.segments).toHaveLength(2);
    expect(plan.segments[0]).toEqual({
      kind: "hold",
      t0: 1000,
      t1: 1500,
      pose: { yaw: 0, pitch: 0 },
      phase: "start-of-session",
      sub: "reaction",
    });
    const move = plan.segments[1];
    expect(move).toMatchObject({
      kind: "move",
      t0: 1500,
      from: { yaw: 0, pitch: 0 },
      to: plan.endPose,
      phase: "start-of-session",
      sub: "moving",
    });
    expect(move?.t1).toBe(plan.tEnd);
    expect((move?.t1 ?? 0) - (move?.t0 ?? 0)).toBeGreaterThanOrEqual(MT_MIN);
    expect(plan.tBegin).toBe(1000);
  });
  it("the aim comes from sampleAim with the start stream and key 0", () => {
    const ctx = makeCtx();
    const plan = planStart(ctx, 0);
    expect(plan.endPose).toEqual(
      sampleAim(ctx.geometry, rest.rect, 0.3, ctx.streams.start, 0),
    );
  });
  it("ends inside the rest rectangle when it is reachable", () => {
    const plan = planStart(makeCtx(), 0);
    const p = toPx(geometry, plan.endPose);
    expect(p.x).toBeGreaterThanOrEqual(rest.rect.x);
    expect(p.x).toBeLessThan(rest.rect.x + rest.rect.width);
    expect(p.y).toBeGreaterThanOrEqual(rest.rect.y);
    expect(p.y).toBeLessThan(rest.rect.y + rest.rect.height);
    expect(plan.clamped).toBe(false);
  });
  it("has no reading pause at a 100 % chance, though a target lies on the path", () => {
    const plan = planStart(makeCtx([mid, rest, goal], { chancePct: 100 }), 0);
    expect(plan.segments.every((s) => s.phase === "start-of-session")).toBe(true);
    expect(plan.segments.filter((s) => s.kind === "move")).toHaveLength(1);
  });
  it("without a rest area: no segments, tEnd = tBegin, end pose is the centre", () => {
    const plan = planStart(makeCtx([mid, goal]), 777);
    expect(plan).toEqual({
      tBegin: 777,
      tEnd: 777,
      segments: [],
      endPose: { yaw: 0, pitch: 0 },
      restId: null,
      clamped: false,
    });
  });
  it("uses the first rest area in layout order", () => {
    const second: LayoutTarget = { ...rest, id: "rest2", rect: { ...rest.rect, x: 50 } };
    expect(planStart(makeCtx([mid, rest, second]), 0).restId).toBe("rest");
    expect(planStart(makeCtx([second, mid, rest]), 0).restId).toBe("rest2");
  });
  it("is clamped when the rest point is out of the head range", () => {
    const narrow: GeometryContext = {
      ...geometry,
      headRange: { left: 2, right: 2, up: 2, down: 2 },
    };
    const plan = planStart(makeCtx([mid, rest, goal], { geometry: narrow }), 0);
    expect(plan.clamped).toBe(true);
    expect(Math.abs(plan.endPose.yaw)).toBeLessThanOrEqual(2);
    expect(Math.abs(plan.endPose.pitch)).toBeLessThanOrEqual(2);
  });
  it("a different start stream changes only the start plan, not an entry's aim", () => {
    const a = makeCtx();
    const b: PlanContext = {
      ...a,
      streams: { ...a.streams, start: stream(99, 3, 4, Purpose.Start) },
    };
    expect(planStart(a, 0).endPose).not.toEqual(planStart(b, 0).endPose);
    const p0 = poseAtPx(geometry, { x: 150, y: 450 });
    expect(planEntry(a, 0, 0, p0)).toEqual(planEntry(b, 0, 0, p0));
  });
  it("entry 0 can start at tEnd: its reaction wait begins there", () => {
    const ctx = makeCtx();
    const start = planStart(ctx, 300);
    const entry = planEntry(ctx, 0, start.tEnd, start.endPose);
    expect(entry.tEntry).toBe(start.tEnd);
    expect(entry.segments[0]).toMatchObject({ t0: start.tEnd, pose: start.endPose });
    expect(entry.tMove0 - entry.tEntry).toBe(500);
  });
});
