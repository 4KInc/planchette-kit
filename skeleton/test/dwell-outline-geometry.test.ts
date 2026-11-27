import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  ARC_COLOUR,
  EDGE_COLOUR,
  TRACK_COLOUR,
  outlineGeometry,
} from '../src/ui/dwell-outline-geometry.js';

describe('outlineGeometry', () => {
  it('draws the edge white, the track #111 and the arc #ffd400', () => {
    expect([EDGE_COLOUR, TRACK_COLOUR, ARC_COLOUR]).toEqual(['#ffffff', '#111111', '#ffd400']);
    const g = outlineGeometry({ width: 128, height: 96 }, 2, 8);
    expect([g.edge.colour, g.track.colour, g.arc.colour]).toEqual(['#ffffff', '#111111', '#ffd400']);
  });

  it('128 x 96, border 2, radius 8: edge, track and arc are adjacent and inside the box', () => {
    const g = outlineGeometry({ width: 128, height: 96 }, 2, 8);
    expect([g.edge.outer, g.track.outer]).toEqual([2, 3]);
    expect([g.edge.strokeWidth, g.track.strokeWidth, g.arc.strokeWidth]).toEqual([1, 4, 2]);
    expect(g.arc.inset).toBe(g.track.inset); // the arc sits on the track's centre line
    expect(g.track.outer + g.track.strokeWidth).toBe(7); // the band ends 5 px inside the border
    expect(g.arc.radius).toBeCloseTo(8 - 5);
    const r = g.arc.radius;
    expect(g.arc.perimeter).toBeCloseTo(2 * (g.arc.width + g.arc.height) - 8 * r + 2 * Math.PI * r);
  });

  const cases: Array<[string, number, number, number, number]> = [
    ['128 x 96, border 2, radius 8', 128, 96, 2, 8],
    ['197 x 148, border 4, radius 8', 197, 148, 4, 8],
    ['96 x 96, border 0, radius 0', 96, 96, 0, 0],
    ['96 x 96, border 2, radius larger than half the side', 96, 96, 2, 200],
  ];
  for (const [label, w, h, b, rad] of cases) {
    it(`${label}: strokes lie inside the box, are adjacent, and the perimeter formula holds`, () => {
      const g = outlineGeometry({ width: w, height: h }, b, rad);
      // The edge's outer side is the border's inner side; each band starts where the last ended.
      expect(g.edge.outer).toBe(b);
      expect(g.track.outer).toBe(b + 1);
      expect(g.edge.outer + g.edge.strokeWidth).toBe(g.track.outer);
      expect(g.track.outer + g.track.strokeWidth).toBe(b + 5); // total band is border + 5
      // The arc (2 px) is centred on the track (4 px): 1 px of track on each side.
      expect(g.arc.inset).toBe(b + 3);
      expect(g.arc.inset - 1).toBe(g.track.outer + 1);
      expect(g.arc.inset + 1).toBe(g.track.outer + g.track.strokeWidth - 1);
      // Centre lines are the true centres of each band.
      expect(g.edge.inset).toBe(b + 0.5);
      expect(g.track.inset).toBe(b + 3);
      for (const s of [g.edge, g.track, g.arc]) {
        const half = s.strokeWidth / 2;
        expect(s.x - half).toBeGreaterThanOrEqual(b); // never over the border
        expect(s.x + s.width + half).toBeLessThanOrEqual(w - b);
        expect(s.y + s.height + half).toBeLessThanOrEqual(h - b);
        expect(s.radius).toBeGreaterThanOrEqual(0);
        expect(s.radius).toBeLessThanOrEqual(Math.min(s.width, s.height) / 2);
        const r = s.radius;
        expect(s.perimeter).toBeCloseTo(2 * (s.width + s.height) - 8 * r + 2 * Math.PI * r, 9);
      }
      // Concentric: with the radius not clamped, each radius is max(0, radius - inset).
      if (rad <= 40) for (const s of [g.edge, g.track, g.arc]) expect(s.radius).toBeCloseTo(Math.max(0, rad - s.inset), 9);
    });
  }

  it('128 x 96, border 2, radius 8 gives the exact centre-line numbers', () => {
    const g = outlineGeometry({ width: 128, height: 96 }, 2, 8);
    expect([g.edge.x, g.edge.width, g.edge.height, g.edge.radius]).toEqual([2.5, 123, 91, 5.5]);
    expect([g.arc.x, g.arc.width, g.arc.height, g.arc.radius]).toEqual([5, 118, 86, 3]);
    expect(g.arc.perimeter).toBeCloseTo(2 * (118 + 86) - 24 + 6 * Math.PI, 9);
  });

  it('a radius larger than half the side is kept within half the shorter side', () => {
    const g = outlineGeometry({ width: 96, height: 96 }, 0, 200);
    expect(g.arc.radius).toBe(45);
    expect(g.edge.radius).toBe(47.5);
  });

  it('a negative or non-finite radius or border never gives a negative radius', () => {
    const g = outlineGeometry({ width: 96, height: 96 }, -3, Number.NaN);
    expect(g.arc.radius).toBe(0);
    expect(g.edge.outer).toBe(0);
  });

  it('a square box with no border and no radius has a plain perimeter', () => {
    const g = outlineGeometry({ width: 96, height: 96 }, 0, 0);
    expect(g.edge.radius).toBe(0);
    expect(g.arc.perimeter).toBe(2 * (g.arc.width + g.arc.height));
  });

  it('keeps every stroke inside the box and radii non-negative for any input', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 400, noNaN: true }), fc.double({ min: 0, max: 400, noNaN: true }), fc.double({ min: 0, max: 8, noNaN: true }), fc.double({ min: 0, max: 400, noNaN: true }), (w, h, b, rad) => {
        const g = outlineGeometry({ width: w, height: h }, b, rad);
        for (const s of [g.edge, g.track, g.arc]) {
          expect(s.radius).toBeGreaterThanOrEqual(0);
          expect(s.radius).toBeLessThanOrEqual(Math.min(s.width, s.height) / 2 + 1e-9);
          expect(s.width).toBeGreaterThanOrEqual(0);
          expect(s.perimeter).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });
});
