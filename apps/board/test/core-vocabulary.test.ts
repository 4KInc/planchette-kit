import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CORE_VOCABULARY } from '../src/core-vocabulary.js';

const REQUIREMENTS = fileURLToPath(new URL('../../../.kiro/specs/board/requirements.md', import.meta.url));

/** Parse the comma-separated Core word list from the "Core vocabulary (fixed grid)" section. */
function parseCoreWordList(): string[] {
  const text = readFileSync(REQUIREMENTS, 'utf8');
  const section = text.split('## Core vocabulary (fixed grid)')[1]?.split('\n## ')[0] ?? '';
  const paragraphs = section.split(/\n\s*\n/);
  const list = paragraphs.find((p) => /^all,\s*can,/.test(p.trim()));
  if (list === undefined) throw new Error('Core word list not found in requirements.md');
  return list
    .replace(/\s+/g, ' ')
    .trim()
    .split(',')
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

describe('CORE_VOCABULARY', () => {
  it('has exactly 36 entries', () => {
    expect(CORE_VOCABULARY).toHaveLength(36);
  });

  it('contains every word of the requirements Core word list exactly once', () => {
    const words = parseCoreWordList();
    expect(words).toHaveLength(36);
    const labels = CORE_VOCABULARY.map((b) => b.label);
    for (const w of words) {
      expect(labels.filter((l) => l === w), w).toHaveLength(1);
    }
    expect([...labels].sort()).toEqual([...words].sort());
  });

  it('keeps every row and col within 0-5', () => {
    for (const b of CORE_VOCABULARY) {
      expect(Number.isInteger(b.row) && b.row >= 0 && b.row <= 5, b.id).toBe(true);
      expect(Number.isInteger(b.col) && b.col >= 0 && b.col <= 5, b.id).toBe(true);
    }
  });

  it('gives every entry a unique (row, col) and a unique id', () => {
    expect(new Set(CORE_VOCABULARY.map((b) => `${b.row},${b.col}`)).size).toBe(36);
    expect(new Set(CORE_VOCABULARY.map((b) => b.id)).size).toBe(36);
  });

  it('is alphabetical (case-insensitive) in row-major order', () => {
    CORE_VOCABULARY.forEach((b, i) => {
      expect(b.row).toBe(Math.floor(i / 6));
      expect(b.col).toBe(i % 6);
    });
    const lower = CORE_VOCABULARY.map((b) => b.label.toLowerCase());
    expect(lower).toEqual([...lower].sort());
  });

  it('is deeply frozen', () => {
    expect(Object.isFrozen(CORE_VOCABULARY)).toBe(true);
    for (const b of CORE_VOCABULARY) expect(Object.isFrozen(b)).toBe(true);
  });
});
