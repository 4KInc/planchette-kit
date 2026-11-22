import fc from "fast-check";
import { describe, it } from "vitest";
import type { GeometryContext } from "../src/geometry.js";
import { isTargetReachable, reachableRect } from "../src/reachable.js";

const range = fc.double({ min: 3, max: 90, noNaN: true });

const contextArb: fc.Arbitrary<GeometryContext> = fc
  .record({
    l: range,
    r: range,
    u: range,
    d: range,
    gain: fc.double({ min: 1, max: 2, noNaN: true }),
    dzFraction: fc.double({ min: 0, max: 0.5, noNaN: true }),
    width: fc.integer({ min: 100, max: 4000 }),
    height: fc.integer({ min: 100, max: 3000 }),
    hl: range,
    hr: range,
    hu: range,
    hd: range,
  })
  .map((v) => ({
    profile: {
      headGain: v.gain,
      headDeadZone: v.dzFraction * Math.min(v.l, v.r, v.u, v.d),
      calibrationRangeLeft: v.l,
      calibrationRangeRight: v.r,
      calibrationRangeUp: v.u,
      calibrationRangeDown: v.d,
    },
    screen: { width: v.width, height: v.height },
    headRange: { left: v.hl, right: v.hr, up: v.hu, down: v.hd },
  }));

/** A context whose head range is at least the calibration range in every direction. */
const wideHeadArb: fc.Arbitrary<GeometryContext> = fc
  .tuple(contextArb, fc.double({ min: 0, max: 20, noNaN: true }))
  .map(([c, extra]) => ({
    ...c,
    headRange: {
      left: c.profile.calibrationRangeLeft + extra,
      right: c.profile.calibrationRangeRight + extra,
      up: c.profile.calibrationRangeUp + extra,
      down: c.profile.calibrationRangeDown + extra,
    },
  }));

const unit = fc.double({ min: 0, max: 1, noNaN: true });

describe("reachable properties", () => {
  // **Validates: Requirements 11.12**
  it("the reachable rectangle is the whole screen when no calibration range exceeds the head range", () => {
    fc.assert(
      fc.property(wideHeadArb, (ctx) => {
        const r = reachableRect(ctx);
        return (
          r.xMin === 0 &&
          r.yMin === 0 &&
          r.xMax === ctx.screen.width - 1 &&
          r.yMax === ctx.screen.height - 1
        );
      }),
    );
  });

  // **Validates: Requirements 6.3, 11.2**
  it("a target fully beyond the rectangle is unreachable and one inside it is reachable", () => {
    fc.assert(
      fc.property(contextArb, unit, unit, (ctx, fx, fy) => {
        const r = reachableRect(ctx);
        const inside = {
          x: Math.round(r.xMin + fx * (r.xMax - r.xMin)),
          y: Math.round(r.yMin + fy * (r.yMax - r.yMin)),
          width: 1,
          height: 1,
        };
        if (!isTargetReachable(ctx, inside)) return false;
        const rightOf = { x: r.xMax + 1, y: inside.y, width: 50, height: 10 };
        const leftOf = { x: r.xMin - 50, y: inside.y, width: 50, height: 10 };
        const below = { x: inside.x, y: r.yMax + 1, width: 10, height: 50 };
        const above = { x: inside.x, y: r.yMin - 50, width: 10, height: 50 };
        return ![rightOf, leftOf, below, above].some((t) => isTargetReachable(ctx, t));
      }),
    );
  });

  // **Validates: Requirements 11.2**
  it("a target that contains a reachable pixel is reachable, however far it extends", () => {
    fc.assert(
      fc.property(contextArb, unit, unit, unit, unit, (ctx, fx, fy, a, b) => {
        const r = reachableRect(ctx);
        const px = Math.round(r.xMin + fx * (r.xMax - r.xMin));
        const py = Math.round(r.yMin + fy * (r.yMax - r.yMin));
        const rect = {
          x: px - Math.floor(a * 500),
          y: py - Math.floor(b * 500),
          width: 1 + Math.floor(a * 500) + 3,
          height: 1 + Math.floor(b * 500) + 3,
        };
        return isTargetReachable(ctx, rect);
      }),
    );
  });
});
