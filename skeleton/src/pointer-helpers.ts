/**
 * pointer-helpers.ts — public head-angle ↔ screen-pixel helpers (dwell-sim-mcp design §1.1).
 *
 * Both functions are pure: they read only their arguments, do not modify them, and use the
 * engine's own mapping so callers cannot disagree with it. Angles are degrees, yaw > 0 to the
 * right and pitch > 0 up.
 */
import type { ScreenSize } from './api-types.js';
import type { FaceRotation } from './engine/head-pointer.js';
import {
  mapCentredAngles,
  unmapPixel,
  type MappingProfile,
} from './engine/pointer-mapping.js';

export type { MappingProfile };
export type HeadRotation = FaceRotation;
export type ScreenPoint = { x: number; y: number };

/** The head rotation that puts the pointer at `point`, given the calibrated `centre`. */
export function pointToRotation(
  profile: MappingProfile,
  screen: ScreenSize,
  centre: HeadRotation,
  point: ScreenPoint,
): HeadRotation {
  const { dx, dy } = unmapPixel(point.x, point.y, profile, screen);
  return { yaw: centre.yaw + dx, pitch: centre.pitch + dy };
}

/** The pixel the pointer is at for head `rotation`, given the calibrated `centre`. */
export function rotationToPoint(
  profile: MappingProfile,
  screen: ScreenSize,
  centre: HeadRotation,
  rotation: HeadRotation,
): ScreenPoint {
  return mapCentredAngles(rotation.yaw - centre.yaw, rotation.pitch - centre.pitch, profile, screen);
}
