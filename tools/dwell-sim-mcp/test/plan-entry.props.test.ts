import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { poseAtPx, toPx, type GeometryContext } from "../src/geometry.js";
import { planEntry, type PlanContext } from "../src/plan-entry.js";
import { Purpose, stream, u01 } from "../src/rng.js";
import type { Layout, LayoutTarget, Pose } from "../src/types.js";

const SCREEN = { width: 1400, height: 900 };
const HEAD = { left: 20, right: 25, up: 15, down: 18 };

interface Case {
  gain: number;
  deadZone: number;
  perm: number[];
  restIndex: number | null;
  widths: number[];
  aimedIndex: number;
  startPx: { x: number; y: number };
  chancePct: number;
  lenMin: number;
  lenSpan: number;
  tp: number;
  rt: number;
  cap: number;
  seed: number;
  entry: number;
}

const caseArb: fc.Arbitrary<Case> = fc.record({
  gain: fc.double({ min: 1, max: 2, noNaN: true }),
  deadZone: fc.double({ min: 0, max: 2, noNaN: true }),
  perm: fc.shuffledSubarray([0, 1, 2, 3, 4, 5], { minLength: 6, maxLength: 6 }),
  restIndex: fc.option(fc.integer({ min: 0, max: 5 }), { nil: null }),
  widths: fc.array(fc.integer({ min: 60, max: 160 }), { minLength: 6, maxLength: 6 }),
  aimedIndex: fc.integer({ min: 0, max: 5 }),
  startPx: fc.record({ x: fc.integer({ min: 0, max: 1399 }), y: fc.integer({ min: 300, max: 600 }) }),
  chancePct: fc.oneof(fc.constant(0), fc.constant(100), fc.integer({ min: 0, max: 100 })),
  lenMin: fc.integer({ min: 0, max: 1000 }),
  lenSpan: fc.integer({ min: 0, max: 2000 }),
  tp: fc.double({ min: 0.5, max: 3, noNaN: true }),
  rt: fc.integer({ min: 150, max: 800 }),
  cap: fc.double({ min: 0.1, max: 3, noNaN: true }),
  seed: fc.integer({ min: -1000, max: 1000 }),
  entry: fc.integer({ min: 0, max: 50 }),
});

function build(c: Case, gain = c.gain, deadZone = c.deadZone, reverse = false) {
  const geometry: GeometryContext = {
    profile: {
      headGain: gain,
      headDeadZone: deadZone,
      calibrationRangeLeft: HEAD.left,
      calibrationRangeRight: HEAD.right,
      calibrationRangeUp: HEAD.up,
      calibrationRangeDown: HEAD.down,
    },
    screen: SCREEN,
    headRange: HEAD,
  };
  const targets: LayoutTarget[] = c.perm.map((p, i) => ({
    id: `id-${p}`,
    rect: { x: 40 + i * 220, y: 400, width: c.widths[i] as number, height: 100 },
    autoRepeat: false,
    role: i === c.restIndex ? "rest-area" : "default",
  }));
  let aimed = targets[c.aimedIndex] as LayoutTarget;
  if (aimed.role === "rest-area") {
    aimed = targets.find((t) => t.role !== "rest-area") as LayoutTarget;
  }
  if (reverse) targets.reverse();
  const layout: Layout = { screen: SCREEN, targets };
  const ctx: PlanContext = {
    geometry,
    layout,
    task: new Array<string>(c.entry + 1).fill(aimed.id),
    user: {
      throughputBitsPerS: c.tp,
      reactionTimeMs: c.rt,
      readingPauseChancePct: c.chancePct,
      readingPauseLengthMs: { min: c.lenMin, max: c.lenMin + c.lenSpan },
      scatterCapDeg: c.cap,
    },
    analysisWindowMs: 60000,
    streams: {
      aim: stream(c.seed, 5, 1, Purpose.Aim),
      readingChance: stream(c.seed, 5, 1, Purpose.ReadingPauseChance),
      readingLength: stream(c.seed, 5, 1, Purpose.ReadingPauseLength),
      start: stream(c.seed, 5, 1, Purpose.Start),
    },
  };
  const p0 = poseAtPx(geometry, c.startPx);
  return { ctx, p0, aimed };
}

