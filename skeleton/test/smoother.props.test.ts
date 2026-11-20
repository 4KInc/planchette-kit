/**
 * Smoother properties (Task 6.4):
 *  - the output is always finite for any finite angle and any dt > 0;
 *  - cloneSmootherState produces identical subsequent output.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  createSmootherState,
  cloneSmootherState,
  stepSmoother,
} from '../src/engine/smoother';

const angleArb = fc.double({ noNaN: true, noDefaultInfinity: true }); // any finite double
const dtArb = fc.oneof(
  fc.double({ min: Number.MIN_VALUE, max: 1, noNaN: true }),
  fc.double({ min: 1, max: 1e300, noNaN: true }),
);
const strengthArb = fc.oneof(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ noNaN: true }));
const sampleArb = fc.record({ angle: angleArb, dt: dtArb, smoothingStrength: strengthArb });

describe('smoother output is always finite', () => {
  it('for any finite angles and any dt > 0', () => {
    fc.assert(
      fc.property(fc.array(sampleArb, { minLength: 1, maxLength: 200 }), (samples) => {
        const st = createSmootherState();
        for (const s of samples) {
          const out = stepSmoother(st, s);
          expect(Number.isFinite(out)).toBe(true);
          expect(Number.isFinite(st.prev)).toBe(true);
          expect(Number.isFinite(st.dPrev)).toBe(true);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('stays between the previous output and the new input (no overshoot)', () => {
    fc.assert(
      fc.property(fc.array(sampleArb, { minLength: 2, maxLength: 100 }), (samples) => {
        const st = createSmootherState();
        stepSmoother(st, samples[0]);
        for (const s of samples.slice(1)) {
          const before = st.prev;
          const out = stepSmoother(st, s);
          expect(out).toBeGreaterThanOrEqual(Math.min(before, s.angle));
          expect(out).toBeLessThanOrEqual(Math.max(before, s.angle));
        }
      }),
      { numRuns: 500 },
    );
  });
});

describe('cloneSmootherState', () => {
  it('a clone produces exactly the same subsequent output as the original', () => {
    fc.assert(
      fc.property(
        fc.array(sampleArb, { maxLength: 100 }),
        fc.array(sampleArb, { minLength: 1, maxLength: 100 }),
        (prefix, suffix) => {
          const st = createSmootherState();
          for (const s of prefix) stepSmoother(st, s);
          const copy = cloneSmootherState(st);
          expect(copy).toEqual(st);
          expect(copy).not.toBe(st);
          for (const s of suffix) {
            expect(Object.is(stepSmoother(copy, s), stepSmoother(st, s))).toBe(true);
          }
          expect(copy).toEqual(st);
        },
      ),
      { numRuns: 500 },
    );
  });
});
