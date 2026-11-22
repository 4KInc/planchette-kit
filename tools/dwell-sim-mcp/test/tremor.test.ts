import { describe, expect, it } from "vitest";
import { Purpose, stream, u01 } from "../src/rng.js";
import { tremorDrift, tremorOffset, tremorSize } from "../src/tremor.js";

const params = { tremorFrequencyHz: 4.25, tremorPeakToPeakDeg: 0.46, tremorDriftFraction: 0.2 };
const streams = {
  phase: stream(1, 7, 0, Purpose.TremorPhase),
  drift: stream(1, 7, 0, Purpose.TremorDriftKnot),
};

describe("tremorOffset", () => {
  it("follows (a/2) sin(2 pi f t / 1000 + phi) with phi and the knots from their own streams", () => {
    const phi = 2 * Math.PI * u01(streams.phase, 0);
    const t = 2500;
    const d = (2 * u01(streams.drift, 0) - 1) * 0.5 + (2 * u01(streams.drift, 1) - 1) * 0.5; // smoothstep(0.5) = 0.5
    const a = 0.46 * (1 + 0.2 * d);
    expect(tremorOffset(t, params, streams)).toBeCloseTo((a / 2) * Math.sin((2 * Math.PI * 4.25 * t) / 1000 + phi), 12);
  });

  it("drift equals the knot value at a knot time", () => {
    expect(tremorDrift(5000, streams.drift)).toBeCloseTo(2 * u01(streams.drift, 1) - 1, 12);
    expect(tremorDrift(0, streams.drift)).toBeCloseTo(2 * u01(streams.drift, 0) - 1, 12);
  });

  it("is exactly 0 with size 0 or frequency 0", () => {
    expect(tremorOffset(1234, { ...params, tremorPeakToPeakDeg: 0 }, streams)).toBe(0);
    expect(tremorOffset(1234, { ...params, tremorFrequencyHz: 0 }, streams)).toBe(0);
  });

  it("repeated calls give the same value", () => {
    expect(tremorOffset(777, params, streams)).toBe(tremorOffset(777, params, streams));
  });

  it("another trial gives another phase", () => {
    const other = { ...streams, phase: stream(1, 7, 1, Purpose.TremorPhase) };
    expect(tremorOffset(100, params, other)).not.toBe(tremorOffset(100, params, streams));
  });

  it("size stays within 20 % of a0 over a long run", () => {
    for (let t = 0; t < 120000; t += 137) {
      const a = tremorSize(t, params, streams);
      expect(a).toBeGreaterThanOrEqual(0.8 * 0.46 - 1e-12);
      expect(a).toBeLessThanOrEqual(1.2 * 0.46 + 1e-12);
    }
  });
});
