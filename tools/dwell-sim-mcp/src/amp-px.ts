/**
 * Pixel reach of tremor and tracking noise (design section 6, "ampPx"). Computed in degrees
 * first, because both are added to the head pose before the mapping, then mapped to pixels at
 * the four sign corners. Pure.
 */
import { toPx, type GeometryContext } from "./geometry.js";
import type { Pose, UserParams } from "./types.js";

/** The user parameters tremor and noise reach read. */
export type AmpUser = Pick<
  UserParams,
  | "tremorPeakToPeakDeg"
  | "tremorFrequencyHz"
  | "tremorDriftFraction"
  | "tremorAxis"
  | "trackingNoiseDeg"
>;

function tremorIsOn(u: AmpUser): boolean {
  return u.tremorPeakToPeakDeg > 0 && u.tremorFrequencyHz > 0;
}

/** `(a0 > 0 && f > 0) || n > 0`. */
export function tremorOrNoiseOn(u: AmpUser): boolean {
  return tremorIsOn(u) || u.trackingNoiseDeg > 0;
}

/**
 * Largest pointer displacement, in px, that tremor and noise can cause around `base` (a pose
 * without tremor and noise), plus 1 px for rounding.
 * `aT = a0 (1 + driftFraction) / 2` on `tremorAxis` when tremor is on, else 0; noise `n` on both axes.
 */
export function ampPx(ctx: GeometryContext, u: AmpUser, base: Pose): number {
  const aT = tremorIsOn(u) ? (u.tremorPeakToPeakDeg * (1 + u.tremorDriftFraction)) / 2 : 0;
  const n = u.trackingNoiseDeg;
  const dYaw = n + (u.tremorAxis === "yaw" ? aT : 0);
  const dPitch = n + (u.tremorAxis === "pitch" ? aT : 0);
  const origin = toPx(ctx, base);
  let best = 0;
  for (const sy of [-1, 1]) {
    for (const sp of [-1, 1]) {
      const p = toPx(ctx, { yaw: base.yaw + sy * dYaw, pitch: base.pitch + sp * dPitch });
      const d = Math.hypot(p.x - origin.x, p.y - origin.y);
      if (d > best) best = d;
    }
  }
  return best + 1;
}
