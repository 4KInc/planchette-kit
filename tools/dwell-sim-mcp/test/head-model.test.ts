import { describe, expect, it } from "vitest";
import { createHeadModel, type HeadStreams, type HeadUser } from "../src/head-model.js";
import type { Segment } from "../src/plan-entry.js";
import { Purpose, stream } from "../src/rng.js";

const streams = (seed = 1): HeadStreams => ({
  phase: stream(seed, 7, 0, Purpose.TremorPhase),
  drift: stream(seed, 7, 0, Purpose.TremorDriftKnot),
  noise: stream(seed, 7, 0, Purpose.TrackingNoise),
});

const user: HeadUser = {
  tremorFrequencyHz: 5,
  tremorPeakToPeakDeg: 1,
  tremorDriftFraction: 0.2,
  tremorAxis: "yaw",
  trackingNoiseDeg: 0.1,
  headRangeDeg: { left: 30, right: 30, up: 20, down: 20 },
};
const still: HeadUser = { ...user, tremorPeakToPeakDeg: 0, trackingNoiseDeg: 0 };

const segments: Segment[] = [
  { kind: "hold", t0: 0, t1: 200, pose: { yaw: 1, pitch: 2 }, phase: "waiting" },
  { kind: "move", t0: 200, t1: 600, from: { yaw: 1, pitch: 2 }, to: { yaw: 11, pitch: -4 }, phase: "moving" },
  { kind: "hold", t0: 600, t1: 1000, pose: { yaw: 11, pitch: -4 }, phase: "holding" },
];
const plan = { segments };

describe("head model", () => {
  it("basePose follows hold, move and final hold", () => {
    const m = createHeadModel(user, streams());
    expect({ ...m.basePose(plan, 100) }).toEqual({ yaw: 1, pitch: 2 });
    expect(m.basePose(plan, 400).yaw).toBeCloseTo(6, 9);
    expect({ ...m.basePose(plan, 5000) }).toEqual({ yaw: 11, pitch: -4 });
  });

  it("with tremor and noise off, head equals basePose", () => {
    const m = createHeadModel(still, streams());
    for (const t of [0, 250, 400, 599, 700, 2000]) {
      const b = { ...m.basePose(plan, t) };
      expect({ ...m.head(plan, t) }).toEqual(b);
    }
  });

  it("noise is within ±n per axis when tremor is off", () => {
    const m = createHeadModel({ ...still, trackingNoiseDeg: 0.3 }, streams());
    for (let t = 0; t < 1000; t += 33) {
      const b = { ...m.basePose(plan, t) };
      const h = m.head(plan, t);
      expect(Math.abs(h.yaw - b.yaw)).toBeLessThanOrEqual(0.3);
      expect(Math.abs(h.pitch - b.pitch)).toBeLessThanOrEqual(0.3);
    }
  });

  it("tremor goes on pitch when tremorAxis is pitch", () => {
    const quiet = { ...user, trackingNoiseDeg: 0 };
    const y = createHeadModel(quiet, streams());
    const p = createHeadModel({ ...quiet, tremorAxis: "pitch" }, streams());
    const t = 123;
    const b = { ...y.basePose(plan, t) };
    const hy = { ...y.head(plan, t) };
    const hp = { ...p.head(plan, t) };
    expect(hy.pitch).toBe(b.pitch);
    expect(hp.yaw).toBe(b.yaw);
    expect(hy.yaw - b.yaw).toBeCloseTo(hp.pitch - b.pitch, 12);
    expect(hy.yaw).not.toBe(b.yaw);
  });

  it("clamps to the head range", () => {
    const far: Segment[] = [{ kind: "hold", t0: 0, t1: 100, pose: { yaw: 99, pitch: -99 }, phase: "holding" }];
    const h = createHeadModel(still, streams()).head({ segments: far }, 50);
    expect({ ...h }).toEqual({ yaw: 30, pitch: -20 });
  });

  it("an empty plan is at the centre pose", () => {
    const h = createHeadModel(still, streams()).head({ segments: [] }, 10);
    expect({ ...h }).toEqual({ yaw: 0, pitch: 0 });
  });

  it("going back in time or switching plans gives the same value as a fresh model", () => {
    const m = createHeadModel(user, streams());
    const other = { segments: [{ kind: "hold", t0: 0, t1: 50, pose: { yaw: -3, pitch: 3 }, phase: "holding" } as Segment] };
    m.head(plan, 900);
    m.head(other, 10);
    const again = { ...m.head(plan, 300) };
    expect(again).toEqual({ ...createHeadModel(user, streams()).head(plan, 300) });
  });
});
