import fc from "fast-check";
import { describe, it } from "vitest";
import { Purpose, stream, u01 } from "../src/rng.js";

const int32 = fc.integer({ min: -2147483648, max: 2147483647 });
const purpose = fc.constantFrom(
  Purpose.Aim,
  Purpose.Reaction,
  Purpose.TremorPhase,
  Purpose.TremorDriftKnot,
  Purpose.ReadingPauseChance,
  Purpose.ReadingPauseLength,
  Purpose.TrackingNoise,
  Purpose.ScanLatePress,
  Purpose.TaskOrder,
  Purpose.Start,
);
const key = fc.record({
  seed: int32,
  user: int32,
  trial: fc.integer({ min: 0, max: 1000 }),
  purpose,
  k: int32,
  j: int32,
});

describe("rng properties", () => {
  // **Validates: Requirements 7.1, 7.4**
  it("u01 is in [0, 1) and is a pure function of its key", () => {
    fc.assert(
      fc.property(key, (c) => {
        const a = u01(stream(c.seed, c.user, c.trial, c.purpose), c.k, c.j);
        const b = u01(stream(c.seed, c.user, c.trial, c.purpose), c.k, c.j);
        return a === b && a >= 0 && a < 1;
      }),
    );
  });

  // **Validates: Requirements 7.1, 7.4**
  it("drawing other keys first never changes a draw", () => {
    fc.assert(
      fc.property(key, fc.array(key, { maxLength: 20 }), (c, others) => {
        const s = stream(c.seed, c.user, c.trial, c.purpose);
        const before = u01(s, c.k, c.j);
        for (const o of others) u01(stream(o.seed, o.user, o.trial, o.purpose), o.k, o.j);
        return u01(s, c.k, c.j) === before;
      }),
    );
  });

  // **Validates: Requirements 7.1, 7.4**
  it("two different streams do not give equal draw sequences", () => {
    fc.assert(
      fc.property(key, key, (a, b) => {
        fc.pre(
          a.seed !== b.seed || a.user !== b.user || a.trial !== b.trial || a.purpose !== b.purpose,
        );
        const sa = stream(a.seed, a.user, a.trial, a.purpose);
        const sb = stream(b.seed, b.user, b.trial, b.purpose);
        for (let k = 0; k < 8; k++) if (u01(sa, k) !== u01(sb, k)) return true;
        return false;
      }),
    );
  });
});
