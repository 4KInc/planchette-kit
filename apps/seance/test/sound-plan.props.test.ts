import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SOUND_LIMITS, planSound, type SoundEvent } from '../src/sound-plan';
describe('Feature: seance, Property 15: Sound plans stay inside the limits', () => {
  it('holds for any event and times', () => {
    fc.assert(
      fc.property(fc.constantFrom<SoundEvent>('hit', 'complete'), fc.double({ min: -10, max: 1000, noNaN: true }), fc.double({ min: 0, max: 1000, noNaN: true }), (event, last, now) => {
        const tones = planSound(event, last, now);
        let prevEnd = last;
        for (const t of tones) {
          expect(t.gain).toBeLessThanOrEqual(SOUND_LIMITS.maxGain);
          expect(t.gain).toBeGreaterThan(0);
          expect(t.durS).toBeLessThanOrEqual(SOUND_LIMITS.maxToneS);
          expect(t.durS).toBeGreaterThanOrEqual(2 * SOUND_LIMITS.minFadeS);
          expect(t.startS).toBeGreaterThanOrEqual(prevEnd + SOUND_LIMITS.minGapS - 1e-9);
          prevEnd = t.startS + t.durS;
        }
      }),
      { numRuns: 300 },
    );
  });
});
