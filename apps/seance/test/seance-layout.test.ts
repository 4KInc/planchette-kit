import { describe, expect, it } from 'vitest';
import { BOARD_CELLS, COLUMNS, ROWS, boardExtent, guardedTargets } from '../src/seance-layout';
import { BOARD_TARGET_IDS } from './board-target-ids';
const targets = BOARD_CELLS.filter((c) => c.kind === 'target');
describe('seance-layout', () => {
  it('has the 29 Board targets and 5 decorative cells', () => {
    expect(targets).toHaveLength(29);
    expect(new Set(targets.map((c) => c.id))).toEqual(BOARD_TARGET_IDS);
    expect(BOARD_CELLS.filter((c) => c.kind === 'decor')).toHaveLength(5);
  });
  it('no two cells overlap, and every cell is on the grid', () => {
    const seen = new Set<string>();
    for (const c of BOARD_CELLS) {
      expect(c.row).toBeGreaterThanOrEqual(0);
      expect(c.row).toBeLessThan(ROWS);
      expect(c.col + c.colSpan).toBeLessThanOrEqual(COLUMNS);
      for (let i = 0; i < c.colSpan; i++) {
        const key = `${c.row},${c.col + i}`;
        expect(seen.has(key), key).toBe(false);
        seen.add(key);
      }
    }
  });
  it('fills the table in requirements.md', () => {
    const at = (id: string) => BOARD_CELLS.find((c) => c.id === id)!;
    expect(at('yes')).toMatchObject({ row: 0, col: 0, colSpan: 3 });
    expect(at('no')).toMatchObject({ row: 0, col: 4, colSpan: 3 });
    expect(at('letter-a')).toMatchObject({ row: 1, col: 0 });
    expect(at('letter-g')).toMatchObject({ row: 1, col: 6 });
    expect(at('letter-h')).toMatchObject({ row: 2, col: 0 });
    expect(at('letter-u')).toMatchObject({ row: 3, col: 6 });
    expect(at('letter-v')).toMatchObject({ row: 4, col: 0 });
    expect(at('letter-z')).toMatchObject({ row: 4, col: 4 });
    expect(at('goodbye')).toMatchObject({ row: 5, col: 1, colSpan: 5 });
  });
  it('the extent arithmetic of design.md holds at 1366x768 and 1920x1080', () => {
    const e = boardExtent(96, 16, 848);
    expect(e.cellW).toBeCloseTo(107.43, 2);
    expect(e.cellW).toBeGreaterThanOrEqual(96);
    expect(e.height).toBe(656);
    expect(12 + 848 + 16 + 478 + 12).toBe(1366);
    expect(8 + 80 + 16 + e.height + 8).toBe(768);
    // the page keeps its 1366-wide size at 1920x1080 (no scaling in the first cut): the same extent fits
    expect(1920).toBeGreaterThan(1366);
    expect(8 + 80 + 16 + e.height + 8).toBeLessThanOrEqual(1080);
    // wide targets
    expect(3 * e.cellW + 2 * 16).toBeCloseTo(354.3, 1);
    expect(5 * e.cellW + 4 * 16).toBeCloseTo(601.1, 1);
  });
});
describe('guardedTargets', () => {
  const rects = new Map([
    ['a', { x: 0, y: 0, width: 100, height: 100 }],
    ['b', { x: 200, y: 0, width: 100, height: 100 }],
  ]);
  it('holds the target under the pointer, registers the rest', () => {
    expect(guardedTargets(['a', 'b'], rects, { x: 50, y: 50 })).toEqual({ register: ['b'], held: ['a'] });
  });
  it('holds nothing with no pointer, or with the pointer outside every target', () => {
    expect(guardedTargets(['a', 'b'], rects, null)).toEqual({ register: ['a', 'b'], held: [] });
    expect(guardedTargets(['a', 'b'], rects, { x: 150, y: 50 })).toEqual({ register: ['a', 'b'], held: [] });
  });
  it('holds on the border too', () => {
    expect(guardedTargets(['a'], rects, { x: 100, y: 100 }).held).toEqual(['a']);
  });
});
