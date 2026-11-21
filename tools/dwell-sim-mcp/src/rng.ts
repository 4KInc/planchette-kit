/**
 * Counter-based random draws. Every value is a hash of its own key, so there is no
 * generator state to advance and no draw can shift another (design section 3).
 */

/** murmur3 fmix32. */
function mix32(z: number): number {
  z ^= z >>> 16;
  z = Math.imul(z, 0x85ebca6b);
  z ^= z >>> 13;
  z = Math.imul(z, 0xc2b2ae35);
  z ^= z >>> 16;
  return z >>> 0;
}

/** Hash of the given integers, each taken as an int32. Returns an unsigned 32-bit value. */
export function hash32(...ints: number[]): number {
  let h = 0x811c9dc5;
  for (const x of ints) h = mix32(((h ^ (x | 0)) + 0x9e3779b9) | 0);
  return h >>> 0;
}

export const enum Purpose {
  Aim = 1,
  Reaction,
  TremorPhase,
  TremorDriftKnot,
  ReadingPauseChance,
  ReadingPauseLength,
  TrackingNoise,
  ScanLatePress,
  TaskOrder,
  Start,
}

export interface Stream {
  readonly seed: number;
}

/** A stream is the hash of (requestSeed, userKey, trialIndex, purpose). */
export function stream(
  requestSeed: number,
  userKey: number,
  trialIndex: number,
  purpose: Purpose,
): Stream {
  return { seed: hash32(requestSeed, userKey, trialIndex, purpose) };
}

/** Uniform in [0, 1) with 53 bits, keyed by up to two counters. */
export function u01(s: Stream, k: number, j = 0): number {
  const hi = hash32(s.seed, k, j, 0) >>> 5;
  const lo = hash32(s.seed, k, j, 1) >>> 6;
  return (hi * 67108864 + lo) / 9007199254740992;
}
