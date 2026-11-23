/**
 * Reachable pixel rectangle (design sections 1.2 and 6.3 of the dwell-sim-mcp design).
 * The corners come from `rotationToPoint` (through `toPx`) at the extreme head-range rotations
 * with the effective profile. All functions are pure.
 */
import type { Rect } from "@planchette/skeleton";
import { toPx, type GeometryContext } from "./geometry.js";

/** Closed pixel rectangle `[xMin, xMax] x [yMin, yMax]` (integer pixel coordinates). */
export interface ReachableRect {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/**
 * The pixels the user's head can reach (absolute head-range limits mapped through the captured centre): x from yaw = -left to +right, y from pitch = +up (top)
 * to -down (bottom). The mapping is separable and monotone per axis, so the extreme rotations
 * give the exact rectangle.
 */
export function reachableRect(ctx: GeometryContext): ReachableRect {
  const { left, right, up, down } = ctx.headRange;
  return {
    xMin: toPx(ctx, { yaw: -left, pitch: 0 }).x,
    xMax: toPx(ctx, { yaw: right, pitch: 0 }).x,
    yMin: toPx(ctx, { yaw: 0, pitch: up }).y,
    yMax: toPx(ctx, { yaw: 0, pitch: -down }).y,
  };
}

/** True when some integer pixel `p` with `lo <= p < lo + size` lies in `[min, max]`. */
function axisOverlaps(lo: number, size: number, min: number, max: number): boolean {
  if (!(Number.isFinite(lo) && Number.isFinite(size)) || !(size > 0)) return false;
  const first = Math.max(Math.ceil(lo), min);
  const last = Math.min(Math.ceil(lo + size) - 1, max);
  return first <= last;
}

/**
 * A target is reachable when at least one pixel of its rectangle `[x, x + w) x [y, y + h)` is in
 * the reachable rectangle. A partly overlapping target is reachable; an empty rectangle is not.
 */
export function isTargetReachable(ctx: GeometryContext, rect: Rect): boolean {
  const r = reachableRect(ctx);
  return (
    axisOverlaps(rect.x, rect.width, r.xMin, r.xMax) &&
    axisOverlaps(rect.y, rect.height, r.yMin, r.yMax)
  );
}
