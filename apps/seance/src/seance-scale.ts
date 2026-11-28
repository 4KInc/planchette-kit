/**
 * seance-scale.ts: the rendered cell size for a viewport (Requirement 9). Séance's page is the Board's two-column
 * page with no prediction strip, so it uses the skeleton's shared fit (`renderedCellSize`, moved there from the
 * Board) with `stripRows` 0. Pure: no DOM.
 */
import { PAGE_FIT, renderedCellSize, type Viewport } from '@planchette/skeleton/ui';
export type { Viewport };
/** The cell size to draw: the largest whole size at which the page fits, never below the Profile's target size. */
export function seanceCellSize(profileSize: number, gap: number, viewport: Viewport): number {
  return renderedCellSize(profileSize, gap, 0, viewport, PAGE_FIT.barOneLineHeight);
}
/** The page's size at cell size `s`: the grid is 8s + 5g wide beside a 478 px side column. */
export function seanceExtent(s: number, gap: number): { readonly width: number; readonly height: number } {
  const left = PAGE_FIT.barOneLineHeight + gap + PAGE_FIT.gridRows * s + (PAGE_FIT.gridRows - 1) * gap;
  const right = 3 * s + 5 * gap + PAGE_FIT.rightColumnRowsPx;
  return {
    width: PAGE_FIT.widthUnits * s + 6 * gap + PAGE_FIT.widthOverheadPx,
    height: PAGE_FIT.pagePaddingPx + Math.max(left, right),
  };
}
