/**
 * head-pointer.ts — face lock, smoothing, dead zone and screen mapping
 * (design §1, §2 and §4; Req 2 AC 3–10, Req 5 AC 4).
 *
 * Pure logic: time is an input (`now`, ms); no clocks, DOM or devices.
 * Depends on profile.ts and smoother.ts.
 *
 * Conventions (design §4 "Head-pointer engine details"):
 *  - yaw > 0: the person turns to their right; the pointer moves right.
 *  - pitch > 0: the person looks up; the pointer moves up (screen y decreases).
 *  - Angles are in degrees. The camera adapter converts and un-mirrors them.
 */

import type { Profile } from './profile';
import {
  createSmootherState,
  cloneSmootherState,
  resetSmoother,
  stepSmoother,
  type SmootherState,
} from './smoother';

/** The smallest range of head rotation the head pointer supports, per axis (degrees). */
export const MIN_RANGE_DEG = 3;
/** Continuity score above which a re-acquired lock is flagged (design §4). */
export const LOCK_THRESHOLD = 0.15;
/** Extra time, after the gesture acceptance time, for a gesture to reach its threshold. */
export const FREEZE_EXPIRY_EXTRA_MS = 300;

export interface FaceBox {
  /** Centre and size in normalised image coordinates (0–1). */
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface FaceRotation {
  /** Degrees. Positive: turned to the person's right. */
  yaw: number;
  /** Degrees. Positive: looking up. */
  pitch: number;
}

export interface GestureScores {
  jawOpen: number;
  browRaise: number;
}

export interface DetectedFace {
  bbox: FaceBox;
  rotation: FaceRotation;
  /** This face's blendshape scores, 0–1. Used in preference to the sample-level scores. */
  gestureScores?: GestureScores;
}

export interface HeadPointerInput {
  faces: ReadonlyArray<DetectedFace>;
  /** Sample-level scores, used only when the locked face has none of its own. */
  gestureScores?: GestureScores;
  screen: { width: number; height: number };
  /** Calibrated centre rotation (θ_cx, θ_cy). */
  centre: FaceRotation;
}

export type TrackingStatusValue = 'found' | 'lost' | 'no-face-timeout';

export type HeadPointerEvent =
  | { type: 'pointer-move'; x: number; y: number }
  | { type: 'tracking-status'; status: TrackingStatusValue };

export interface HeadPointerState {
  /** Timestamp of the last accepted camera sample (-Infinity before the first). */
  t_last: number;
  /** 'none' before any face was found; then 'found' or 'lost'. */
  tracking: 'none' | 'found' | 'lost';
  /** The locked face's last known box. Valid when hasLock. */
  hasLock: boolean;
  lock: FaceBox;
  /** Continuity score of the most recent lock decision between several faces (NaN if none). */
  lockScore: number;
  /** True when the last re-acquire picked a face scoring above LOCK_THRESHOLD. The host may log it. */
  lockWarning: boolean;
  /** Boxes of the valid faces in the most recent sample, for relockFace. */
  lastFaces: FaceBox[];

  smootherX: SmootherState;
  smootherY: SmootherState;
  /** Timestamp of the last sample that updated the smoothers. */
  t_smooth: number;

  /** The pointer shown to the user (pixels). Valid when hasPointer. */
  hasPointer: boolean;
  x: number;
  y: number;
  /** The latest mapped position, which differs from x/y while frozen. */
  liveX: number;
  liveY: number;

  /** No-face timeout: when the current run of frameless samples began (NaN if none). */
  faceLostAt: number;
  /** True once no-face-timeout was emitted for the current loss. */
  timeoutEmitted: boolean;

