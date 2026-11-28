import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { KEY_SEANCE, readSeanceProfile, resolveInitialProfile } from '../src/seance-storage';
import { MemoryStorage } from './memory-storage';
describe('Feature: seance, Property 12: corrupt storage never throws', () => {
  it('any stored string reads without throwing and yields a usable profile', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.json(), fc.json().map((j) => j.slice(0, Math.max(0, j.length - 1))), fc.constant('{"version":1,"profile":{"dwellTime":"x"}}')),
        (raw) => {
          const s = new MemoryStorage();
          s.setItem(KEY_SEANCE, raw);
          const r = readSeanceProfile(s);
          expect(typeof r.profile).toBe('object');
          expect(typeof resolveInitialProfile(r)).toBe('object');
        },
      ),
      { numRuns: 300 },
    );
  });
});
