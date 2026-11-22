import { describe, expect, it } from "vitest";
import type { GeometryContext } from "../src/geometry.js";
import { toPose } from "../src/geometry.js";
import { Purpose, stream, u01 } from "../src/rng.js";
import { PHI_3, PHI_MINUS_3, probit, sampleAim, ttn } from "../src/scatter.js";

const REL = 1.2e-9;

function expectQuantile(p: number, expected: number): void {
  const got = probit(p);
  if (expected === 0) expect(Math.abs(got)).toBeLessThanOrEqual(1e-12);
  else expect(Math.abs(got - expected) / Math.abs(expected)).toBeLessThanOrEqual(REL);
}

const ctx: GeometryContext = {
  profile: {
    headGain: 1,
    headDeadZone: 0,
    calibrationRangeLeft: 20,
    calibrationRangeRight: 20,
    calibrationRangeUp: 20,
    calibrationRangeDown: 20,
  },
  screen: { width: 1000, height: 800 },
  headRange: { left: 60, right: 60, up: 60, down: 60 },
};
const rect = { x: 400, y: 300, width: 200, height: 200 };

describe("probit", () => {
  it("central branch quantiles", () => {
    expectQuantile(0.975, 1.959963984540054);
    expectQuantile(0.9, 1.2815515655446004);
    expectQuantile(0.5, 0);
  });
  it("upper branch quantile", () => expectQuantile(0.995, 2.5758293035489004));
  it("lower (tail) branch quantile", () => expectQuantile(0.01, -2.3263478740408408));
  it("is antisymmetric about 0.5 in the tails", () => {
    expect(probit(0.99)).toBeCloseTo(-probit(0.01), 12);
  });
});

describe("ttn", () => {
  it("uses the Φ(-3) and Φ(3) constants", () => {
    expect(PHI_MINUS_3).toBe(0.0013498980316301);
    expect(PHI_3).toBe(0.9986501019683699);
    expect(PHI_MINUS_3 + PHI_3).toBeCloseTo(1, 15);
  });
  it("stays inside ±(3 - 1e-9) at both ends of [0, 1)", () => {
    const limit = 3 - 1e-9;
    expect(Math.abs(ttn(0))).toBeLessThanOrEqual(limit);
    expect(Math.abs(ttn(1 - 2 ** -53))).toBeLessThanOrEqual(limit);
    expect(ttn(0)).toBeLessThan(0);
    expect(ttn(1 - 2 ** -53)).toBeGreaterThan(0);
  });
  it("is 0 at u = 0.5", () => {
    expect(Math.abs(ttn(0.5))).toBeLessThan(1e-9);
  });
});

describe("sampleAim", () => {
  it("aims at the target centre when the scatter is zero (z = 0 equivalent)", () => {
    const s = stream(1, 2, 3, Purpose.Aim);
    const c = toPose(ctx, { x: 500, y: 400 });
    const a = sampleAim(ctx, rect, 0, s, 4);
    expect(a.yaw).toBeCloseTo(c.yaw, 12);
    expect(a.pitch).toBeCloseTo(c.pitch, 12);
  });

  it("offsets the centre by ttn(u) × SD with SD = min(W / 4.133, cap) on each axis", () => {
    const s = stream(1, 2, 3, Purpose.Aim);
    const c = toPose(ctx, { x: 500, y: 400 });
    // The 200 px rectangle is about 8 and 10 deg wide, so the 0.6 deg cap applies on both axes.
    const a = sampleAim(ctx, rect, 0.6, s, 4);
    expect(a.yaw - c.yaw).toBeCloseTo(ttn(u01(s, 4, 0)) * 0.6, 9);
    expect(a.pitch - c.pitch).toBeCloseTo(ttn(u01(s, 4, 1)) * 0.6, 9);
    const small = { x: 400, y: 300, width: 10, height: 8 };
    const cs = toPose(ctx, { x: 405, y: 304 });
    const b = sampleAim(ctx, small, 5, s, 4);
    // The mapping spans 40 deg over (width - 1) px, so 10 px is 400/999 deg and 8 px is 320/799 deg.
    expect(b.yaw - cs.yaw).toBeCloseTo(ttn(u01(s, 4, 0)) * (400 / 999 / 4.133), 9);
    expect(b.pitch - cs.pitch).toBeCloseTo(ttn(u01(s, 4, 1)) * (320 / 799 / 4.133), 9);
  });

  it("clamps the aim to the head range", () => {
    const tight: GeometryContext = { ...ctx, headRange: { left: 0, right: 0, up: 0, down: 0 } };
    const a = sampleAim(tight, rect, 0.6, stream(1, 2, 3, Purpose.Aim), 0);
    expect(a).toEqual({ yaw: 0, pitch: 0 });
  });

  it("is a pure function of the stream and entry index", () => {
    const s = stream(9, 8, 7, Purpose.Aim);
    expect(sampleAim(ctx, rect, 0.6, s, 2)).toEqual(sampleAim(ctx, rect, 0.6, stream(9, 8, 7, Purpose.Aim), 2));
  });
});
