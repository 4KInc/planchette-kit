import fc from "fast-check";
import { describe, it } from "vitest";
import {
  angularWidth,
  clampToHeadRange,
  toPose,
  toPx,
  type GeometryContext,
} from "../src/geometry.js";

const range = fc.double({ min: 3, max: 90, noNaN: true });

/** A mapping profile as clampProfile would accept it: gain in [1, 2], dead zone <= 0.5 x min range. */
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

const pose = fc.record({
  yaw: fc.double({ min: -500, max: 500, noNaN: true }),
  pitch: fc.double({ min: -500, max: 500, noNaN: true }),
});

describe("geometry properties", () => {
  // **Validates: Requirements 2.4**
  it("clampToHeadRange keeps every pose inside the head range, per direction", () => {
    fc.assert(
      fc.property(contextArb, pose, ({ headRange: h }, p) => {
        const c = clampToHeadRange(h, p);
        const inside = c.yaw >= -h.left && c.yaw <= h.right && c.pitch >= -h.down && c.pitch <= h.up;
        const unchangedWhenInside =
          p.yaw < -h.left || p.yaw > h.right || p.pitch < -h.down || p.pitch > h.up
            ? true
            : c.yaw === p.yaw && c.pitch === p.pitch;
        return inside && unchangedWhenInside;
      }),
    );
  });

  // **Validates: Requirements 1.1, 9.1**
  it("toPx(toPose(p)) is within 1 px of p for points on the screen", () => {
    fc.assert(
      fc.property(
        contextArb,
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (ctx, fx, fy) => {
          const p = { x: fx * (ctx.screen.width - 1), y: fy * (ctx.screen.height - 1) };
          const q = toPx(ctx, toPose(ctx, p));
          return Math.abs(q.x - p.x) <= 1 && Math.abs(q.y - p.y) <= 1;
        },
      ),
    );
  });

  // **Validates: Requirements 1.1**
  it("angularWidth is positive for any rectangle at least 1 px wide inside the screen", () => {
    fc.assert(
      fc.property(
        contextArb,
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (ctx, a, b, c, d) => {
          const maxX = ctx.screen.width - 1;
          const maxY = ctx.screen.height - 1;
          const x = a * (maxX - 1);
          const y = b * (maxY - 1);
          const rect = {
            x,
            y,
            width: 1 + c * (maxX - x - 1),
            height: 1 + d * (maxY - y - 1),
          };
          return angularWidth(ctx, rect, "x") > 0 && angularWidth(ctx, rect, "y") > 0;
        },
      ),
    );
  });
});
