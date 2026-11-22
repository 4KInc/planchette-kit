/**
 * Pixels and degrees (design section 4.1). Every conversion goes through the skeleton's
 * `pointToRotation` and `rotationToPoint`, so the simulator cannot disagree with the engine.
 * All functions are pure.
 */
import { pointToRotation, rotationToPoint } from "@planchette/skeleton";
import type { MappingProfile, Rect, ScreenSize } from "@planchette/skeleton";
import type { Point, Pose } from "./types.js";

export interface HeadRange {
  left: number;
  right: number;
  up: number;
  down: number;
}

/** What the helpers need: the effective profile, the screen and the user's head range. */
export interface GeometryContext {
  /** The effective profile (`getProfile()` after `setProfile`). */
  profile: MappingProfile;
  screen: ScreenSize;
  headRange: HeadRange;
}

const ZERO: Pose = { yaw: 0, pitch: 0 };

/** The pixel the pointer is at for a head pose (relative to the centre pose). */
export function toPx(ctx: GeometryContext, pose: Pose): Point {
  return rotationToPoint(ctx.profile, ctx.screen, ZERO, pose);
}

/** The head pose that puts the pointer at a pixel. Not clamped to the head range. */
export function toPose(ctx: GeometryContext, px: Point): Pose {
  return pointToRotation(ctx.profile, ctx.screen, ZERO, px);
}

/** Clamps yaw to [-left, +right] and pitch to [-down, +up]. */
export function clampToHeadRange(range: HeadRange, pose: Pose): Pose {
  return {
    yaw: Math.min(range.right, Math.max(-range.left, pose.yaw)),
    pitch: Math.min(range.up, Math.max(-range.down, pose.pitch)),
  };
}

/** The head pose for a pixel, limited to the user's head range. */
export function poseAtPx(ctx: GeometryContext, px: Point): Pose {
  return clampToHeadRange(ctx.headRange, toPose(ctx, px));
}

/**
 * Head angle, in degrees, between the two edges of `rect` on one axis. Axis 'x' uses yaw,
 * axis 'y' uses pitch. The other coordinate is the rectangle's centre.
 */
export function angularWidth(ctx: GeometryContext, rect: Rect, axis: "x" | "y"): number {
  if (axis === "x") {
    const cy = rect.y + rect.height / 2;
    const a = toPose(ctx, { x: rect.x + rect.width, y: cy }).yaw;
    const b = toPose(ctx, { x: rect.x, y: cy }).yaw;
    return Math.abs(a - b);
  }
  const cx = rect.x + rect.width / 2;
  const a = toPose(ctx, { x: cx, y: rect.y + rect.height }).pitch;
  const b = toPose(ctx, { x: cx, y: rect.y }).pitch;
  return Math.abs(a - b);
}
