import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SEANCE_CONFIG, cloneSupport, createSupport, stepSupport, type SupportEvent, type SupportInput } from '../src/support';
const dwellArb = fc.integer({ min: 400, max: 3000 });
const inputArb: fc.Arbitrary<SupportInput> = fc.oneof(
  { weight: 4, arbitrary: fc.constant<SupportInput>({ type: 'hit' }) },
  { weight: 3, arbitrary: dwellArb.map((dwellMs): SupportInput => ({ type: 'miss', dwellMs })) },
  { weight: 1, arbitrary: dwellArb.map((dwellMs): SupportInput => ({ type: 'miss', dwellMs, dwellApplies: false })) },
  { weight: 1, arbitrary: fc.constant<SupportInput>({ type: 'round-start' }) },
  { weight: 1, arbitrary: fc.constant<SupportInput>({ type: 'accept' }) },
  { weight: 1, arbitrary: fc.constant<SupportInput>({ type: 'dismiss' }) },
  { weight: 1, arbitrary: fc.constant<SupportInput>({ type: 'round-end' }) },
);
const seqArb = fc.array(inputArb, { maxLength: 80 });
describe('Feature: seance, Property 4: A Miss never lowers the Support level', () => {
  it('holds over any sequence', () => {
    fc.assert(
      fc.property(seqArb, (seq) => {
        const s = createSupport();
        for (const input of seq) {
          const before = s.level;
          stepSupport(s, input, 0);
          if (input.type === 'miss') expect(s.level).toBeGreaterThanOrEqual(before);
        }
      }),
      { numRuns: 300 },
    );
  });
});
describe('Feature: seance, Property 5: Support falls only on calm Hits', () => {
  it('stays in 0..2 and decreases only on a Hit that completes the streak, by exactly 1', () => {
    fc.assert(
      fc.property(seqArb, (seq) => {
        const s = createSupport();
        for (const input of seq) {
          const before = cloneSupport(s);
          stepSupport(s, input, 0);
          expect(s.level).toBeGreaterThanOrEqual(0);
          expect(s.level).toBeLessThanOrEqual(2);
          if (s.level < before.level) {
            expect(input.type).toBe('hit');
            expect(before.hitStreak + 1).toBeGreaterThanOrEqual(SEANCE_CONFIG.calmAfterHits);
            expect(before.level - s.level).toBe(1);
          }
        }
      }),
      { numRuns: 300 },
    );
  });
});
describe('Feature: seance, Property 6: Suggestions are safe', () => {
  it('is above the dwell, in range, on the step, once per Round, and applied only after accept', () => {
    fc.assert(
      fc.property(seqArb, (seq) => {
        const s = createSupport();
        let offers = 0;
        let lastDwell = 400;
        for (const input of seq) {
          const open = s.suggestion;
          if (input.type === 'miss') lastDwell = input.dwellMs;
          if (input.type === 'round-start') offers = 0;
          const events: SupportEvent[] = stepSupport(s, input, 0);
          for (const e of events) {
            if (e.type === 'suggest') {
              expect(input.type === 'miss' && input.dwellApplies !== false).toBe(true);
              offers++;
              expect(e.ms).toBeGreaterThan(lastDwell);
              expect(e.ms).toBeLessThanOrEqual(SEANCE_CONFIG.dwellMaxMs);
              expect(e.ms % SEANCE_CONFIG.dwellStepMs).toBe(0);
            }
            if (e.type === 'apply-dwell') {
              expect(input.type).toBe('accept');
              expect(open).not.toBeNull();
              expect(e.ms).toBe(open!.ms);
            }
          }
          expect(offers).toBeLessThanOrEqual(1);
          if (input.type === 'round-end') expect(s.suggestion).toBeNull();
          if (input.type !== 'accept') expect(events.some((e) => e.type === 'apply-dwell')).toBe(false);
        }
      }),
      { numRuns: 300 },
    );
  });
});
