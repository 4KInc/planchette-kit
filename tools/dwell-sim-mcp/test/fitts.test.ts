import { describe, expect, it } from "vitest";
import { MT_MIN, movementTimeMs, projectedWidth } from "../src/fitts.js";

describe("movementTimeMs", () => {
  it("matches 1000 × log2(A / W + 1) / TP for A = 400, W = 100, TP = 1.42", () => {
    expect(movementTimeMs(400, 100, 1.42)).toBeCloseTo((1000 * Math.log2(5)) / 1.42, 9);
    expect(movementTimeMs(400, 100, 1.42)).toBeCloseTo(1635.2, 1);
  });

  it("gives ID = 1 bit for A = W", () => {
    expect(movementTimeMs(100, 100, 2)).toBeCloseTo(500, 9);
  });

  it("floors a fast move at MT_MIN = 150 ms", () => {
    expect(MT_MIN).toBe(150);
    expect(movementTimeMs(1, 1000, 4)).toBe(150);
  });

  it("returns 0 when A < 0.5 px and a real move at A = 0.5 px", () => {
    expect(movementTimeMs(0, 100, 1.42)).toBe(0);
    expect(movementTimeMs(0.4999, 100, 1.42)).toBe(0);
    expect(movementTimeMs(0.5, 100, 1.42)).toBe(MT_MIN);
  });
});

describe("projectedWidth", () => {
  const rect = { width: 120, height: 40 };
  it("is the width for a horizontal move and the height for a vertical move", () => {
    expect(projectedWidth(rect, -1, 0)).toBe(120);
    expect(projectedWidth(rect, 0, 1)).toBe(40);
  });
  it("combines both extents for a diagonal move", () => {
    const c = Math.SQRT1_2;
    expect(projectedWidth(rect, c, -c)).toBeCloseTo(160 * c, 9);
  });
});
