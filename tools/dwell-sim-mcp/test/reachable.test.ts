import { describe, expect, it } from "vitest";
import type { GeometryContext } from "../src/geometry.js";
import { isTargetReachable, reachableRect } from "../src/reachable.js";

function ctx(headRange: number, calibration: number): GeometryContext {
  return {
    profile: {
      headGain: 1,
      headDeadZone: 0,
      calibrationRangeLeft: calibration,
      calibrationRangeRight: calibration,
      calibrationRangeUp: calibration,
      calibrationRangeDown: calibration,
    },
    screen: { width: 1001, height: 601 },
    headRange: { left: headRange, right: headRange, up: headRange, down: headRange },
    centre: { yaw: 0, pitch: 0 },
  };
}

describe("reachableRect", () => {
  it("is the whole screen when the head range equals the calibration range", () => {
    expect(reachableRect(ctx(10, 10))).toEqual({ xMin: 0, xMax: 1000, yMin: 0, yMax: 600 });
  });

  it("is the whole screen when the head range is larger than the calibration range", () => {
    expect(reachableRect(ctx(20, 10))).toEqual({ xMin: 0, xMax: 1000, yMin: 0, yMax: 600 });
  });

  it("shrinks around the centre when the head range is half the calibration range", () => {
    expect(reachableRect(ctx(5, 10))).toEqual({ xMin: 250, xMax: 750, yMin: 150, yMax: 450 });
  });
});

describe("isTargetReachable", () => {
  const c = ctx(5, 10); // reachable: x 250..750, y 150..450

  it("accepts a target inside the rectangle", () => {
    expect(isTargetReachable(c, { x: 400, y: 250, width: 100, height: 50 })).toBe(true);
  });

  it("rejects a target fully beyond the rectangle", () => {
    expect(isTargetReachable(c, { x: 0, y: 250, width: 100, height: 50 })).toBe(false);
    expect(isTargetReachable(c, { x: 400, y: 500, width: 100, height: 50 })).toBe(false);
  });

  it("accepts a target that only partly overlaps", () => {
    expect(isTargetReachable(c, { x: 200, y: 250, width: 100, height: 50 })).toBe(true);
  });

  it("uses a half-open target rectangle: the pixel at x + width is not part of it", () => {
    expect(isTargetReachable(c, { x: 150, y: 250, width: 100, height: 50 })).toBe(false); // pixels 150..249
    expect(isTargetReachable(c, { x: 150, y: 250, width: 101, height: 50 })).toBe(true); // reaches 250
    expect(isTargetReachable(c, { x: 750, y: 250, width: 50, height: 50 })).toBe(true); // pixel 750
    expect(isTargetReachable(c, { x: 751, y: 250, width: 50, height: 50 })).toBe(false);
  });

  it("rejects an empty rectangle", () => {
    expect(isTargetReachable(c, { x: 400, y: 250, width: 0, height: 50 })).toBe(false);
  });

  it("accepts every on-screen target when nothing is clipped", () => {
    expect(isTargetReachable(ctx(10, 10), { x: 0, y: 0, width: 1, height: 1 })).toBe(true);
    expect(isTargetReachable(ctx(10, 10), { x: 1000, y: 600, width: 1, height: 1 })).toBe(true);
  });
});

describe("reachableRect with a captured centre (D2)", () => {
  it("maps the absolute head-range limits through the centre", () => {
    const base = ctx(5, 10);
    const shifted: GeometryContext = { ...base, centre: { yaw: 2, pitch: 0 } };
    // 1000 px over 20 degrees of calibrated range (gain 1, no dead zone): 50 px per degree.
    expect(reachableRect(shifted)).toEqual({ xMin: 150, xMax: 650, yMin: 150, yMax: 450 });
    expect(isTargetReachable(shifted, { x: 700, y: 250, width: 50, height: 50 })).toBe(false);
    expect(isTargetReachable(base, { x: 700, y: 250, width: 50, height: 50 })).toBe(true);
  });
});
