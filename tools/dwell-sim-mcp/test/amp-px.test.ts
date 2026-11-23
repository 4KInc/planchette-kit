import { describe, expect, it } from "vitest";
import { ampPx, tremorOrNoiseOn, type AmpUser } from "../src/amp-px.js";
import type { GeometryContext } from "../src/geometry.js";
import { profile } from "./classify-fixtures.js";

/** 1001 x 501 px: 25 px per degree on x, 12.5 px per degree on y (gain 1, no dead zone, range 20). */
const wide: GeometryContext = {
  profile,
  screen: { width: 1001, height: 501 },
  headRange: { left: 20, right: 20, up: 20, down: 20 },
  centre: { yaw: 0, pitch: 0 },
};
const off: AmpUser = {
  tremorFrequencyHz: 0,
  tremorPeakToPeakDeg: 0,
  tremorDriftFraction: 0.2,
  tremorAxis: "yaw",
  trackingNoiseDeg: 0,
};
const centre = { yaw: 0, pitch: 0 };

describe("ampPx", () => {
  it("tremor only: aT = a0 (1 + drift) / 2 on the tremor axis, plus 1 px", () => {
    // a0 = 2, drift 0.2: aT = 1.2 deg = 30 px on x
    expect(ampPx(wide, { ...off, tremorFrequencyHz: 5, tremorPeakToPeakDeg: 2 }, centre)).toBe(31);
  });
  it("noise only: n on both axes, Euclidean, plus 1 px", () => {
    // n = 0.4 deg: 10 px on x, 5 px on y
    expect(ampPx(wide, { ...off, trackingNoiseDeg: 0.4 }, centre)).toBeCloseTo(Math.hypot(10, 5) + 1, 9);
  });
  it("tremor and noise add in degrees before the mapping", () => {
    const u: AmpUser = { ...off, tremorFrequencyHz: 5, tremorPeakToPeakDeg: 2, trackingNoiseDeg: 0.4 };
    // yaw 1.2 + 0.4 = 1.6 deg = 40 px; pitch 0.4 deg = 5 px
    expect(ampPx(wide, u, centre)).toBeCloseTo(Math.hypot(40, 5) + 1, 9);
  });
  it("tremor adds only on tremorAxis, noise on both", () => {
    const base: AmpUser = { ...off, tremorFrequencyHz: 5, tremorPeakToPeakDeg: 2, trackingNoiseDeg: 0.4 };
    const yaw = ampPx(wide, { ...base, tremorAxis: "yaw" }, centre);
    const pitch = ampPx(wide, { ...base, tremorAxis: "pitch" }, centre);
    expect(yaw).toBeCloseTo(Math.hypot(40, 5) + 1, 9);
    // pitch 1.6 deg = 20 px; yaw 0.4 deg = 10 px
    expect(pitch).toBeCloseTo(Math.hypot(10, 20) + 1, 9);
    expect(yaw).not.toBe(pitch);
    // tremor alone on the pitch axis reaches only 15 px on this screen
    expect(ampPx(wide, { ...off, tremorFrequencyHz: 5, tremorPeakToPeakDeg: 2, tremorAxis: "pitch" }, centre)).toBe(16);
  });
  it("a0 > 0 with f = 0 and n = 0 is off: aT is 0 and the result is 1 px", () => {
    const u = { ...off, tremorPeakToPeakDeg: 2 };
    expect(tremorOrNoiseOn(u)).toBe(false);
    expect(ampPx(wide, u, centre)).toBe(1);
    expect(tremorOrNoiseOn({ ...off, tremorFrequencyHz: 5 })).toBe(false);
  });
  it("tremorOrNoiseOn is (a0 > 0 && f > 0) || n > 0", () => {
    expect(tremorOrNoiseOn({ ...off, tremorPeakToPeakDeg: 1, tremorFrequencyHz: 4 })).toBe(true);
    expect(tremorOrNoiseOn({ ...off, trackingNoiseDeg: 0.01 })).toBe(true);
    expect(tremorOrNoiseOn(off)).toBe(false);
  });
  it("at the screen edge the clamp makes it smaller", () => {
    const u = { ...off, tremorFrequencyHz: 5, tremorPeakToPeakDeg: 1 }; // 15 px on x
    expect(ampPx(wide, u, centre)).toBe(16);
    // 0.1 deg inside the edge: the minus corner is not clamped, so the maximum is still 15 px
    expect(ampPx(wide, u, { yaw: 19.9, pitch: 0 })).toBe(16);
    // beyond the calibrated range both corners clamp to the last pixel: no reach, only the 1 px
    expect(ampPx(wide, u, { yaw: 30, pitch: 0 })).toBe(1);
  });
  it("in the dead zone the pointer does not move: only the 1 px remains", () => {
    const dz: GeometryContext = { ...wide, profile: { ...profile, headDeadZone: 2 } };
    const u = { ...off, tremorFrequencyHz: 5, tremorPeakToPeakDeg: 1 }; // 0.6 deg
    expect(ampPx(dz, u, centre)).toBe(1);
    expect(ampPx(dz, u, { yaw: 1, pitch: 0 })).toBe(1);
    // at the dead zone edge the plus corner leaves it: 0.6 deg past 2 deg = 500 x 0.6 / 18 = 16.7 px -> 517
    expect(ampPx(dz, u, { yaw: 2, pitch: 0 })).toBe(18);
  });
});
