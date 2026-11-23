import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { GeometryContext } from "../src/geometry.js";
import { Purpose, stream, type Stream } from "../src/rng.js";
import { PHI_3, PHI_MINUS_3, probit, sampleAim, ttn } from "../src/scatter.js";

const SQRT_2PI = Math.sqrt(2 * Math.PI);
const pdf = (x: number): number => Math.exp(-0.5 * x * x) / SQRT_2PI;

/**
 * Φ(x) - 1/2, independent of `probit`. For |x| <= 1.5 it sums the series
 * φ(x) × Σ x^(2n+1) / (1·3·…·(2n+1)) (all terms positive, 200 terms, relative error ~1e-16).
 * Beyond that it takes 1/2 minus the upper tail from the Mills-ratio continued fraction
 * Q(a) = φ(a) / (a + 1/(a + 2/(a + 3/(a + …)))), evaluated backwards from 600 levels
 * (relative error below 1e-14 for a >= 1.5). Working with Φ - 1/2 keeps the accuracy near x = 0.
 */
function cdfMinusHalf(x: number): number {
  const a = Math.abs(x);
  let v: number;
  if (a <= 1.5) {
    let term = a;
    let sum = a;
    for (let n = 1; n < 200; n++) {
      term *= (a * a) / (2 * n + 1);
      sum += term;
    }
    v = pdf(a) * sum;
  } else {
    let f = a;
    for (let n = 600; n >= 1; n--) f = a + n / f;
    v = 0.5 - pdf(a) / f;
  }
  return x < 0 ? -v : v;
}

/** Solves Φ(x) = p: 200 bisection steps on [-10, 10], then 3 Newton steps. Accurate to ~1e-13. */
function referenceQuantile(p: number): number {
  const target = p - 0.5;
  let lo = -10;
  let hi = 10;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (cdfMinusHalf(mid) < target) lo = mid;
    else hi = mid;
  }
  let x = (lo + hi) / 2;
  for (let i = 0; i < 3; i++) x -= (cdfMinusHalf(x) - target) / pdf(x);
  return x;
}

const ctx: GeometryContext = {
  profile: {
    headGain: 1.3,
    headDeadZone: 1,
    calibrationRangeLeft: 20,
    calibrationRangeRight: 25,
    calibrationRangeUp: 15,
    calibrationRangeDown: 18,
  },
  screen: { width: 1200, height: 900 },
  headRange: { left: 90, right: 90, up: 90, down: 90 },
  centre: { yaw: 0, pitch: 0 },
};

const seedArb = fc.integer({ min: -2147483648, max: 2147483647 });
const u = fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true });

describe("scatter properties", () => {
  // **Validates: Requirements 11.2**
  it("probit has max relative error <= 1.2e-9 over [Φ(-3), Φ(3)] against a Newton-refined inverse", () => {
    fc.assert(
      fc.property(fc.double({ min: PHI_MINUS_3, max: PHI_3, noNaN: true }), (p) => {
        const ref = referenceQuantile(p);
        const got = probit(p);
        return Math.abs(got - ref) <= 1.2e-9 * Math.abs(ref) + 1e-12;
      }),
      { numRuns: 500 },
    );
  });

  // **Validates: Requirements 11.2**
  it("|z| < 3 for every u in [0, 1)", () => {
    fc.assert(fc.property(u, (x) => Math.abs(ttn(x)) < 3));
  });

  // **Validates: Requirements 6.3, 11.2**
  it("sampleAim reads exactly two draws, keyed (k, 0) and (k, 1)", () => {
    fc.assert(
      fc.property(seedArb, fc.integer({ min: 0, max: 1000 }), (seed, k) => {
        const real = stream(seed, 1, 2, Purpose.Aim);
        // u01 reads `seed` once per hash32 call and calls hash32 twice per draw.
        let reads = 0;
        const spy: Stream = {
          get seed(): number {
            reads++;
            return real.seed;
          },
        };
        const rect = { x: 500, y: 400, width: 100, height: 100 };
        const withSpy = sampleAim(ctx, rect, 0.6, spy, k);
        expect(reads).toBe(4);
        expect(withSpy).toEqual(sampleAim(ctx, rect, 0.6, real, k));
      }),
    );
  });

  // **Validates: Requirements 11.2**
  it("axis offsets are independent: the yaw offset ignores the height and the pitch offset ignores the width", () => {
    fc.assert(
      fc.property(
        seedArb,
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 4, max: 400 }),
        fc.integer({ min: 4, max: 400 }),
        fc.integer({ min: 4, max: 400 }),
        fc.integer({ min: 4, max: 400 }),
        (seed, k, w, h1, w2, h2) => {
          const s = stream(seed, 3, 0, Purpose.Aim);
          const centre = { x: 600, y: 450 };
          const r = (width: number, height: number) => ({
            x: centre.x - width / 2,
            y: centre.y - height / 2,
            width,
            height,
          });
          const a = sampleAim(ctx, r(w, h1), 0.6, s, k);
          const b = sampleAim(ctx, r(w, h2), 0.6, s, k);
          const c = sampleAim(ctx, r(w2, h1), 0.6, s, k);
          return a.yaw === b.yaw && a.pitch === c.pitch;
        },
      ),
    );
  });
});
