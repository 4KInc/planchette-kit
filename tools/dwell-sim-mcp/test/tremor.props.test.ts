import fc from "fast-check";
import { describe, it } from "vitest";
import { Purpose, stream } from "../src/rng.js";
import { tremorOffset, tremorSize } from "../src/tremor.js";

const int32 = fc.integer({ min: -2147483648, max: 2147483647 });
const trialStreams = fc
  .record({ seed: int32, user: int32, trial: fc.integer({ min: 0, max: 1000 }) })
  .map(({ seed, user, trial }) => ({
    phase: stream(seed, user, trial, Purpose.TremorPhase),
    drift: stream(seed, user, trial, Purpose.TremorDriftKnot),
  }));
const params = fc.record({
  tremorFrequencyHz: fc.double({ min: 0.1, max: 15, noNaN: true }),
  tremorPeakToPeakDeg: fc.double({ min: 0.01, max: 5, noNaN: true }),
  tremorDriftFraction: fc.constant(0.2),
});
const time = fc.double({ min: 0, max: 600000, noNaN: true });

describe("tremor properties", () => {
  // **Validates: Requirements 2.3, 11.5**
  it("|offset| <= 0.6 a0", () => {
    fc.assert(
      fc.property(time, params, trialStreams, (t, p, s) => {
        return Math.abs(tremorOffset(t, p, s)) <= 0.6 * p.tremorPeakToPeakDeg + 1e-12;
      }),
    );
  });

  // **Validates: Requirements 2.3, 11.5**
  it("size stays within [0.8, 1.2] a0", () => {
    fc.assert(
      fc.property(time, params, trialStreams, (t, p, s) => {
        const a = tremorSize(t, p, s);
        const a0 = p.tremorPeakToPeakDeg;
        return a >= 0.8 * a0 - 1e-12 && a <= 1.2 * a0 + 1e-12;
      }),
    );
  });

  // **Validates: Requirements 2.3**
  it("size 0 or frequency 0 gives exactly 0", () => {
    fc.assert(
      fc.property(time, params, trialStreams, (t, p, s) => {
        return (
          tremorOffset(t, { ...p, tremorPeakToPeakDeg: 0 }, s) === 0 &&
          tremorOffset(t, { ...p, tremorFrequencyHz: 0 }, s) === 0
        );
      }),
    );
  });

  // **Validates: Requirements 11.5**
  it("the value at t does not depend on which other times were asked first", () => {
    fc.assert(
      fc.property(
        time,
        params,
        fc.record({ seed: int32, user: int32 }),
        fc.array(time, { maxLength: 20 }),
        (t, p, k, others) => {
          const mk = () => ({
            phase: stream(k.seed, k.user, 0, Purpose.TremorPhase),
            drift: stream(k.seed, k.user, 0, Purpose.TremorDriftKnot),
          });
          const fresh = tremorOffset(t, p, mk());
          const warmed = mk();
          for (const o of others) tremorOffset(o, p, warmed);
          return tremorOffset(t, p, warmed) === fresh;
        },
      ),
    );
  });

  // **Validates: Requirements 11.5**
  it("15 fps and 60 fps sampling read the same signal at shared instants", () => {
    fc.assert(
      fc.property(params, trialStreams, fc.integer({ min: 0, max: 600 }), (p, s, n) => {
        const t = (n * 1000) / 15; // an instant on the 15 fps grid
        const t60 = (n * 4 * 1000) / 60; // the same instant on the 60 fps grid
        return tremorOffset(t, p, s) === tremorOffset(t60, p, s);
      }),
    );
  });
});
