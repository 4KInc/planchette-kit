import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OUTPUT_PATH,
  SOURCE_PATH,
  buildOffensiveWords,
  serialise,
} from '../scripts/build-offensive-words.js';
const LICENSE_PATH = fileURLToPath(new URL('../data/offensive-words.LICENSE.md', import.meta.url));
afterEach(() => vi.restoreAllMocks());
describe('build-offensive-words', () => {
  const committed: string[] = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8'));
  it('only has entries made of a-z and apostrophes', () => {
    expect(committed.length).toBeGreaterThan(0);
    for (const w of committed) expect(w).toMatch(/^[a-z']+$/);
  });
  it('has no duplicates', () => {
    expect(new Set(committed).size).toBe(committed.length);
  });
  it('has no entry containing a space', () => {
    for (const w of committed) expect(w).not.toContain(' ');
  });
  it('drops a multi-word line and keeps a single-word line', () => {
    expect(buildOffensiveWords('alpha beta\ngamma\n')).toEqual(['gamma']);
  });
  it('lower-cases, drops non-letter entries, and de-duplicates in order', () => {
    expect(buildOffensiveWords("Alpha\r\nbeta1\nALPHA\nit's\n\nrho-sigma\n")).toEqual(['alpha', "it's"]);
  });
  it('committed JSON equals the build output of the committed source', () => {
    const built = buildOffensiveWords(readFileSync(SOURCE_PATH, 'utf8'));
    expect(committed).toEqual(built);
    expect(readFileSync(OUTPUT_PATH, 'utf8')).toBe(serialise(built));
  });
  it('reads no network', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    buildOffensiveWords(readFileSync(SOURCE_PATH, 'utf8'));
    vi.unstubAllGlobals();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('has a licence file next to the JSON with the required credit', () => {
    expect(existsSync(LICENSE_PATH)).toBe(true);
    const text = readFileSync(LICENSE_PATH, 'utf8');
    for (const s of ['CC BY 4.0', 'Shutterstock', 'LDNOOBW']) expect(text).toContain(s);
  });
});
