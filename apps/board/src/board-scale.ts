/**
 * Rendered cell size (design.md "Scaling to the viewport", Req 14 AC 11 to 13). Pure: no DOM.
 *
 * `s = max(profileSize, floor(min(sFitHeight, sFitWidth)))`, where `k` is the number of rows
 * the Prediction strip uses and `g` the Profile's target spacing:
 *   sFitHeight = min((vh - 16 - H - 6g) / 6, (vh - 288 - (k + 5)g) / (k + 3))
 *   sFitWidth  = (vw - 502 - 6g) / 8
 * H is the Message bar height: 80 (one line) or 131 (two lines), chosen by `messageBarLayout`.
 */

import { PAGE_FIT, fitCellSize, renderedCellSize, type Viewport } from '@planchette/skeleton/ui';
/**
 * The fit formula and `renderedCellSize` moved to the skeleton's `./ui` entry (shared with Séance);
 * they are re-exported here so the Board's imports and tests are unchanged.
 */
export { fitCellSize, renderedCellSize, type Viewport };
/** Page padding above and below the columns: 8 px + 8 px. */
const PAGE_PADDING_PX = PAGE_FIT.pagePaddingPx;
/** Rows in the tallest (Core) grid. */
const GRID_ROWS = PAGE_FIT.gridRows;
/** Right-column fixed rows (notice, controls, status) used by the page-height formula. */
const RIGHT_COLUMN_ROWS_PX = PAGE_FIT.rightColumnRowsPx;
/** Message bar (design.md "Message bar text", Req 14 AC 14 to 17). */
export const BAR_TEXT_PX = 48;
export const BAR_LINE_FACTOR = 1.3;
export const BAR_BORDER_PX = 6;
export const BAR_ONE_LINE_HEIGHT = PAGE_FIT.barOneLineHeight;
/** Two 48 px lines at line height 1.3, plus the border: ceil(2 * 1.3 * 48) + 6 = 131. */
export const BAR_TWO_LINE_HEIGHT = Math.ceil(2 * BAR_LINE_FACTOR * BAR_TEXT_PX) + BAR_BORDER_PX;
export const TWO_LINE_MIN_VIEWPORT_HEIGHT = 900;

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
