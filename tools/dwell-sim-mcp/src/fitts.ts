// Movement time from Fitts' law, Shannon formulation (design §4.2).
// W > 0 and TP > 0 are guaranteed by input validation (Task 14), so no guard is
// needed in this file. For a valid layout W >= min(width, height) > 0 (design §4.2).
/** Shortest movement time of a real move, ms (chosen, design §4.2). */
export const MT_MIN = 150;
/** A move shorter than this many px is no move: the user holds (design §4.2). */
export const MIN_MOVE_PX = 0.5;

/**
 * Extent of a rectangle projected on the unit movement direction d (design §4.2):
 * W = width × |d.x| + height × |d.y|.
 */
export function projectedWidth(
  rect: { width: number; height: number },
  dx: number,
  dy: number,
): number {
  return rect.width * Math.abs(dx) + rect.height * Math.abs(dy);
}

/**
 * MT = max(MT_MIN, 1000 × log2(A / W + 1) / TP) in ms, with A and W in px and TP in bits/s.
 * Returns 0 (no move segment) when A < 0.5 px.
 *
 * No guard against W = 0 or TP = 0: both are > 0 by input validation (Task 14),
 * and W >= min(width, height) > 0 for a valid layout (design §4.2).
 */
export function movementTimeMs(A: number, W: number, TP: number): number {
  if (A < MIN_MOVE_PX) return 0;
  const id = Math.log2(A / W + 1);
  return Math.max(MT_MIN, (1000 * id) / TP);
}
