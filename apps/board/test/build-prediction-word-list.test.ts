import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CORE_VOCABULARY } from '../src/core-vocabulary.js';
import {
  OUTPUT_PATH,
  SOURCE_PATH,
  WORD_LIST_SIZE,
  buildPredictionWordList,
  serialise,
} from '../scripts/build-prediction-word-list.js';

const source = readFileSync(SOURCE_PATH, 'utf8');
const LICENSE_PATH = fileURLToPath(new URL('../data/prediction-word-list.LICENSE.md', import.meta.url));

afterEach(() => vi.restoreAllMocks());

describe('build-prediction-word-list', () => {
  const built = buildPredictionWordList(source);
  const entries = Object.entries(built);

  it('has exactly 5,000 entries from the committed source', () => {
    expect(WORD_LIST_SIZE).toBe(5000);
    expect(entries).toHaveLength(5000);
  });

  it('contains no core-vocabulary word', () => {
    for (const b of CORE_VOCABULARY) expect(built).not.toHaveProperty(b.label.toLowerCase());
  });

  it('only has keys that start with a letter, then letters or apostrophes', () => {
    for (const [word] of entries) expect(word).toMatch(/^[a-z][a-z']+$/);
  });

  it('drops tokenizer fragments', () => {
    const words = new Set(source.split(/\r?\n/).map((l) => l.trim().split(/\s+/)[0]?.toLowerCase()));
    expect(built).not.toHaveProperty("'s");
    expect(built).not.toHaveProperty("'t");
    if (words.has("don't")) expect(built).toHaveProperty("don't");
  });
  it('has frequencies in (0, 1] that strictly decrease with rank', () => {
    expect(entries[0]?.[1]).toBe(1);
    for (let i = 0; i < entries.length; i++) {
      const f = entries[i]![1];
      expect(f).toBeGreaterThan(0);
      expect(f).toBeLessThanOrEqual(1);
      if (i > 0) expect(f).toBeLessThan(entries[i - 1]![1]);
    }
  });

  it('applies the filter rules to a small input', () => {
    const out = buildPredictionWordList('The 9\nI 8\nx 7\nDon\'t 6\nhe11o 5\nhello 4\nHELLO 3\nyou 2\nworld 1', ['i', 'you']);
    expect(Object.keys(out)).toEqual(['the', "don't", 'hello', 'world']);
    expect(out['the']).toBe(1);
    expect(out['world']).toBe(1 / 4);
  });

  it('reads no network', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    buildPredictionWordList(source);
    vi.unstubAllGlobals();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('matches the committed JSON', () => {
    expect(readFileSync(OUTPUT_PATH, 'utf8')).toBe(serialise(built));
  });

  it('has a licence file next to the JSON', () => {
    expect(existsSync(LICENSE_PATH)).toBe(true);
    const text = readFileSync(LICENSE_PATH, 'utf8');
    expect(text).toContain('CC BY-SA 4.0');
    expect(text).toContain('Hermit Dave');
    expect(text).toContain('OpenSubtitles');
  });
});
