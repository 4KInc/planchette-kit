import { describe, it, expect } from 'vitest';
import {
  mapCentredAngles,
  unmapPixel,
  type MappingProfile,
  type MappingScreen,
} from '../src/engine/pointer-mapping';

const P: MappingProfile = {
  headGain: 1,
  headDeadZone: 0.5,
  calibrationRangeLeft: 10,
  calibrationRangeRight: 10,
  calibrationRangeUp: 10,
  calibrationRangeDown: 10,
};
const S: MappingScreen = { width: 101, height: 101 };

describe('mapCentredAngles', () => {
  it('maps the centre to the middle pixel', () => {
    expect(mapCentredAngles(0, 0, P, S)).toEqual({ x: 50, y: 50 });
  });

  it('maps the range edges to the screen edges (pitch up is y = 0)', () => {
    expect(mapCentredAngles(10, 10, P, S)).toEqual({ x: 100, y: 0 });
    expect(mapCentredAngles(-10, -10, P, S)).toEqual({ x: 0, y: 100 });
    expect(mapCentredAngles(30, -30, P, S)).toEqual({ x: 100, y: 100 });
  });

  it('keeps angles inside the dead zone at the centre', () => {
    expect(mapCentredAngles(0.5, -0.5, P, S)).toEqual({ x: 50, y: 50 });
  });

  it('uses the range of the side the angle is on', () => {
    const p = { ...P, headDeadZone: 0, calibrationRangeRight: 20, calibrationRangeLeft: 10 };
    expect(mapCentredAngles(10, 0, p, S).x).toBe(75);
    expect(mapCentredAngles(-5, 0, p, S).x).toBe(25);
  });

  it('applies head gain to the range', () => {
    const p = { ...P, headDeadZone: 0, headGain: 2 };
    expect(mapCentredAngles(2.5, 0, p, S).x).toBe(75);
    expect(mapCentredAngles(5, 0, p, S).x).toBe(100);
  });

  it('returns 0,0 on a 1-px screen', () => {
    expect(mapCentredAngles(7, -7, P, { width: 1, height: 1 })).toEqual({ x: 0, y: 0 });
  });
});

describe('unmapPixel', () => {
  it('maps the centre pixel to zero angles', () => {
    const r = unmapPixel(50, 50, P, S);
    expect(r.dx).toBeCloseTo(0, 12);
    expect(r.dy).toBeCloseTo(0, 12);
  });

  it('maps the screen edges to the range edges', () => {
    const r = unmapPixel(100, 0, P, S);
    expect(r.dx).toBeCloseTo(10, 12);
    expect(r.dy).toBeCloseTo(10, 12);
  });

  it('inverts the forward mapping outside the dead zone', () => {
    const r = unmapPixel(75, 30, P, S);
    expect(r.dx).toBeCloseTo(5.25, 12);
    expect(mapCentredAngles(r.dx, r.dy, P, S)).toEqual({ x: 75, y: 30 });
  });

  it('maps a screen with a 1-px axis to zero on that axis', () => {
    const r = unmapPixel(3, 3, P, { width: 1, height: 1 });
    expect(r.dx).toBeCloseTo(0, 12);
    expect(r.dy).toBeCloseTo(0, 12);
  });

  it('clamps a point outside the screen', () => {
    const r = unmapPixel(500, -5, P, S);
    expect(r.dx).toBeCloseTo(10, 12);
    expect(r.dy).toBeCloseTo(10, 12);
  });

  it('treats a non-finite coordinate as the centre', () => {
    const r = unmapPixel(NaN, 0, P, S);
    expect(r.dx).toBeCloseTo(0, 12);
    expect(r.dy).toBeCloseTo(10, 12);
    const q = unmapPixel(0, Infinity, P, S);
    expect(q.dx).toBeCloseTo(-10, 12);
    expect(q.dy).toBeCloseTo(0, 12);
  });
});
