import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { seanceCellSize, seanceExtent } from '../src/seance-scale';
describe('seance-scale', () => {
  it('is the profile size at 1366x768 and 148 at 1920x1080 (the figures in design.md)', () => {
    expect(seanceCellSize(96, 16, { width: 1366, height: 768 })).toBe(96);
    expect(seanceCellSize(96, 16, { width: 1920, height: 1080 })).toBe(148);
    expect(seanceExtent(96, 16)).toEqual({ width: 1366, height: 768 });
    expect(seanceExtent(148, 16)).toEqual({ width: 8 * 148 + 96 + 502, height: 1080 });
  });
});
describe('Feature: seance, Property 18: Rendered cell size', () => {
  const sizes = fc.record({ width: fc.integer({ min: 1366, max: 3840 }), height: fc.integer({ min: 768, max: 2160 }), gap: fc.integer({ min: 8, max: 32 }) });
  it('fits the viewport at the default Profile size, is the largest whole size that does, and never goes below the Profile size', () => {
    fc.assert(
      fc.property(sizes, ({ width, height, gap }) => {
        const s = seanceCellSize(96, gap, { width, height });
        expect(s).toBeGreaterThanOrEqual(96);
        const e = seanceExtent(s, gap);
        const fitsAtDefault = seanceExtent(96, gap).width <= width && seanceExtent(96, gap).height <= height;
        if (fitsAtDefault) {
          expect(e.width).toBeLessThanOrEqual(width);
          expect(e.height).toBeLessThanOrEqual(height);
          const bigger = seanceExtent(s + 1, gap);
          expect(bigger.width > width || bigger.height > height).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });
  it('never decreases when the viewport grows', () => {
    fc.assert(
      fc.property(sizes, fc.integer({ min: 0, max: 600 }), fc.integer({ min: 0, max: 600 }), ({ width, height, gap }, dw, dh) => {
        expect(seanceCellSize(96, gap, { width: width + dw, height: height + dh })).toBeGreaterThanOrEqual(seanceCellSize(96, gap, { width, height }));
      }),
    );
  });
});
