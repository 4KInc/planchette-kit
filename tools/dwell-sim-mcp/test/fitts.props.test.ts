import fc from "fast-check";
import { describe, it } from "vitest";
import { MT_MIN, movementTimeMs } from "../src/fitts.js";

const dist = fc.double({ min: 0.5, max: 5000, noNaN: true });
const width = fc.double({ min: 1, max: 2000, noNaN: true });
const tp = fc.double({ min: 0.3, max: 4, noNaN: true });

describe("fitts-mt properties", () => {
  // **Validates: Requirements 2.1**
  it("MT is non-decreasing in A", () => {
    fc.assert(
      fc.property(dist, dist, width, tp, (a, b, w, t) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        return movementTimeMs(lo, w, t) <= movementTimeMs(hi, w, t);
      }),
    );
  });

  // **Validates: Requirements 2.1**
  it("MT is non-increasing in W", () => {
    fc.assert(
      fc.property(dist, width, width, tp, (a, w1, w2, t) => {
        const [lo, hi] = w1 <= w2 ? [w1, w2] : [w2, w1];
        return movementTimeMs(a, hi, t) <= movementTimeMs(a, lo, t);
      }),
    );
  });

  // **Validates: Requirements 2.1**
  it("MT is non-increasing in TP", () => {
    fc.assert(
      fc.property(dist, width, tp, tp, (a, w, t1, t2) => {
        const [lo, hi] = t1 <= t2 ? [t1, t2] : [t2, t1];
        return movementTimeMs(a, w, hi) <= movementTimeMs(a, w, lo);
      }),
    );
  });

  // **Validates: Requirements 2.1**
  it("a real move is never shorter than MT_MIN", () => {
    fc.assert(fc.property(dist, width, tp, (a, w, t) => movementTimeMs(a, w, t) >= MT_MIN));
  });

  // **Validates: Requirements 2.1**
  it("there is no movement when A < 0.5 px", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 0.5, noNaN: true, maxExcluded: true }),
        width,
        tp,
        (a, w, t) => movementTimeMs(a, w, t) === 0,
      ),
    );
  });
});