/** Independent oracle: ids of selectable non-aimed targets the sampled path enters (not holding P0). */
function crossed(ctx: PlanContext, c: Case, p0: Pose, aimed: LayoutTarget): Set<string> {
  const plan = planEntry(ctx, c.entry, 0, p0);
  const P0 = toPx(ctx.geometry, p0);
  const A = Math.hypot(plan.aimPx.x - P0.x, plan.aimPx.y - P0.y);
  const out = new Set<string>();
  if (A < 0.5) return out;
  const n = Math.min(2000, Math.ceil(A) + 1);
  for (const t of ctx.layout.targets) {
    if (t.role === "rest-area" || t.id === aimed.id) continue;
    const inside = (p: { x: number; y: number }): boolean =>
      p.x >= t.rect.x && p.x < t.rect.x + t.rect.width && p.y >= t.rect.y && p.y < t.rect.y + t.rect.height;
    if (inside(P0)) continue;
    for (let i = 0; i < n; i++) {
      const l = i / (n - 1);
      const pose = {
        yaw: p0.yaw + (plan.aim.yaw - p0.yaw) * l,
        pitch: p0.pitch + (plan.aim.pitch - p0.pitch) * l,
      };
      if (inside(toPx(ctx.geometry, pose))) {
        out.add(t.id);
        break;
      }
    }
  }
  return out;
}

const withPct = (c: Case, chancePct: number): Case => ({ ...c, chancePct });

describe("planEntry properties", () => {
  it("pauses only on crossed non-intended targets, never the aimed one or one holding P0", () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { ctx, p0, aimed } = build(c);
        const plan = planEntry(ctx, c.entry, 0, p0);
        const P0 = toPx(ctx.geometry, p0);
        const cross = crossed(ctx, c, p0, aimed);
        for (const p of plan.pauses) {
          const t = ctx.layout.targets.find((x) => x.id === p.targetId);
          expect(t).toBeDefined();
          expect(t?.role).not.toBe("rest-area");
          expect(p.targetId).not.toBe(aimed.id);
          expect(cross.has(p.targetId)).toBe(true);
          const r = t?.rect;
          expect(r !== undefined && P0.x >= r.x && P0.x < r.x + r.width && P0.y >= r.y && P0.y < r.y + r.height).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("has none at 0 % and one on every crossed non-intended target at 100 %", () => {
    fc.assert(
      fc.property(caseArb, (c0) => {
        const none = build(withPct(c0, 0));
        expect(planEntry(none.ctx, c0.entry, 0, none.p0).pauses).toEqual([]);
        const all = build(withPct(c0, 100));
        const cross = crossed(all.ctx, withPct(c0, 100), all.p0, all.aimed);
        const ids = planEntry(all.ctx, c0.entry, 0, all.p0).pauses.map((p) => p.targetId);
        expect([...ids].sort()).toEqual([...cross].sort());
      }),
      { numRuns: 200 },
    );
  });

  it("each pause length is within [min, max] and the plan is contiguous", () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { ctx, p0 } = build(c);
        const plan = planEntry(ctx, c.entry, 0, p0);
        for (const p of plan.pauses) {
          const len = p.t1 - p.t0;
          expect(len).toBeGreaterThanOrEqual(c.lenMin - 1e-9);
          expect(len).toBeLessThanOrEqual(c.lenMin + c.lenSpan + 1e-9);
        }
        for (let i = 1; i < plan.segments.length; i++) {
          expect(plan.segments[i]?.t0).toBeCloseTo(plan.segments[i - 1]?.t1 ?? NaN, 9);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("chance and length draws depend only on the entry index and layout target index", () => {
    fc.assert(
      fc.property(caseArb, fc.double({ min: 1, max: 2, noNaN: true }), (c, gain2) => {
        const base = build(c);
        const other = build(c, gain2, 0.5, true); // other profile, reversed registration order
        const planA = planEntry(base.ctx, c.entry, 0, base.p0);
        const planB = planEntry(other.ctx, c.entry, 0, other.p0);
        const ids = base.ctx.layout.targets.map((t) => t.id).sort();
        const u = (purpose: Purpose.ReadingPauseChance | Purpose.ReadingPauseLength, id: string): number =>
          u01(stream(c.seed, 5, 1, purpose), c.entry, ids.indexOf(id));
        for (const plan of [planA, planB]) {
          for (const p of plan.pauses) {
            expect(u(Purpose.ReadingPauseChance, p.targetId)).toBeLessThan(c.chancePct / 100);
            expect(p.t1 - p.t0).toBeCloseTo(c.lenMin + u(Purpose.ReadingPauseLength, p.targetId) * c.lenSpan, 6);
          }
        }
        // a target crossed under both profiles is paused under both or neither
        const crossA = crossed(base.ctx, c, base.p0, base.aimed);
        const crossB = crossed(other.ctx, c, other.p0, other.aimed);
        for (const id of crossA) {
          if (!crossB.has(id)) continue;
          const inA = planA.pauses.some((p) => p.targetId === id);
          const inB = planB.pauses.some((p) => p.targetId === id);
          expect(inA).toBe(inB);
        }
      }),
      { numRuns: 200 },
    );
  });
});
