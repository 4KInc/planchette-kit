/**
 * End-point scatter (design section 4.4): Acklam's normal quantile, a truncated normal on
 * (-3, 3) by inverse transform, and the aim point of one task entry. Every draw goes
 * through `u01`; exactly two uniforms are read per aim, so the draw count is fixed.
 */
import type { Rect } from "@planchette/skeleton";
import { angularWidth, clampToHeadRange, toPose, type GeometryContext } from "./geometry.js";
import { u01, type Stream } from "./rng.js";
import type { Pose } from "./types.js";

/** Φ(-3) and Φ(3). */
export const PHI_MINUS_3 = 0.0013498980316301;
export const PHI_3 = 0.9986501019683699;

/** Scatter SD = W / WIDTH_PER_SD per axis, before the user's cap (2.5 deg / 4.133 = 0.6 deg). */
const WIDTH_PER_SD = 4.133;
const TRUNCATION = 3;
const TRUNCATION_CLAMP = TRUNCATION - 1e-9;

// Acklam's coefficients, copied from design section 4.4.
const A1 = -3.969683028665376e1;
const A2 = 2.209460984245205e2;
const A3 = -2.759285104469687e2;
const A4 = 1.38357751867269e2;
const A5 = -3.066479806614716e1;
const A6 = 2.506628277459239;
const B1 = -5.447609879822406e1;
const B2 = 1.615858368580409e2;
const B3 = -1.556989798598866e2;
const B4 = 6.680131188771972e1;
const B5 = -1.328068155288572e1;
const C1 = -7.784894002430293e-3;
const C2 = -3.223964580411365e-1;
const C3 = -2.400758277161838;
const C4 = -2.549732539343734;
const C5 = 4.374664141464968;
const C6 = 2.938163982698783;
const D1 = 7.784695709041462e-3;
const D2 = 3.224671290700398e-1;
const D3 = 2.445134137142996;
const D4 = 3.754408661907416;

const P_LOW = 0.02425;
const P_HIGH = 1 - P_LOW;

function tail(q: number): number {
  return (
    (((((C1 * q + C2) * q + C3) * q + C4) * q + C5) * q + C6) /
    ((((D1 * q + D2) * q + D3) * q + D4) * q + 1)
  );
}

/**
 * Acklam's rational approximation of the standard normal quantile. Relative error is at most
 * 1.135e-9 over [Φ(-3), Φ(3)]. Defined for 0 < p < 1; returns -Infinity at 0 and +Infinity at 1.
 */
export function probit(p: number): number {
  if (!(p > 0)) return p === 0 ? -Infinity : Number.NaN;
  if (!(p < 1)) return p === 1 ? Infinity : Number.NaN;
  if (p < P_LOW) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > P_HIGH) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((A1 * r + A2) * r + A3) * r + A4) * r + A5) * r + A6) * q) /
    (((((B1 * r + B2) * r + B3) * r + B4) * r + B5) * r + 1)
  );
}

/** Truncated standard normal on (-3, 3) by inverse transform, from one uniform in [0, 1). */
export function ttn(u: number): number {
  const z = probit(PHI_MINUS_3 + u * (PHI_3 - PHI_MINUS_3));
  return Math.min(TRUNCATION_CLAMP, Math.max(-TRUNCATION_CLAMP, z));
}

/**
 * The head pose a user aims at for task entry `k` on a target `rect`. Reads exactly two
 * uniforms: `u01(aim, k, 0)` for yaw and `u01(aim, k, 1)` for pitch. `aim` must be the
 * stream made with `Purpose.Aim`. The result is limited to the user's head range.
 */
export function sampleAim(
  ctx: GeometryContext,
  rect: Rect,
  scatterCapDeg: number,
  aim: Stream,
  k: number,
): Pose {
  const sdX = Math.min(angularWidth(ctx, rect, "x") / WIDTH_PER_SD, scatterCapDeg);
  const sdY = Math.min(angularWidth(ctx, rect, "y") / WIDTH_PER_SD, scatterCapDeg);
  const zx = ttn(u01(aim, k, 0));
  const zy = ttn(u01(aim, k, 1));
  const c = toPose(ctx, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
  return clampToHeadRange(ctx.headRange, { yaw: c.yaw + zx * sdX, pitch: c.pitch + zy * sdY });
}
