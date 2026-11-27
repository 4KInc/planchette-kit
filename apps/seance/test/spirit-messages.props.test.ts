import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BOARD_TARGET_IDS } from './board-target-ids';
import { WORDS, messageFor, pickMessage } from '../src/spirit-messages';
const OFFENSIVE = new Set(
  (JSON.parse(readFileSync(resolve(import.meta.dirname, '../../board/data/offensive-words.json'), 'utf8')) as string[]).map((w) =>
    w.toLowerCase(),
  ),
);
describe('Feature: seance, Property 10: the list is valid', () => {
  it('every word is 3 to 6 letters, A to Z, unique, with no adjacent equal letters', () => {
    expect(new Set(WORDS).size).toBe(WORDS.length);
    for (const w of WORDS) {
      expect(w, w).toMatch(/^[A-Z]{3,6}$/);
      expect(w, w).not.toMatch(/(.)\1/);
    }
  });
  it('every letter A to Z appears in at least one word', () => {
    const seen = new Set(WORDS.join(''));
    for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') expect(seen.has(c), c).toBe(true);
  });
  it('steps match the text and every step is a Board target', () => {
    for (const w of WORDS) {
      const m = messageFor(w);
      expect(m.steps).toHaveLength(w.length);
      for (const s of m.steps) expect(BOARD_TARGET_IDS.has(s), s).toBe(true);
    }
  });
  it('no word is in the Board offensive-word list (read as data)', () => {
    expect(OFFENSIVE.size).toBeGreaterThan(100);
    for (const w of WORDS) expect(OFFENSIVE.has(w.toLowerCase()), w).toBe(false);
  });
});
describe('Feature: seance, Property 9: message choice', () => {
  const seeds = fc.integer({ min: 0, max: 0xffffffff });
  it('is deterministic, comes from the list or the fixed answers, and never repeats the previous word', () => {
    fc.assert(
      fc.property(seeds, fc.integer({ min: 1, max: 200 }), fc.option(fc.constantFrom(...WORDS), { nil: null }), (seed, n, prevWord) => {
        const previousId = prevWord === null ? null : `word-${prevWord.toLowerCase()}`;
        const a = pickMessage(seed, n, previousId);
        expect(pickMessage(seed, n, previousId)).toEqual(a);
        if (n % 4 === 0) {
          expect(['YES', 'NO', 'GOODBYE'][(n / 4 - 1) % 3]).toBe(a.text);
          expect(a.steps).toHaveLength(1);
        } else {
          expect(WORDS).toContain(a.text);
          expect(a.id).not.toBe(previousId);
          if (n === 1) expect(a.text).toHaveLength(3);
        }
      }),
      { numRuns: 200 },
    );
  });
});
