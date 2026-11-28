/**
 * viewport-fit.ts: the largest cell size at which a two-column page fits the viewport (moved here
 * from the Board's board-scale.ts with no change of behaviour, so the Board and Séance share it).
 * Pure: no DOM, nothing happens on import.
 *
 * `s = max(profileSize, floor(min(sFitHeight, sFitWidth)))`, where `k` is the number of rows of an
 * extra strip above the side column's action rows (the Board's prediction strip; 0 for none) and `g`
 * the Profile's target spacing:
 *   sFitHeight = min((vh - 16 - H - 6g) / 6, (vh - 288 - (k + 5)g) / (k + 3))
 *   sFitWidth  = (vw - 502 - 6g) / 8
 * H is the height of the bar above the left grid (80 for one line of 48 px text).
 * The page is a left column (bar, then a grid of 6 rows and a width of 8s + 5g) and a right column of
 * 478 px (k + 3 rows of s, then 272 px of controls, status and notice).
 */
export interface Viewport {
  readonly width: number;
  readonly height: number;
}
/** The numbers of the two-column page the formula describes. */
export const PAGE_FIT = {
  /** Page padding above and below the columns: 8 px + 8 px. */
  pagePaddingPx: 16,
  /** Right-column height not scaling with `s`, less the strip's `(k + 5)` gaps. */
  rightColumnFixedPx: 288,
  /** Page width not scaling with `s`: 24 px padding plus the 478 px right column. */
  widthOverheadPx: 502,
  /** Rows in the tallest grid. */
  gridRows: 6,
  /** Cell-width units per `s` across the grid: 8 (six columns of 4/3 s, or the same width in seven columns). */
  widthUnits: 8,
  /** Right-column fixed rows (notice, controls, status). */
  rightColumnRowsPx: 272,
  /** Bar above the grid with one line of text. */
  barOneLineHeight: 80,
} as const;
/** The largest whole cell size at which the page fits, before the Profile floor. */
export function fitCellSize(gap: number, stripRows: number, viewport: Viewport, barHeight: number): number {
  const k = stripRows;
  const fitLeft = (viewport.height - PAGE_FIT.pagePaddingPx - barHeight - PAGE_FIT.gridRows * gap) / PAGE_FIT.gridRows;
  const fitRight = (viewport.height - PAGE_FIT.rightColumnFixedPx - (k + 5) * gap) / (k + 3);
  const fitWidth = (viewport.width - PAGE_FIT.widthOverheadPx - PAGE_FIT.gridRows * gap) / PAGE_FIT.widthUnits;
  return Math.floor(Math.min(fitLeft, fitRight, fitWidth));
}
/** The cell size to draw: the fit, never below the Profile's target size. */
export function renderedCellSize(
  profileSize: number,
  gap: number,
  stripRows: number,
  viewport: Viewport,
  barHeight: number = PAGE_FIT.barOneLineHeight,
): number {
  const fit = fitCellSize(gap, stripRows, viewport, barHeight);
  if (!Number.isFinite(fit)) return profileSize;
  return Math.max(profileSize, fit);
}