  /** Gesture freeze (head + gesture mode only). */
  gestureAbove: boolean;
  frozen: boolean;
  freezeStart: number;
  freezeReached: boolean;
  freezeX: number;
  freezeY: number;
  /** Score of the switch gesture for the locked face on the last sample (0 if none). */
  score: number;
  /**
   * The locked face's gesture scores on the last sample (its own, else the sample-level
   * ones), or null when no face is tracked or no scores came. The host passes these to
   * the gesture engine, so both engines use the same face.
   */
  scores: GestureScores | null;
}

export function createHeadPointerState(): HeadPointerState {
  return {
    t_last: -Infinity,
    tracking: 'none',
    hasLock: false,
    lock: { cx: 0, cy: 0, w: 0, h: 0 },
    lockScore: NaN,
    lockWarning: false,
    lastFaces: [],
    smootherX: createSmootherState(),
    smootherY: createSmootherState(),
    t_smooth: -Infinity,
    hasPointer: false,
    x: 0,
    y: 0,
    liveX: 0,
    liveY: 0,
    faceLostAt: NaN,
    timeoutEmitted: false,
    gestureAbove: false,
    frozen: false,
    freezeStart: 0,
    freezeReached: false,
    freezeX: 0,
    freezeY: 0,
    score: 0,
    scores: null,
  };
}

export function cloneHeadPointerState(s: HeadPointerState): HeadPointerState {
  return {
    ...s,
    lock: { ...s.lock },
    scores: s.scores === null ? null : { ...s.scores },
    lastFaces: s.lastFaces.map((b) => ({ ...b })),
    smootherX: cloneSmootherState(s.smootherX),
    smootherY: cloneSmootherState(s.smootherY),
  };
}

/**
 * The position the dwell and gesture engines should use for target lookup:
 * null while no face is tracked, the freeze position during a gesture freeze,
 * otherwise the pointer.
 */
export function selectionPointer(s: HeadPointerState): { x: number; y: number } | null {
  if (s.tracking !== 'found' || !s.hasPointer) return null;
  if (s.frozen) return { x: s.freezeX, y: s.freezeY };
  return { x: s.x, y: s.y };
}

// ---------------------------------------------------------------------------
// Mapping (design §1)
// ---------------------------------------------------------------------------

function screenSize(n: number): number {
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** Dead zone: δ_dz = sign(δ) × max(0, |δ| − D). */
function deadZone(d: number, D: number): number {
  const m = Math.abs(d) - D;
  return m > 0 ? Math.sign(d) * m : 0;
}

/**
 * u = clamp(δ_dz / (R_eff / G) × 0.5 + 0.5, 0, 1), with R_eff = R_side − D for the side
 * δ_dz is on. Positive δ_dz uses rPos.
 */
function toUnit(dz: number, rPos: number, rNeg: number, D: number, G: number): number {
  if (dz === 0) return 0.5;
  const rEff = (dz > 0 ? rPos : rNeg) - D;
  if (!(rEff > 0)) return dz > 0 ? 1 : 0;
  const u = (dz / (rEff / G)) * 0.5 + 0.5;
  return u < 0 ? 0 : u > 1 ? 1 : u;
}

/** Filtered centred angles (degrees) → pixel position. */
function mapToPixel(
  dx: number,
  dy: number,
  profile: Profile,
  screen: { width: number; height: number },
): { x: number; y: number } {
  const D = profile.headDeadZone;
  const G = profile.headGain;
  const ux = toUnit(deadZone(dx, D), profile.calibrationRangeRight, profile.calibrationRangeLeft, D, G);
  // Pitch up (positive) moves the pointer up, so it maps to smaller y.
  const uyUp = toUnit(deadZone(dy, D), profile.calibrationRangeUp, profile.calibrationRangeDown, D, G);
  const uy = 1 - uyUp;
  const W = screenSize(screen.width);
  const H = screenSize(screen.height);
  return { x: Math.round(ux * (W - 1)), y: Math.round(uy * (H - 1)) };
}

// ---------------------------------------------------------------------------
// Face lock (design §4)
// ---------------------------------------------------------------------------

function validBox(b: FaceBox | undefined): b is FaceBox {
  return (
    b !== undefined &&
    Number.isFinite(b.cx) &&
    Number.isFinite(b.cy) &&
    Number.isFinite(b.w) &&
    Number.isFinite(b.h) &&
    b.w > 0 &&
    b.h > 0
  );
}

/** score = positionDist + 0.5 × (sizeRatio − 1). */
export function continuityScore(f: FaceBox, lock: FaceBox): number {
  const positionDist = Math.hypot(f.cx - lock.cx, f.cy - lock.cy);
  const sizeRatio = Math.max(f.w / lock.w, lock.w / f.w);
  return positionDist + 0.5 * (sizeRatio - 1);
}

/** Pick the face to lock. Returns its index in `faces`. `faces` has at least one face. */
function chooseFace(s: HeadPointerState, faces: DetectedFace[], reacquire: boolean): number {
  s.lockWarning = false;
  if (faces.length === 1) {
    // One face: lock it at once, without scoring.
    s.lockScore = NaN;
    return 0;
  }
  if (!s.hasLock) {
    // Several faces and no lock yet: the largest box.
    let best = 0;
    for (let i = 1; i < faces.length; i++) {
      const a = faces[i].bbox.w * faces[i].bbox.h;
      const b = faces[best].bbox.w * faces[best].bbox.h;
      if (a > b) best = i;
    }
    s.lockScore = NaN;
    return best;
  }
  // Several faces and a lock: the best continuity score. Ties keep the first.
  let best = 0;
  let bestScore = continuityScore(faces[0].bbox, s.lock);
  for (let i = 1; i < faces.length; i++) {
    const sc = continuityScore(faces[i].bbox, s.lock);
    if (sc < bestScore) {
      best = i;
      bestScore = sc;
    }
  }
  s.lockScore = bestScore;
  s.lockWarning = reacquire && bestScore > LOCK_THRESHOLD;
  return best;
}

function clearFreeze(s: HeadPointerState): void {
  s.frozen = false;
  s.freezeReached = false;
  s.gestureAbove = false;
}

function scoreFor(
  face: DetectedFace,
  sample: GestureScores | undefined,
  profile: Profile,
): number {
  const scores = face.gestureScores ?? sample;
  if (scores === undefined) return 0;
  const v = profile.switchGesture === 'jaw open' ? scores.jawOpen : scores.browRaise;
  return Number.isFinite(v) ? v : 0;
}

// ---------------------------------------------------------------------------
// step
// ---------------------------------------------------------------------------

/**
 * Advance the head pointer by one camera sample. Mutates `state` in place.
 * Events, in order: tracking-status (if the status changed), then pointer-move (if the
 * shown pointer moved).
 */
export function stepHeadPointer(
  state: HeadPointerState,
  input: HeadPointerInput,
  now: number,
  profile: Profile,
): HeadPointerEvent[] {
  // Req 9 AC 4: duplicate, backwards or non-finite timestamps change nothing.
  if (!Number.isFinite(now) || !(now > state.t_last)) return [];
  state.t_last = now;

  const events: HeadPointerEvent[] = [];
  const W = screenSize(input.screen.width);
  const H = screenSize(input.screen.height);

  const faces = input.faces.filter((f) => f !== null && typeof f === 'object' && validBox(f.bbox));
  state.lastFaces = faces.map((f) => ({ cx: f.bbox.cx, cy: f.bbox.cy, w: f.bbox.w, h: f.bbox.h }));

  if (faces.length === 0) {
    // Face lost (design §4): freeze the pointer, keep the lock, reset the filter.
    if (state.tracking === 'found') {
      state.tracking = 'lost';
      events.push({ type: 'tracking-status', status: 'lost' });
      resetSmoother(state.smootherX);
      resetSmoother(state.smootherY);
      clearFreeze(state);
    }
    state.score = 0;
    state.scores = null;
    if (Number.isNaN(state.faceLostAt)) state.faceLostAt = now;
    if (!state.timeoutEmitted && now - state.faceLostAt >= profile.noFaceTimeout) {
      // Once per loss: not again until a face is found and lost again.
      state.timeoutEmitted = true;
      events.push({ type: 'tracking-status', status: 'no-face-timeout' });
    }
    keepPointerOnScreen(state, W, H, events);
    return events;
  }

  // A face is detected.
  const reacquire = state.tracking !== 'found';
  const idx = chooseFace(state, faces, reacquire && state.hasLock);
  const face = faces[idx];
  state.lock.cx = face.bbox.cx;
  state.lock.cy = face.bbox.cy;
  state.lock.w = face.bbox.w;
  state.lock.h = face.bbox.h;
  state.hasLock = true;
  state.faceLostAt = NaN;
  state.timeoutEmitted = false;
  if (reacquire) {
    state.tracking = 'found';
    events.push({ type: 'tracking-status', status: 'found' });
  }

  // Smooth the locked face's centred angles, then map.
  const prevShownX = state.x;
  const prevShownY = state.y;
  const hadPointer = state.hasPointer;
  const yaw = face.rotation?.yaw;
  const pitch = face.rotation?.pitch;
  const dxRaw = (yaw as number) - input.centre.yaw;
  const dyRaw = (pitch as number) - input.centre.pitch;
  if (Number.isFinite(dxRaw) && Number.isFinite(dyRaw)) {
    const dt = (now - state.t_smooth) / 1000;
    const s = profile.smoothingStrength;
    const fx = stepSmoother(state.smootherX, { angle: dxRaw, dt, smoothingStrength: s });
    const fy = stepSmoother(state.smootherY, { angle: dyRaw, dt, smoothingStrength: s });
    state.t_smooth = now;
    const p = mapToPixel(fx, fy, profile, input.screen);
    state.liveX = p.x;
    state.liveY = p.y;
    if (!state.hasPointer) {
      state.hasPointer = true;
      state.x = p.x;
      state.y = p.y;
    }
  }
  // A rotation that is not finite leaves the filter and the live position unchanged.

  // Gesture freeze (design §4): head + gesture mode and the profile's switch gesture only.
  state.score = scoreFor(face, input.gestureScores, profile);
  const src = face.gestureScores ?? input.gestureScores;
  state.scores = src === undefined ? null : { jawOpen: src.jawOpen, browRaise: src.browRaise };
  if (profile.mode === 'head + gesture') {
    stepFreeze(state, now, profile, hadPointer ? prevShownX : state.liveX, hadPointer ? prevShownY : state.liveY);
  } else if (state.frozen || state.gestureAbove) {
    clearFreeze(state);
  }

  if (!state.hasPointer) return events;

  // Keep every stored position on the current screen (it can shrink between samples).
  state.liveX = Math.min(state.liveX, W - 1);
  state.liveY = Math.min(state.liveY, H - 1);
  state.freezeX = Math.min(state.freezeX, W - 1);
  state.freezeY = Math.min(state.freezeY, H - 1);

  // The shown pointer: the freeze position while frozen, else the live position.
  const nx = state.frozen ? state.freezeX : state.liveX;
  const ny = state.frozen ? state.freezeY : state.liveY;
  setShown(state, nx, ny, W, H, events, hadPointer);
  return events;
}

function stepFreeze(
  s: HeadPointerState,
  now: number,
  profile: Profile,
  shownX: number,
  shownY: number,
): void {
  const rel = profile.gestureReleaseThreshold;
  const thr = profile.gestureThreshold;
  const v = s.score;
  if (!s.gestureAbove) {
    if (v > rel && s.hasPointer) {
      // The score rose above the release threshold: freeze at the pointer shown before this sample.
      s.gestureAbove = true;
      s.frozen = true;
      s.freezeStart = now;
      s.freezeReached = v >= thr;
      s.freezeX = shownX;
      s.freezeY = shownY;
    }
    return;
  }
  if (v < rel) {
    // The gesture ended.
    clearFreeze(s);
    return;
  }
  if (!s.frozen) return; // expired; waits for the score to fall below the release threshold
  if (v >= thr) s.freezeReached = true;
  if (!s.freezeReached && now - s.freezeStart >= profile.gestureAcceptanceTime + FREEZE_EXPIRY_EXTRA_MS) {
    // Expiry: a half gesture does not hold the pointer. No new freeze until the score drops.
    s.frozen = false;
  }
}

function setShown(
  s: HeadPointerState,
  x: number,
  y: number,
  W: number,
  H: number,
  events: HeadPointerEvent[],
  hadPointer: boolean,
): void {
  const cx = Math.max(0, Math.min(W - 1, x));
  const cy = Math.max(0, Math.min(H - 1, y));
  if (!hadPointer || cx !== s.x || cy !== s.y) {
    s.x = cx;
    s.y = cy;
    events.push({ type: 'pointer-move', x: cx, y: cy });
  }
}

/** While lost, the frozen pointer still follows a screen resize. */
function keepPointerOnScreen(s: HeadPointerState, W: number, H: number, events: HeadPointerEvent[]): void {
  if (!s.hasPointer) return;
  const cx = Math.min(s.x, W - 1);
  const cy = Math.min(s.y, H - 1);
  s.freezeX = Math.min(s.freezeX, W - 1);
  s.freezeY = Math.min(s.freezeY, H - 1);
  if (cx !== s.x || cy !== s.y) {
    s.x = cx;
    s.y = cy;
    events.push({ type: 'pointer-move', x: cx, y: cy });
  }
}

/**
 * Carer re-lock (design §4): lock the face at `faceIndex` in the most recent sample's face
 * list and emit tracking-status: found. An invalid index does nothing. The filter is reset,
 * so the pointer goes straight to the new face's pose on the next sample.
 */
export function relockFace(state: HeadPointerState, faceIndex: number): HeadPointerEvent[] {
  if (!Number.isInteger(faceIndex) || faceIndex < 0 || faceIndex >= state.lastFaces.length) return [];
  const b = state.lastFaces[faceIndex];
  state.lock.cx = b.cx;
  state.lock.cy = b.cy;
  state.lock.w = b.w;
  state.lock.h = b.h;
  state.hasLock = true;
  state.tracking = 'found';
  state.faceLostAt = NaN;
  state.timeoutEmitted = false;
  state.lockWarning = false;
  resetSmoother(state.smootherX);
  resetSmoother(state.smootherY);
  clearFreeze(state);
  return [{ type: 'tracking-status', status: 'found' }];
}
