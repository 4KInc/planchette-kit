import type { Pose } from "./types.js";

/** s(τ) = 10τ³ − 15τ⁴ + 6τ⁵ with τ clamped to [0, 1] (design §4.3). */
export function minJerk(tau: number): number {
  const t = Math.min(1, Math.max(0, tau));
  const t3 = t * t * t;
  return 10 * t3 - 15 * t3 * t + 6 * t3 * t * t;
}

export interface MoveSegment {
  t0: number;
  t1: number;
  from: Pose;
  to: Pose;
}

/**
 * pose(t) = a + (b − a) × s(τ), τ = clamp((t − t0) / MT, 0, 1), MT = t1 − t0 (design §4.3).
 * A segment with MT <= 0 is not a real move (design §4.2): it is at `from` before t0 and at `to` from t0.
 */
export function poseOnSegment(seg: MoveSegment, t: number): Pose {
  const mt = seg.t1 - seg.t0;
  const tau = mt > 0 ? (t - seg.t0) / mt : t >= seg.t0 ? 1 : 0;
  const s = minJerk(tau);
  return {
    yaw: seg.from.yaw + (seg.to.yaw - seg.from.yaw) * s,
    pitch: seg.from.pitch + (seg.to.pitch - seg.from.pitch) * s,
  };
}
