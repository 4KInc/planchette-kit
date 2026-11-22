import fc from "fast-check";
import { describe, it } from "vitest";
import { minJerk, poseOnSegment } from "../src/min-jerk.js";

const deg = fc.double({ min: -60, max: 60, noNaN: true });
const pose = fc.record({ yaw: deg, pitch: deg });

describe("min-jerk properties", () => {
  // **Validates: Requirements 2.2**
  it("s is monotone and within [0, 1] on [0, 1]", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          const slo = minJerk(lo);
          const shi = minJerk(hi);
          return slo >= -1e-12 && shi <= 1 + 1e-12 && slo <= shi + 1e-12;
        },
      ),
    );
  });

  // **Validates: Requirements 2.2**
  it("s is clamped outside [0, 1]", () => {
    fc.assert(
      fc.property(fc.double({ min: 1, max: 1e6, noNaN: true }), (x) => {
        return minJerk(x) === 1 && minJerk(-x) === 0;
      }),
    );
  });

  // **Validates: Requirements 2.2**
  it("position equals start + (aim - start) * s", () => {
    fc.assert(
      fc.property(
        pose,
        pose,
        fc.double({ min: 0, max: 1e5, noNaN: true }),
        fc.double({ min: 1, max: 5000, noNaN: true }),
        fc.double({ min: -1e4, max: 2e5, noNaN: true }),
        (from, to, t0, mt, t) => {
          const p = poseOnSegment({ t0, t1: t0 + mt, from, to }, t);
          const s = minJerk((t - t0) / mt);
          const ey = from.yaw + (to.yaw - from.yaw) * s;
          const ep = from.pitch + (to.pitch - from.pitch) * s;
          return Math.abs(p.yaw - ey) <= 1e-9 && Math.abs(p.pitch - ep) <= 1e-9;
        },
      ),
    );
  });
});
