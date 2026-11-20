/**
 * Pointer paths for the frame-rate tests (P15 and the Task 12.3 examples).
 *
 * A path says where the person points at each moment: a screen position, or `null` when
 * no face is detected. `cameraSamples` samples it at a camera frame rate and turns each
 * position into the head rotation that the default profile maps to that pixel (the
 * inverse of design §1), so the samples go through the real engine.
 */
import type { TimestampedSample } from '../src/api-types';
import { defaultProfile } from '../src/engine/profile';

export const SCREEN = { width: 1000, height: 800 };

/** Where the person points at time t (ms): a pixel position, or null for no face. */
export type PointerPath = (t: number) => { x: number; y: number } | null;

/** The rotation (deg) that the default profile (R 15°, dead zone 0.5°, gain 1) maps to unit position u. */
function inverse(u: number): number {
  const R = defaultProfile.calibrationRangeRight; // all four ranges are equal by default
  const D = defaultProfile.headDeadZone;
  const G = defaultProfile.headGain;
  const dz = (u - 0.5) * 2 * ((R - D) / G);
  return dz === 0 ? 0 : Math.sign(dz) * (Math.abs(dz) + D);
}

export function rotationFor(x: number, y: number): { yaw: number; pitch: number } {
  return {
    yaw: inverse(x / (SCREEN.width - 1)),
    pitch: inverse(1 - y / (SCREEN.height - 1)),
  };
}

/**
 * Samples at `fps` from t = 0 to `end` inclusive: frame k is at k × 1000 / fps. At 15 and
 * 60 fps every 15 fps frame time is also a 60 fps frame time, with the same float value.
 */
export function cameraSamples(path: PointerPath, fps: number, end: number): TimestampedSample[] {
  const out: TimestampedSample[] = [];
  for (let k = 0; ; k++) {
    const now = (k * 1000) / fps;
    if (now > end) break;
    const p = path(now);
    out.push(
      p === null
        ? { now, source: 'camera', faces: [] }
        : { now, source: 'camera', faces: [{ bbox: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.3 }, rotation: rotationFor(p.x, p.y) }] },
    );
  }
  return out;
}

/** The screen centre, where the start-up centre step is measured. */
export const CENTRE = { x: (SCREEN.width - 1) / 2, y: (SCREEN.height - 1) / 2 };
