import { describe, expect, it } from "vitest";
import { minJerk, poseOnSegment } from "../src/min-jerk.js";

describe("minJerk", () => {
  it("has s(0) = 0, s(1) = 1, s(0.5) = 0.5", () => {
    expect(minJerk(0)).toBe(0);
    expect(minJerk(1)).toBe(1);
    expect(minJerk(0.5)).toBeCloseTo(0.5, 12);
  });

  it("matches the formula at τ = 0.25", () => {
    const t = 0.25;
    expect(minJerk(t)).toBeCloseTo(10 * t ** 3 - 15 * t ** 4 + 6 * t ** 5, 12);
  });

  it("clamps τ outside [0, 1]", () => {
    expect(minJerk(-3)).toBe(0);
    expect(minJerk(7)).toBe(1);
  });
});

describe("poseOnSegment", () => {
  const seg = { t0: 100, t1: 300, from: { yaw: -2, pitch: 4 }, to: { yaw: 6, pitch: -4 } };

  it("starts at from and ends at to, holding outside the interval", () => {
    expect(poseOnSegment(seg, 0)).toEqual(seg.from);
    expect(poseOnSegment(seg, 100)).toEqual(seg.from);
    expect(poseOnSegment(seg, 300)).toEqual(seg.to);
    expect(poseOnSegment(seg, 900)).toEqual(seg.to);
  });

  it("is at the midpoint at half the duration", () => {
    const p = poseOnSegment(seg, 200);
    expect(p.yaw).toBeCloseTo(2, 12);
    expect(p.pitch).toBeCloseTo(0, 12);
  });

  it("does not return NaN for a zero-length duration", () => {
    const z = { t0: 50, t1: 50, from: { yaw: 0, pitch: 0 }, to: { yaw: 1, pitch: 1 } };
    expect(poseOnSegment(z, 49)).toEqual(z.from);
    expect(poseOnSegment(z, 50)).toEqual(z.to);
  });
});
