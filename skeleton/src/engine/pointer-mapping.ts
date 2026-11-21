/**
 * pointer-mapping.ts — the one head-angle ↔ screen-pixel mapping
 * (dwell-sim-mcp design §1.1, §1.2; input-core design §1).
 *
 * Internal: not exported from index.ts. Pure functions; no clocks, DOM or devices.
 */

import type { Profile } from './profile.js';

export type MappingProfile = Pick<
  Profile,
  | 'headGain'
  | 'headDeadZone'
  | 'calibrationRangeLeft'
  | 'calibrationRangeRight'
  | 'calibrationRangeUp'
  | 'calibrationRangeDown'
>;

export interface MappingScreen {
  width: number;
  height: number;
}

/** A screen dimension as the engine uses it: floored, at least 1 (a non-finite value counts as 1). */
export function screenSize(n: number): number {
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** Dead zone: δ_dz = sign(δ) × max(0, |δ| − D). */
function deadZone(d: number, D: number): number {
  const m = Math.abs(d) - D;
  return m > 0 ? Math.sign(d) * m : 0;
}

/**
 * u = clamp(δ_dz / (R_eff / G) × 0.5 + 0.5, 0, 1), with R_eff = R_side − D for the side
 * δ_dz is on. Positive δ_dz uses rPos.
 */
function toUnit(dz: number, rPos: number, rNeg: number, D: number, G: number): number {
  if (dz === 0) return 0.5;
  const rEff = (dz > 0 ? rPos : rNeg) - D;
  if (!(rEff > 0)) return dz > 0 ? 1 : 0;
  const u = (dz / (rEff / G)) * 0.5 + 0.5;
  return u < 0 ? 0 : u > 1 ? 1 : u;
}

/** Centred angles (degrees, already minus the centre) → integer pixel. */
export function mapCentredAngles(
  dx: number,
  dy: number,
  p: MappingProfile,
  s: MappingScreen,
): { x: number; y: number } {
  const D = p.headDeadZone;
  const G = p.headGain;
  const ux = toUnit(deadZone(dx, D), p.calibrationRangeRight, p.calibrationRangeLeft, D, G);
  // Pitch up (positive) moves the pointer up, so it maps to smaller y.
  const uyUp = toUnit(deadZone(dy, D), p.calibrationRangeUp, p.calibrationRangeDown, D, G);
  const uy = 1 - uyUp;
  const W = screenSize(s.width);
  const H = screenSize(s.height);
  return { x: Math.round(ux * (W - 1)), y: Math.round(uy * (H - 1)) };
}

/** Inverse of toUnit/deadZone for one axis. u = 0.5 (the dead-zone band) maps to 0. */
function unmapAxis(u: number, rPos: number, rNeg: number, D: number, G: number): number {
  if (u === 0.5) return 0;
  const rEff = (u > 0.5 ? rPos : rNeg) - D;
  if (!(rEff > 0)) return u > 0.5 ? D : -D;
  const dz = ((u - 0.5) * 2 * rEff) / G;
  return Math.sign(u - 0.5) * (Math.abs(dz) + D);
}

/** Pixel (clamped to the screen) → centred angles. Inverse of mapCentredAngles on the reachable area. */
export function unmapPixel(
  x: number,
  y: number,
  p: MappingProfile,
  s: MappingScreen,
): { dx: number; dy: number } {
  const W = screenSize(s.width);
  const H = screenSize(s.height);
  // A non-finite coordinate counts as the screen centre coordinate.
  const cx = Number.isFinite(x) ? Math.min(Math.max(x, 0), W - 1) : (W - 1) / 2;
  const cy = Number.isFinite(y) ? Math.min(Math.max(y, 0), H - 1) : (H - 1) / 2;
  const ux = W > 1 ? cx / (W - 1) : 0.5;
  const uyUp = H > 1 ? 1 - cy / (H - 1) : 0.5;
  const D = p.headDeadZone;
  const G = p.headGain;
  return {
    dx: unmapAxis(ux, p.calibrationRangeRight, p.calibrationRangeLeft, D, G),
    dy: unmapAxis(uyUp, p.calibrationRangeUp, p.calibrationRangeDown, D, G),
  };
}
