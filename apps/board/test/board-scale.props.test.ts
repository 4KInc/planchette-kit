import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { messageBarLayout, renderedCellSize } from '../src/board-scale.js';

/**
 * Feature: board, Property 18: Rendered cell size.
 * Written for the 80 px Message bar (the function as it stands before Task 33).
 * Profile ranges come from skeleton/src/engine/profile.ts: targetSize 64 to 400,
 * targetSpacing 8 to 64.
 *
 * **Validates: Requirements 14.6, 14.11, 14.13**
 */

const BAR_HEIGHT = 80;

const sizeArb = fc.integer({ min: 64, max: 400 });
const gapArb = fc.integer({ min: 8, max: 64 });
const rowsArb = fc.constantFrom(1, 2);
const dimArb = fc.integer({ min: 1, max: 4000 });

/** Page height: 16 + max(H + 6s + 6g, (k+3)s + (k+5)g + 272). */
function pageHeight(s: number, g: number, k: number): number {
  return 16 + Math.max(BAR_HEIGHT + 6 * s + 6 * g, (k + 3) * s + (k + 5) * g + 272);
}

/** Page width: 8s + 6g + 502. */
function pageWidth(s: number, g: number): number {
  return 8 * s + 6 * g + 502;
}

describe('Property 18: renderedCellSize (80 px Message bar)', () => {
  it('is a whole number and never below the Profile size', () => {
    fc.assert(
      fc.property(sizeArb, gapArb, rowsArb, dimArb, dimArb, (size, g, k, width, height) => {
        const s = renderedCellSize(size, g, k, { width, height });
        expect(Number.isInteger(s)).toBe(true);
        expect(s).toBeGreaterThanOrEqual(size);
      }),
      { numRuns: 500 },
    );
  });

  it('above the Profile size, fits the viewport at s and not at s + 1', () => {
    fc.assert(
      fc.property(sizeArb, gapArb, rowsArb, dimArb, dimArb, (size, g, k, width, height) => {
        const s = renderedCellSize(size, g, k, { width, height });
        fc.pre(s > size);
        expect(pageWidth(s, g)).toBeLessThanOrEqual(width);
        expect(pageHeight(s, g, k)).toBeLessThanOrEqual(height);
        const next = s + 1;
        expect(pageWidth(next, g) > width || pageHeight(next, g, k) > height).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('exercises the "above the Profile size" branch with viewports large enough to scale', () => {
    // Generated viewports that scale above the Profile size: the property above would
    // otherwise pass vacuously on mostly-small viewports.
    fc.assert(
      fc.property(
        sizeArb,
        gapArb,
        rowsArb,
        fc.integer({ min: 1000, max: 4000 }),
        fc.integer({ min: 800, max: 4000 }),
        (size, g, k, width, height) => {
          const s = renderedCellSize(size, g, k, { width, height });
          if (s > size) {
            expect(pageWidth(s, g)).toBeLessThanOrEqual(width);
            expect(pageHeight(s, g, k)).toBeLessThanOrEqual(height);
            expect(
              pageWidth(s + 1, g) > width || pageHeight(s + 1, g, k) > height,
            ).toBe(true);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('never decreases when the viewport width or height grows', () => {
    fc.assert(
      fc.property(
        sizeArb,
        gapArb,
        rowsArb,
        dimArb,
        dimArb,
        fc.integer({ min: 0, max: 2000 }),
        fc.integer({ min: 0, max: 2000 }),
        (size, g, k, width, height, extraW, extraH) => {
          const base = renderedCellSize(size, g, k, { width, height });
          const wider = renderedCellSize(size, g, k, { width: width + extraW, height });
          const taller = renderedCellSize(size, g, k, { width, height: height + extraH });
          const both = renderedCellSize(size, g, k, {
            width: width + extraW,
            height: height + extraH,
          });
          expect(wider).toBeGreaterThanOrEqual(base);
          expect(taller).toBeGreaterThanOrEqual(base);
          expect(both).toBeGreaterThanOrEqual(base);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('is 96 at 1366x768 with the defaults (size 96, gap 16, one strip row)', () => {
    expect(renderedCellSize(96, 16, 1, { width: 1366, height: 768 })).toBe(96);
  });
});

/**
 * Property 18 for `messageBarLayout` (Task 33.3): the 80 or 131 px Message bar.
 *
 * **Validates: Requirements 14.6, 14.11, 14.13, 14.15, 14.17**
 */

/** Page height for a given bar height H: 16 + max(H + 6s + 6g, (k+3)s + (k+5)g + 272). */
function pageHeightFor(h: number, s: number, g: number, k: number): number {
  return 16 + Math.max(h + 6 * s + 6 * g, (k + 3) * s + (k + 5) * g + 272);
}

/** Independent fit: the largest whole s at which the page fits with bar height H. */
function fitFor(h: number, g: number, k: number, width: number, height: number): number {
  return Math.floor(
    Math.min(
      (height - 16 - h - 6 * g) / 6,
      (height - 288 - (k + 5) * g) / (k + 3),
      (width - 502 - 6 * g) / 8,
    ),
  );
}

/** Viewports that reach both bar heights, so the properties are not vacuous. */
const bigWidthArb = fc.integer({ min: 600, max: 4000 });
const bigHeightArb = fc.integer({ min: 600, max: 4000 });

describe('Property 18: messageBarLayout (80 or 131 px Message bar)', () => {
  it('returns a bar of 80 or 131, a whole cell size at least the Profile size, and pageMinHeight by formula', () => {
    fc.assert(
      fc.property(sizeArb, gapArb, rowsArb, dimArb, dimArb, (size, g, k, width, height) => {
        const l = messageBarLayout(size, g, k, { width, height });
        expect([80, 131]).toContain(l.barHeight);
        expect(l.lines).toBe(l.barHeight === 131 ? 2 : 1);
        expect(Number.isInteger(l.cellSize)).toBe(true);
        expect(l.cellSize).toBeGreaterThanOrEqual(size);
        expect(l.pageMinHeight).toBe(pageHeightFor(l.barHeight, l.cellSize, g, k));
      }),
      { numRuns: 500 },
    );
  });

  it('is 131 only when the height is at least 900 and the cells stay at or above the Profile size', () => {
    fc.assert(
      fc.property(sizeArb, gapArb, rowsArb, bigWidthArb, bigHeightArb, (size, g, k, width, height) => {
        const l = messageBarLayout(size, g, k, { width, height });
        const expectTwo = height >= 900 && fitFor(131, g, k, width, height) >= size;
        expect(l.barHeight).toBe(expectTwo ? 131 : 80);
      }),
      { numRuns: 1000 },
    );
  });

  it('agrees with renderedCellSize for the chosen bar height', () => {
    fc.assert(
      fc.property(sizeArb, gapArb, rowsArb, dimArb, dimArb, (size, g, k, width, height) => {
        const l = messageBarLayout(size, g, k, { width, height });
        expect(renderedCellSize(size, g, k, { width, height }, l.barHeight)).toBe(l.cellSize);
      }),
      { numRuns: 500 },
    );
  });

  it('above the Profile size, fits at s and not at s + 1 with the chosen bar height', () => {
    fc.assert(
      fc.property(sizeArb, gapArb, rowsArb, bigWidthArb, bigHeightArb, (size, g, k, width, height) => {
        const l = messageBarLayout(size, g, k, { width, height });
        const s = l.cellSize;
        fc.pre(s > size);
        expect(pageHeightFor(l.barHeight, s, g, k)).toBeLessThanOrEqual(height);
        expect(pageWidth(s, g)).toBeLessThanOrEqual(width);
        expect(
          pageHeightFor(l.barHeight, s + 1, g, k) > height || pageWidth(s + 1, g) > width,
        ).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it('s never decreases when the viewport grows, while the bar height is unchanged', () => {
    fc.assert(
      fc.property(
        sizeArb,
        gapArb,
        rowsArb,
        bigWidthArb,
        bigHeightArb,
        fc.integer({ min: 0, max: 2000 }),
        fc.integer({ min: 0, max: 2000 }),
        (size, g, k, width, height, extraW, extraH) => {
          const base = messageBarLayout(size, g, k, { width, height });
          const grown = [
            messageBarLayout(size, g, k, { width: width + extraW, height }),
            messageBarLayout(size, g, k, { width, height: height + extraH }),
            messageBarLayout(size, g, k, { width: width + extraW, height: height + extraH }),
          ];
          for (const next of grown) {
            if (next.barHeight === base.barHeight) {
              expect(next.cellSize).toBeGreaterThanOrEqual(base.cellSize);
            }
          }
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('pins the single step at the 900 px breakpoint: 117 at 899, 109 at 900 (size 96, gap 16, k = 1)', () => {
    const at = (height: number) => messageBarLayout(96, 16, 1, { width: 1920, height });
    expect(at(899)).toMatchObject({ lines: 1, barHeight: 80, cellSize: 117 });
    expect(at(900)).toMatchObject({ lines: 2, barHeight: 131, cellSize: 109 });
    // Within each bar height the size never drops as the window grows from 600 to 1400 px.
    let previous = at(600);
    let drops = 0;
    for (let h = 601; h <= 1400; h++) {
      const now = at(h);
      if (now.cellSize < previous.cellSize) {
        drops++;
        expect(h).toBe(900);
        expect(now.barHeight).not.toBe(previous.barHeight);
      }
      previous = now;
    }
    expect(drops).toBe(1);
  });

  it('gives the default-size results: 80 and 96 at 1366x768, 131 and 139 at 1920x1080', () => {
    expect(messageBarLayout(96, 16, 1, { width: 1366, height: 768 })).toMatchObject({
      barHeight: 80,
      cellSize: 96,
    });
    expect(messageBarLayout(96, 16, 1, { width: 1920, height: 1080 })).toMatchObject({
      barHeight: 131,
      cellSize: 139,
    });
  });
});
