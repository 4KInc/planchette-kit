/**
 * Rendered cell size (design.md "Scaling to the viewport", Req 14 AC 11 to 13). Pure: no DOM.
 *
 * `s = max(profileSize, floor(min(sFitHeight, sFitWidth)))`, where `k` is the number of rows
 * the Prediction strip uses and `g` the Profile's target spacing:
 *   sFitHeight = min((vh - 16 - H - 6g) / 6, (vh - 288 - (k + 5)g) / (k + 3))
 *   sFitWidth  = (vw - 502 - 6g) / 8
 * H is the Message bar height: 80 (one line) or 131 (two lines), chosen by `messageBarLayout`.
 */

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** Page padding above and below the columns: 8 px + 8 px. */
const PAGE_PADDING_PX = 16;
/** Right-column height not scaling with `s`, less the strip's `(k + 5)` gaps. */
const RIGHT_COLUMN_FIXED_PX = 288;
/** Page width not scaling with `s`: 24 px padding plus the 478 px right column. */
const WIDTH_OVERHEAD_PX = 502;
/** Rows in the tallest (Core) grid. */
const GRID_ROWS = 6;
/** Cell-width units per `s` across the six columns: 6 * 4/3. */
const WIDTH_UNITS = 8;
/** Right-column fixed rows (notice, controls, status) used by the page-height formula. */
const RIGHT_COLUMN_ROWS_PX = 272;

/** Message bar (design.md "Message bar text", Req 14 AC 14 to 17). */
export const BAR_TEXT_PX = 48;
export const BAR_LINE_FACTOR = 1.3;
export const BAR_BORDER_PX = 6;
export const BAR_ONE_LINE_HEIGHT = 80;
/** Two 48 px lines at line height 1.3, plus the border: ceil(2 * 1.3 * 48) + 6 = 131. */
export const BAR_TWO_LINE_HEIGHT = Math.ceil(2 * BAR_LINE_FACTOR * BAR_TEXT_PX) + BAR_BORDER_PX;
export const TWO_LINE_MIN_VIEWPORT_HEIGHT = 900;

/** The largest whole cell size at which the page fits, before the Profile floor. */
function fitCellSize(gap: number, stripRows: number, viewport: Viewport, barHeight: number): number {
  const k = stripRows;
  const fitLeft = (viewport.height - PAGE_PADDING_PX - barHeight - GRID_ROWS * gap) / GRID_ROWS;
  const fitRight = (viewport.height - RIGHT_COLUMN_FIXED_PX - (k + 5) * gap) / (k + 3);
  const fitWidth = (viewport.width - WIDTH_OVERHEAD_PX - GRID_ROWS * gap) / WIDTH_UNITS;
  return Math.floor(Math.min(fitLeft, fitRight, fitWidth));
}

export function renderedCellSize(
  profileSize: number,
  gap: number,
  stripRows: number,
  viewport: Viewport,
  barHeight: number = BAR_ONE_LINE_HEIGHT,
): number {
  const fit = fitCellSize(gap, stripRows, viewport, barHeight);
  if (!Number.isFinite(fit)) return profileSize;
  return Math.max(profileSize, fit);
}

export interface MessageBarLayout {
  readonly lines: 1 | 2;
  readonly barHeight: number;
  readonly cellSize: number;
  readonly pageMinHeight: number;
}

/** Page height the Core view needs: 16 + max(H + 6s + 6g, (k + 3)s + (k + 5)g + 272). */
function pageHeight(barHeight: number, s: number, gap: number, k: number): number {
  return (
    PAGE_PADDING_PX +
    Math.max(barHeight + GRID_ROWS * s + GRID_ROWS * gap, (k + 3) * s + (k + 5) * gap + RIGHT_COLUMN_ROWS_PX)
  );
}

export function messageBarLayout(
  profileSize: number,
  gap: number,
  stripRows: number,
  viewport: Viewport,
): MessageBarLayout {
  const twoFit = fitCellSize(gap, stripRows, viewport, BAR_TWO_LINE_HEIGHT);
  if (viewport.height >= TWO_LINE_MIN_VIEWPORT_HEIGHT && Number.isFinite(twoFit) && twoFit >= profileSize) {
    return {
      lines: 2,
      barHeight: BAR_TWO_LINE_HEIGHT,
      cellSize: twoFit,
      pageMinHeight: pageHeight(BAR_TWO_LINE_HEIGHT, twoFit, gap, stripRows),
    };
  }
  const cellSize = renderedCellSize(profileSize, gap, stripRows, viewport, BAR_ONE_LINE_HEIGHT);
  return {
    lines: 1,
    barHeight: BAR_ONE_LINE_HEIGHT,
    cellSize,
    pageMinHeight: pageHeight(BAR_ONE_LINE_HEIGHT, cellSize, gap, stripRows),
  };
}
