import { describe, expect, it } from 'vitest';
import { LETTER_BOARD } from '../src/letter-board.js';

const FREQUENCY_ORDER = 'E T A O I N S H R D L C U M W F G Y P B V K J X Q Z'.split(' ');

const at = (row: number, col: number) => LETTER_BOARD.find((k) => k.row === row && k.col === col);

describe('LETTER_BOARD', () => {
  it('has exactly 28 entries', () => {
    expect(LETTER_BOARD).toHaveLength(28);
  });

  it('lists the 26 letters in the documented frequency order, row-major', () => {
    const letters = LETTER_BOARD.filter((k) => k.id.startsWith('letter-'));
    expect(letters.map((k) => k.label)).toEqual(FREQUENCY_ORDER);
    expect(letters.map((k) => k.id)).toEqual(FREQUENCY_ORDER.map((l) => `letter-${l.toLowerCase()}`));
    letters.forEach((k, i) => {
      expect(k.row).toBe(Math.floor(i / 6));
      expect(k.col).toBe(i % 6);
    });
  });

  it('places Q, Z, Space, Backspace in row 4 cols 0-3', () => {
    expect(at(4, 0)).toMatchObject({ id: 'letter-q', label: 'Q' });
    expect(at(4, 1)).toMatchObject({ id: 'letter-z', label: 'Z' });
    expect(at(4, 2)).toMatchObject({ id: 'space', label: 'Space' });
    expect(at(4, 3)).toMatchObject({ id: 'backspace', label: '⌫ Backspace' });
  });

  it('has no key at (4,4) or (4,5)', () => {
    expect(at(4, 4)).toBeUndefined();
    expect(at(4, 5)).toBeUndefined();
  });

  it('keeps rows within 0-4 and cols within 0-5', () => {
    for (const k of LETTER_BOARD) {
      expect(Number.isInteger(k.row) && k.row >= 0 && k.row <= 4, k.id).toBe(true);
      expect(Number.isInteger(k.col) && k.col >= 0 && k.col <= 5, k.id).toBe(true);
    }
  });

  it('gives every entry a unique (row, col) and a unique id', () => {
    expect(new Set(LETTER_BOARD.map((k) => `${k.row},${k.col}`)).size).toBe(28);
    expect(new Set(LETTER_BOARD.map((k) => k.id)).size).toBe(28);
  });

  it('is deeply frozen', () => {
    expect(Object.isFrozen(LETTER_BOARD)).toBe(true);
    for (const k of LETTER_BOARD) expect(Object.isFrozen(k)).toBe(true);
  });
});
