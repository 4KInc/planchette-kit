import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PAGE_FIT, fitCellSize, renderedCellSize } from '../src/ui/viewport-fit.js';
describe('viewport-fit (moved from the Board; its own tests still run in apps/board)', () => {
  it('keeps the Profile size at 1366x768 and scales at 1920x1080 (strip of one row, one-line bar)', () => {
    expect(renderedCellSize(96, 16, 1, { width: 1366, height: 768 })).toBe(96);
    expect(renderedCellSize(96, 16, 1, { width: 1920, height: 1080 })).toBe(148);
  });
  it('with no strip (k = 0) the side column has three rows of cells', () => {
    expect(fitCellSize(16, 0, { width: 1366, height: 768 }, 80)).toBe(96);
    expect(fitCellSize(16, 0, { width: 1920, height: 1080 }, 80)).toBe(148);
  });
  it('never goes below the Profile size and falls back to it for a non-finite fit', () => {
    expect(renderedCellSize(120, 16, 0, { width: 800, height: 600 })).toBe(120);
    expect(renderedCellSize(96, 16, 0, { width: Number.NaN, height: 768 })).toBe(96);
  });
  it('the fit is the largest whole size at which the three constraints hold', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1000, max: 3000 }), fc.integer({ min: 700, max: 1800 }), fc.integer({ min: 8, max: 64 }), fc.integer({ min: 0, max: 3 }), (width, height, gap, k) => {
        const s = fitCellSize(gap, k, { width, height }, PAGE_FIT.barOneLineHeight);
        const fits = (n: number): boolean =>
          PAGE_FIT.pagePaddingPx + PAGE_FIT.barOneLineHeight + 6 * n + 6 * gap <= height &&
          (k + 3) * n + (k + 5) * gap + PAGE_FIT.rightColumnFixedPx <= height &&
          8 * n + 6 * gap + PAGE_FIT.widthOverheadPx <= width;
        if (s > 0) {
          expect(fits(s)).toBe(true);
          expect(fits(s + 1)).toBe(false);
        }
      }),
    );
  });
});
