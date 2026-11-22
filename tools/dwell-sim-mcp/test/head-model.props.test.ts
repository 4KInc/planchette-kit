import fc from "fast-check";
import { describe, it } from "vitest";
import { createHeadModel, type HeadStreams, type HeadUser } from "../src/head-model.js";
import type { Segment } from "../src/plan-entry.js";
import { Purpose, stream } from "../src/rng.js";

const int32 = fc.integer({ min: -2147483648, max: 2147483647 });
const mkStreams = (seed: number, userKey: number): HeadStreams => ({
  phase: stream(seed, userKey, 0, Purpose.TremorPhase),
  drift: stream(seed, userKey, 0, Purpose.TremorDriftKnot),
  noise: stream(seed, userKey, 0, Purpose.TrackingNoise),
});

const pose = fc.record({
  yaw: fc.double({ min: -60, max: 60, noNaN: true }),
  pitch: fc.double({ min: -60, max: 60, noNaN: true }),
});
const userArb: fc.Arbitrary<HeadUser> = fc.record({
  tremorFrequencyHz: fc.double({ min: 0, max: 15, noNaN: true }),
  tremorPeakToPeakDeg: fc.double({ min: 0, max: 5, noNaN: true }),
  tremorDriftFraction: fc.constant(0.2),
  tremorAxis: fc.constantFrom("yaw" as const, "pitch" as const),
  trackingNoiseDeg: fc.double({ min: 0, max: 2, noNaN: true }),
  headRangeDeg: fc.record({
    left: fc.double({ min: 1, max: 50, noNaN: true }),
    right: fc.double({ min: 1, max: 50, noNaN: true }),
    up: fc.double({ min: 1, max: 40, noNaN: true }),
    down: fc.double({ min: 1, max: 40, noNaN: true }),
  }),
});

/** Contiguous segments: holds and moves with positive lengths. */
const planArb = fc
  .array(fc.record({ len: fc.integer({ min: 1, max: 800 }), isMove: fc.boolean(), to: pose }), {
    minLength: 1,
    maxLength: 8,
  })
  .chain((parts) =>
    pose.map((start) => {
      const segments: Segment[] = [];
      let t = 0;
      let at = start;
      for (const p of parts) {
        if (p.isMove) {
          segments.push({ kind: "move", t0: t, t1: t + p.len, from: at, to: p.to, phase: "moving" });
          at = p.to;
        } else {
          segments.push({ kind: "hold", t0: t, t1: t + p.len, pose: at, phase: "holding" });
        }
        t += p.len;
      }
      return { segments };
    }),
  );
const time = fc.double({ min: -100, max: 8000, noNaN: true });
const keys = fc.record({ seed: int32, user: int32 });

describe("head model properties", () => {
  // **Validates: Requirements 2.2, 2.4**
  it("the result is inside the head range for any t", () => {
    fc.assert(
      fc.property(planArb, userArb, keys, time, (plan, u, k, t) => {
        const h = createHeadModel(u, mkStreams(k.seed, k.user)).head(plan, t);
        const r = u.headRangeDeg;
        return h.yaw >= -r.left && h.yaw <= r.right && h.pitch >= -r.down && h.pitch <= r.up;
      }),
    );
  });

  // **Validates: Requirements 11.8**
  it("noise is within ±n per axis around the clamped base (tremor off)", () => {
    fc.assert(
      fc.property(planArb, userArb, keys, time, (plan, u0, k, t) => {
        const u = { ...u0, tremorPeakToPeakDeg: 0 };
        const m = createHeadModel(u, mkStreams(k.seed, k.user));
        const b = { ...m.basePose(plan, t) };
        const h = m.head(plan, t);
        const r = u.headRangeDeg;
        const n = u.trackingNoiseDeg;
        // Clamping is 1-Lipschitz, so the clamped result is within n of the clamped base.
        const cy = Math.min(r.right, Math.max(-r.left, b.yaw));
        const cp = Math.min(r.up, Math.max(-r.down, b.pitch));
        return Math.abs(h.yaw - cy) <= n + 1e-9 && Math.abs(h.pitch - cp) <= n + 1e-9;
      }),
    );
  });

  // **Validates: Requirements 2.3, 11.8**
  it("the same t gives the same pose however earlier t values were visited", () => {
    fc.assert(
      fc.property(planArb, userArb, keys, time, fc.array(time, { maxLength: 30 }), (plan, u, k, t, others) => {
        const fresh = createHeadModel(u, mkStreams(k.seed, k.user));
        const expected = { ...fresh.head(plan, t) };
        const warmed = createHeadModel(u, mkStreams(k.seed, k.user));
        for (const o of others) warmed.head(plan, o);
        const got = warmed.head(plan, t);
        return got.yaw === expected.yaw && got.pitch === expected.pitch;
      }),
    );
  });

  // **Validates: Requirements 2.2, 2.3**
  it("with tremor and noise off, head equals the clamped basePose", () => {
    fc.assert(
      fc.property(planArb, userArb, keys, time, (plan, u0, k, t) => {
        const u = { ...u0, tremorPeakToPeakDeg: 0, trackingNoiseDeg: 0 };
        const m = createHeadModel(u, mkStreams(k.seed, k.user));
        const b = { ...m.basePose(plan, t) };
        const h = m.head(plan, t);
        const r = u.headRangeDeg;
        return (
          h.yaw === Math.min(r.right, Math.max(-r.left, b.yaw)) &&
          h.pitch === Math.min(r.up, Math.max(-r.down, b.pitch))
        );
      }),
    );
  });
});
