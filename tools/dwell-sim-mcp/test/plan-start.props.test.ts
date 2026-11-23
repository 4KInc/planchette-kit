import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { angularWidth, toPx, type GeometryContext } from "../src/geometry.js";
import { planEntry, type PlanContext } from "../src/plan-entry.js";
import { planStart } from "../src/plan-start.js";
import { Purpose, stream } from "../src/rng.js";
import type { Layout, LayoutTarget } from "../src/types.js";
const SCREEN = { width: 1400, height: 900 };
const HEAD = { left: 20, right: 25, up: 15, down: 18 };
interface Case {
  gain: number;
  deadZone: number;
  restIndex: number | null;
  restRect: { x: number; y: number; width: number; height: number };
  chancePct: number;
  tp: number;
  rt: number;
  cap: number;
  seed: number;
  tBegin: number;
}
const caseArb: fc.Arbitrary<Case> = fc.record({
  gain: fc.double({ min: 1, max: 2, noNaN: true }),
  deadZone: fc.double({ min: 0, max: 2, noNaN: true }),
  restIndex: fc.option(fc.integer({ min: 0, max: 3 }), { nil: null }),
  restRect: fc.record({
    x: fc.integer({ min: 300, max: 800 }),
    y: fc.integer({ min: 200, max: 500 }),
    width: fc.integer({ min: 150, max: 400 }),
    height: fc.integer({ min: 150, max: 300 }),
  }),
  chancePct: fc.oneof(fc.constant(100), fc.integer({ min: 0, max: 100 })),
  tp: fc.double({ min: 0.5, max: 3, noNaN: true }),
  rt: fc.integer({ min: 150, max: 800 }),
  cap: fc.double({ min: 0.05, max: 0.3, noNaN: true }),
  seed: fc.integer({ min: -1000, max: 1000 }),
  tBegin: fc.integer({ min: 0, max: 100000 }),
});
function build(c: Case, startSeed = c.seed, aimSeed = c.seed): { ctx: PlanContext; rest: LayoutTarget | null } {
  const geometry: GeometryContext = {
    profile: {
      headGain: c.gain,
      headDeadZone: c.deadZone,
      calibrationRangeLeft: HEAD.left,
      calibrationRangeRight: HEAD.right,
      calibrationRangeUp: HEAD.up,
      calibrationRangeDown: HEAD.down,
    },
    screen: SCREEN,
    headRange: HEAD,
    centre: { yaw: 0, pitch: 0 },
  };
  const targets: LayoutTarget[] = [0, 1, 2, 3].map((i) => ({
    id: `t${i}`,
    rect: { x: 40 + i * 300, y: 350, width: 120, height: 100 },
    autoRepeat: false,
    role: i === c.restIndex ? "rest-area" : "default",
  }));
  let rest: LayoutTarget | null = null;
  if (c.restIndex !== null) {
    rest = { ...(targets[c.restIndex] as LayoutTarget), rect: c.restRect };
    targets[c.restIndex] = rest;
  }
  const layout: Layout = { screen: SCREEN, targets };
  const aimed = targets.find((t) => t.role !== "rest-area") as LayoutTarget;
  const ctx: PlanContext = {
    geometry,
    layout,
    task: [aimed.id, aimed.id],
    user: {
      throughputBitsPerS: c.tp,
      reactionTimeMs: c.rt,
      readingPauseChancePct: c.chancePct,
      readingPauseLengthMs: { min: 300, max: 900 },
      scatterCapDeg: c.cap,
    },
    analysisWindowMs: 30000,
    streams: {
      aim: stream(aimSeed, 5, 1, Purpose.Aim),
      readingChance: stream(c.seed, 5, 1, Purpose.ReadingPauseChance),
      readingLength: stream(c.seed, 5, 1, Purpose.ReadingPauseLength),
      start: stream(startSeed, 5, 1, Purpose.Start),
    },
  };
  return { ctx, rest };
}
describe("planStart properties", () => {
  it("segments are contiguous, reaction comes first, then one move; no reading pause", () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { ctx, rest } = build(c);
        const plan = planStart(ctx, c.tBegin);
        if (rest === null) {
          expect(plan.segments).toEqual([]);
          expect(plan.tEnd).toBe(c.tBegin);
          expect(plan.endPose).toEqual({ yaw: 0, pitch: 0 });
          expect(plan.restId).toBeNull();
          return;
        }
        const [first, second, ...more] = plan.segments;
        expect(first).toMatchObject({ kind: "hold", sub: "reaction", t0: c.tBegin });
        expect(first?.t1).toBe(c.tBegin + c.rt);
        expect(more).toEqual([]);
        if (second !== undefined) {
          expect(second).toMatchObject({ kind: "move", sub: "moving", t0: first?.t1 });
          expect(plan.tEnd).toBe(second.t1);
        } else {
          expect(plan.tEnd).toBe(c.tBegin + c.rt);
        }
        for (const s of plan.segments) expect(s.phase).toBe("start-of-session");
        expect(plan.restId).toBe(rest.id);
      }),
    );
  });
  it("the end pose lies inside the rest rectangle when it is reachable and wide enough", () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { ctx, rest } = build(c);
        fc.pre(rest !== null);
        const r = rest as LayoutTarget;
        const plan = planStart(ctx, c.tBegin);
        fc.pre(!plan.clamped);
        // the aim lies within 3 SD of the centre, and SD <= cap, so need half-width > 3 cap (plus px margin)
        fc.pre(angularWidth(ctx.geometry, r.rect, "x") >= 6 * c.cap + 0.5);
        fc.pre(angularWidth(ctx.geometry, r.rect, "y") >= 6 * c.cap + 0.5);
        const p = toPx(ctx.geometry, plan.endPose);
        expect(p.x).toBeGreaterThanOrEqual(r.rect.x);
        expect(p.x).toBeLessThan(r.rect.x + r.rect.width);
        expect(p.y).toBeGreaterThanOrEqual(r.rect.y);
        expect(p.y).toBeLessThan(r.rect.y + r.rect.height);
      }),
    );
  });
  it("start draws use only Purpose.Start: other streams do not change the start plan, and the start stream does not change an entry", () => {
    fc.assert(
      fc.property(caseArb, fc.integer({ min: 2000, max: 3000 }), (c, other) => {
        const base = build(c);
        const otherAim = build(c, c.seed, other);
        expect(planStart(otherAim.ctx, c.tBegin)).toEqual(planStart(base.ctx, c.tBegin));
        const otherStart = build(c, other, c.seed);
        const p0 = { yaw: 1, pitch: -1 };
        for (const k of [0, 1]) {
          expect(planEntry(otherStart.ctx, k, 0, p0)).toEqual(planEntry(base.ctx, k, 0, p0));
        }
      }),
    );
  });
  it("is deterministic and tEnd - tBegin does not depend on tBegin", () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { ctx } = build(c);
        const a = planStart(ctx, 0);
        const b = planStart(ctx, c.tBegin);
        expect(planStart(ctx, c.tBegin)).toEqual(b);
        expect(b.tEnd - c.tBegin).toBeCloseTo(a.tEnd, 6);
        expect(b.endPose).toEqual(a.endPose);
      }),
    );
  });
});
