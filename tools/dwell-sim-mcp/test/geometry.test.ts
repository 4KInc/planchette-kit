import { describe, expect, it } from "vitest";
import {
  angularWidth,
  clampToHeadRange,
  poseAtPx,
  toPose,
  toPx,
  type GeometryContext,
} from "../src/geometry.js";

const ctx: GeometryContext = {
  profile: {
    headGain: 1,
    headDeadZone: 0.5,
    calibrationRangeLeft: 15,
    calibrationRangeRight: 15,
    calibrationRangeUp: 15,
    calibrationRangeDown: 15,
  },
  screen: { width: 1000, height: 800 },
  headRange: { left: 10, right: 12, up: 8, down: 6 },
};

describe("geometry", () => {
  it("maps the extreme calibrated rotations to the screen edges", () => {
    expect(toPx(ctx, { yaw: 15, pitch: 15 })).toEqual({ x: 999, y: 0 });
    expect(toPx(ctx, { yaw: -15, pitch: -15 })).toEqual({ x: 0, y: 799 });
  });

  it("maps the zero pose to the screen centre within 1 px", () => {
    const p = toPx(ctx, { yaw: 0, pitch: 0 });
    expect(Math.abs(p.x - 499.5)).toBeLessThanOrEqual(1);
    expect(Math.abs(p.y - 399.5)).toBeLessThanOrEqual(1);
  });

  it("toPose is the inverse of toPx at the screen edges", () => {
    expect(toPose(ctx, { x: 999, y: 0 })).toEqual({ yaw: 15, pitch: 15 });
    const low = toPose(ctx, { x: 0, y: 799 });
    expect(low.yaw).toBeCloseTo(-15, 9);
    expect(low.pitch).toBeCloseTo(-15, 9);
  });

  it("clamps each direction to its own head range", () => {
    expect(clampToHeadRange(ctx.headRange, { yaw: 50, pitch: 50 })).toEqual({ yaw: 12, pitch: 8 });
    expect(clampToHeadRange(ctx.headRange, { yaw: -50, pitch: -50 })).toEqual({ yaw: -10, pitch: -6 });
    expect(clampToHeadRange(ctx.headRange, { yaw: 3, pitch: -2 })).toEqual({ yaw: 3, pitch: -2 });
  });

  it("poseAtPx limits the pose to the head range", () => {
    expect(poseAtPx(ctx, { x: 999, y: 0 })).toEqual({ yaw: 12, pitch: 8 });
    expect(poseAtPx(ctx, { x: 0, y: 799 })).toEqual({ yaw: -10, pitch: -6 });
  });

  it("angularWidth of the whole screen is the full calibrated span", () => {
    const rect = { x: 0, y: 0, width: 999, height: 799 };
    expect(angularWidth(ctx, rect, "x")).toBeCloseTo(30, 9);
    expect(angularWidth(ctx, rect, "y")).toBeCloseTo(30, 9);
  });

  it("angularWidth of a rectangle spanning the dead zone includes the extra 2D", () => {
    // Pixels 400..599 straddle the centre, so the head turns the dead zone twice-over (2 × 0.5°).
    const spanning = angularWidth(ctx, { x: 400, y: 100, width: 199, height: 50 }, "x");
    const linear = angularWidth(ctx, { x: 700, y: 100, width: 199, height: 50 }, "x");
    expect(spanning).toBeCloseTo(linear + 1, 6);
  });
});
