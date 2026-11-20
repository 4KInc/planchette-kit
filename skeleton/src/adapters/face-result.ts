/**
 * face-result.ts — turns a MediaPipe FaceLandmarker result into the engine's faces
 * (design §7 "Camera adapter details"). Pure: no DOM, no MediaPipe import (the result
 * shape is described structurally, so tests can build one by hand).
 */
import type { DetectedFace } from '../engine/head-pointer.js';

/** The parts of a FaceLandmarkerResult the adapter reads. */
export interface FaceResultLike {
  faceLandmarks: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>;
  faceBlendshapes?: ReadonlyArray<{ categories: ReadonlyArray<{ categoryName: string; score: number }> }>;
  facialTransformationMatrixes?: ReadonlyArray<{ rows: number; columns: number; data: ReadonlyArray<number> }>;
}

const DEG = 180 / Math.PI;

/**
 * Head rotation from a 4 x 4 facial transformation matrix, stored column-major (as
 * MediaPipe's MatrixData and three.js `Matrix4.fromArray`). The face's forward axis is the
 * third column (m[8], m[9], m[10]). The camera image is not mirrored, so a person turning
 * to their right turns the forward axis toward the camera's −x: yaw = atan2(−f.x, f.z).
 * Looking up turns it toward +y: pitch = atan2(f.y, √(f.x² + f.z²)). Degrees.
 * A missing or malformed matrix gives NaN, which the engine treats as "rotation unknown"
 * (the face stays locked and the pointer holds; design §4).
 */
export function rotationFromMatrix(m: { rows: number; columns: number; data: ReadonlyArray<number> } | undefined): {
  yaw: number;
  pitch: number;
} {
  if (m === undefined || m.rows !== 4 || m.columns !== 4 || m.data.length < 16) return { yaw: NaN, pitch: NaN };
  const fx = m.data[8];
  const fy = m.data[9];
  const fz = m.data[10];
  return { yaw: Math.atan2(-fx, fz) * DEG, pitch: Math.atan2(fy, Math.hypot(fx, fz)) * DEG };
}

/** The box around a face's landmarks, in normalised image coordinates. */
function boxOf(points: ReadonlyArray<{ x: number; y: number }>): DetectedFace['bbox'] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
}

/** A blendshape score by name; 0 when missing. */
function score(shapes: ReadonlyArray<{ categoryName: string; score: number }> | undefined, name: string): number {
  if (shapes === undefined) return 0;
  for (const c of shapes) if (c.categoryName === name) return c.score;
  return 0;
}

/**
 * The faces in a result. Gesture scores: `jawOpen` is MediaPipe's `jawOpen`; `browRaise`
 * is `browInnerUp` (both brows raised lift the inner brow most; tech.md).
 */
export function facesFromResult(result: FaceResultLike): DetectedFace[] {
  const out: DetectedFace[] = [];
  result.faceLandmarks.forEach((points, i) => {
    if (points.length === 0) return;
    const shapes = result.faceBlendshapes?.[i]?.categories;
    out.push({
      bbox: boxOf(points),
      rotation: rotationFromMatrix(result.facialTransformationMatrixes?.[i]),
      gestureScores: { jawOpen: score(shapes, 'jawOpen'), browRaise: score(shapes, 'browInnerUp') },
    });
  });
  return out;
}
