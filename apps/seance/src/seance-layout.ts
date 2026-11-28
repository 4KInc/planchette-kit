/**
 * seance-layout.ts: the fixed board and the arrival guard (design.md, `seance-layout.ts`).
 * Pure: no DOM. Cell positions are in grid cells; pixel rectangles come from the page.
 */
import type { Rect } from '@planchette/skeleton';
export const COLUMNS = 7;
export const ROWS = 6;
export interface Cell {
  readonly id: string;
  readonly row: number;
  readonly col: number;
  readonly colSpan: number;
  /** `target` cells are selectable; `decor` cells are drawn only (no target, hidden from assistive technology). */
  readonly kind: 'target' | 'decor';
}
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function build(): Cell[] {
  const cells: Cell[] = [
    { id: 'yes', row: 0, col: 0, colSpan: 3, kind: 'target' },
    { id: 'decor-planchette', row: 0, col: 3, colSpan: 1, kind: 'decor' },
    { id: 'no', row: 0, col: 4, colSpan: 3, kind: 'target' },
  ];
  for (let i = 0; i < 26; i++) {
    cells.push({ id: `letter-${LETTERS[i]!.toLowerCase()}`, row: 1 + Math.floor(i / COLUMNS), col: i % COLUMNS, colSpan: 1, kind: 'target' });
  }
  cells.push(
    { id: 'decor-moon-a', row: 4, col: 5, colSpan: 1, kind: 'decor' },
    { id: 'decor-moon-b', row: 4, col: 6, colSpan: 1, kind: 'decor' },
    { id: 'decor-left', row: 5, col: 0, colSpan: 1, kind: 'decor' },
    { id: 'goodbye', row: 5, col: 1, colSpan: 5, kind: 'target' },
    { id: 'decor-right', row: 5, col: 6, colSpan: 1, kind: 'decor' },
  );
  return cells;
}
/** The 29 Board targets and the 5 decorative cells, per requirements.md "Game board". */
export const BOARD_CELLS: readonly Cell[] = Object.freeze(build());
/** Sizes of the grid for a target size (cell height), gap and grid width, all in CSS px. */
export function boardExtent(targetSize: number, gap: number, gridWidth: number): { cellW: number; width: number; height: number } {
  return {
    cellW: (gridWidth - (COLUMNS - 1) * gap) / COLUMNS,
    width: gridWidth,
    height: ROWS * targetSize + (ROWS - 1) * gap,
  };
}
export interface Point {
  readonly x: number;
  readonly y: number;
}
/** Inclusive on every edge: the guard holds a target when the pointer is on its border too. */
export function insideRect(point: Point, rect: Rect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}
/**
 * The arrival guard (Requirement 4 AC 7). With a known pointer, a target whose rectangle contains it
 * is `held`; the rest are `register`ed. With no pointer position (scanning, or no move seen), nothing is held.
 */
export function guardedTargets(
  ids: readonly string[],
  rects: ReadonlyMap<string, Rect>,
  pointer: Point | null,
): { register: string[]; held: string[] } {
  const register: string[] = [];
  const held: string[] = [];
  for (const id of ids) {
    const rect = rects.get(id);
    if (pointer !== null && rect !== undefined && insideRect(pointer, rect)) held.push(id);
    else register.push(id);
  }
  return { register, held };
}
