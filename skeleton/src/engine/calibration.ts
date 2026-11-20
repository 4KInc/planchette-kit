/**
 * calibration.ts — calibration engine (Req 7 AC 1–2, Req 5 AC 5; design §5
 * "Calibration engine details").
 *
 * A full run measures the centre and the four head ranges, then the gesture rest and
 * deliberate scores. A centre-only run measures the centre alone. Every step advances
 * when the head has been still for the stillness time, or at the step timeout.
 *
 * Pure logic: time is an input (`now`, ms); no clocks, DOM or devices. The engine never
 * changes the profile: the done event carries the fields to apply.
 */
import { clampProfile, type Profile } from './profile';
import { MIN_RANGE_DEG, type FaceRotation, type GestureScores } from './head-pointer';
import { switchGestureScore } from './gesture';

export type CalibrationRun = 'full' | 'centre';
export type CalibrationStepName =
  | 'centre' | 'left' | 'right' | 'up' | 'down' | 'rest' | 'gesture' | 'done';

/** Smallest deliberate − rest score range that is used to set the thresholds. */
export const GESTURE_MIN_RANGE = 0.15;
export const GESTURE_THRESHOLD_FRACTION = 0.6;
export const GESTURE_RELEASE_FRACTION = 0.3;
/** Percentile of the scores in the gesture phase taken as the deliberate score. */
export const DELIBERATE_PERCENTILE = 0.9;
/** Head rotation standard deviation (degrees) above which high-tremor smoothing is suggested. */
export const TREMOR_STD_DEG = 0.5;

export interface CalibrationInput {
  /** Head rotation, or null when no face is detected. */
  rotation: FaceRotation | null;
  /** Blendshape scores, or null when no face is detected. */
  gestureScores?: GestureScores | null;
}

export interface CalibrationRanges {
  left: number;
  right: number;
  up: number;
  down: number;
}

export interface GestureCalibration {
  rest: number | null;
  deliberate: number | null;
  range: number | null;
  /** True when the thresholds were set from the scores. */
  applied: boolean;
  /** Why the existing thresholds were kept. */
  kept: null | 'range-too-small' | 'no-measurement';
}

export interface CalibrationResult {
  run: CalibrationRun;
  centre: FaceRotation | null;
  ranges: CalibrationRanges | null;
  rejected: null | 'range-too-small' | 'no-centre';
  suggestHighTremor: boolean;
  gesture: GestureCalibration | null;
  /** The profile fields to apply (with setProfile, which clamps). */
  profile: Partial<Profile>;
}

export type CalibrationEvent =
  | { type: 'step'; run: CalibrationRun; step: CalibrationStepName; completed: boolean; timeout: boolean }
  | { type: 'done'; run: CalibrationRun; result: CalibrationResult };

interface Sample {
  yaw: number;
  pitch: number;
  score: number;
}

interface Measurement {
  meanYaw: number;
  meanPitch: number;
  stdYaw: number;
  stdPitch: number;
  meanScore: number;
  /** Scores sorted ascending. */
  scores: number[];
}

export interface CalibrationState {
  run: CalibrationRun;
  step: CalibrationStepName;
  started: boolean;
  stepStart: number;
  /** Every face sample of the current step. */
  samples: Sample[];
  /** Index in `samples` where the current stillness window begins. */
  windowFrom: number;
  /** Time of the first sample of the window. */
  windowStart: number;
  minYaw: number;
  maxYaw: number;
  minPitch: number;
  maxPitch: number;
  centre: FaceRotation | null;
  means: { left: FaceRotation | null; right: FaceRotation | null; up: FaceRotation | null; down: FaceRotation | null };
  suggestHighTremor: boolean;
  rest: number | null;
  deliberate: number | null;
}

const EMPTY: CalibrationEvent[] = Object.freeze([]) as unknown as CalibrationEvent[];

export function createCalibrationState(run: CalibrationRun = 'full'): CalibrationState {
  return {
    run,
    step: 'centre',
    started: false,
    stepStart: 0,
    samples: [],
    windowFrom: 0,
    windowStart: 0,
    minYaw: 0,
    maxYaw: 0,
    minPitch: 0,
    maxPitch: 0,
    centre: null,
    means: { left: null, right: null, up: null, down: null },
    suggestHighTremor: false,
    rest: null,
    deliberate: null,
  };
}

export function cloneCalibrationState(s: CalibrationState): CalibrationState {
  return {
    ...s,
    samples: s.samples.map((x) => ({ ...x })),
    centre: s.centre && { ...s.centre },
    means: {
      left: s.means.left && { ...s.means.left },
      right: s.means.right && { ...s.means.right },
      up: s.means.up && { ...s.means.up },
      down: s.means.down && { ...s.means.down },
    },
  };
}

const FULL_ORDER: CalibrationStepName[] = ['centre', 'left', 'right', 'up', 'down', 'rest', 'gesture', 'done'];
const CENTRE_ORDER: CalibrationStepName[] = ['centre', 'done'];

function nextStep(s: CalibrationState): CalibrationStepName {
  const order = s.run === 'full' ? FULL_ORDER : CENTRE_ORDER;
  return order[order.indexOf(s.step) + 1] ?? 'done';
}

function measure(samples: Sample[]): Measurement | null {
  const n = samples.length;
  if (n === 0) return null;
  let sy = 0, sp = 0, ss = 0;
  for (const x of samples) { sy += x.yaw; sp += x.pitch; ss += x.score; }
  const meanYaw = sy / n, meanPitch = sp / n;
  let vy = 0, vp = 0;
  for (const x of samples) { vy += (x.yaw - meanYaw) ** 2; vp += (x.pitch - meanPitch) ** 2; }
  return {
    meanYaw,
    meanPitch,
    stdYaw: Math.sqrt(vy / n),
    stdPitch: Math.sqrt(vp / n),
    meanScore: ss / n,
    scores: samples.map((x) => x.score).sort((a, b) => a - b),
  };
}

function startStep(s: CalibrationState, now: number): void {
  s.stepStart = now;
  s.samples = [];
  s.windowFrom = 0;
}

/** Nearest-rank percentile of an ascending list. */
function percentile(sorted: number[], p: number): number {
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
}

function buildResult(s: CalibrationState, profile: Profile): CalibrationResult {
  const out: Partial<Profile> = {};
  let ranges: CalibrationRanges | null = null;
  let rejected: CalibrationResult['rejected'] = null;
  let gesture: GestureCalibration | null = null;

  if (s.run === 'full') {
    const c = s.centre;
    const m = s.means;
    if (!c) {
      rejected = 'no-centre';
    } else if (!m.left || !m.right || !m.up || !m.down) {
      rejected = 'range-too-small';
    } else {
      const r = {
        left: c.yaw - m.left.yaw,
        right: m.right.yaw - c.yaw,
        up: m.up.pitch - c.pitch,
        down: c.pitch - m.down.pitch,
      };
      if ([r.left, r.right, r.up, r.down].some((v) => !Number.isFinite(v) || v < MIN_RANGE_DEG)) {
        rejected = 'range-too-small';
      } else {
        ranges = r;
        out.calibrationRangeLeft = r.left;
        out.calibrationRangeRight = r.right;
        out.calibrationRangeUp = r.up;
        out.calibrationRangeDown = r.down;
      }
    }

    const { rest, deliberate } = s;
    if (rest === null || deliberate === null) {
      gesture = { rest, deliberate, range: null, applied: false, kept: 'no-measurement' };
    } else {
      const range = deliberate - rest;
      if (range < GESTURE_MIN_RANGE) {
        gesture = { rest, deliberate, range, applied: false, kept: 'range-too-small' };
      } else {
        const clamped = clampProfile(
          {
            gestureThreshold: rest + GESTURE_THRESHOLD_FRACTION * range,
            gestureReleaseThreshold: rest + GESTURE_RELEASE_FRACTION * range,
          },
          profile,
        );
        out.gestureThreshold = clamped.gestureThreshold;
        out.gestureReleaseThreshold = clamped.gestureReleaseThreshold;
        gesture = { rest, deliberate, range, applied: true, kept: null };
      }
    }
  }

  return {
    run: s.run,
    centre: s.centre ? { ...s.centre } : null,
    ranges,
    rejected,
    suggestHighTremor: s.run === 'full' && s.suggestHighTremor,
    gesture,
    profile: out,
  };
}

/** Record the finished step's measurement. */
function finishStep(s: CalibrationState, m: Measurement | null): void {
  const at = m && { yaw: m.meanYaw, pitch: m.meanPitch };
  switch (s.step) {
    case 'centre': s.centre = at; break;
    case 'left': s.means.left = at; break;
    case 'right': s.means.right = at; break;
    case 'up': s.means.up = at; break;
    case 'down': s.means.down = at; break;
    case 'rest': s.rest = m ? m.meanScore : null; break;
    case 'gesture': s.deliberate = m ? percentile(m.scores, DELIBERATE_PERCENTILE) : null; break;
    default: break;
  }
  const isHead = s.step !== 'rest' && s.step !== 'gesture';
  if (m && isHead && (m.stdYaw > TREMOR_STD_DEG || m.stdPitch > TREMOR_STD_DEG)) {
    s.suggestHighTremor = true;
  }
}

/**
 * Advance calibration by one camera sample. Mutates `state` in place.
 * The returned array is shared and frozen when empty. Do not mutate it.
 */
export function stepCalibration(
  state: CalibrationState,
  input: CalibrationInput,
  now: number,
  profile: Profile,
): CalibrationEvent[] {
  if (state.step === 'done' || !Number.isFinite(now)) return EMPTY;
  const events: CalibrationEvent[] = [];
  if (!state.started) {
    state.started = true;
    startStep(state, now);
    events.push({ type: 'step', run: state.run, step: state.step, completed: false, timeout: false });
  }

  const r = input.rotation;
  if (r && Number.isFinite(r.yaw) && Number.isFinite(r.pitch)) {
    const sample: Sample = {
      yaw: r.yaw,
      pitch: r.pitch,
      score: input.gestureScores ? switchGestureScore(input.gestureScores, profile) : 0,
    };
    const thr = profile.calibrationStillnessThreshold;
    let still = false;
    if (state.samples.length > state.windowFrom) {
      const spreadYaw = Math.max(state.maxYaw, sample.yaw) - Math.min(state.minYaw, sample.yaw);
      const spreadPitch = Math.max(state.maxPitch, sample.pitch) - Math.min(state.minPitch, sample.pitch);
      still = spreadYaw <= thr && spreadPitch <= thr;
    }
    if (still) {
      state.minYaw = Math.min(state.minYaw, sample.yaw);
      state.maxYaw = Math.max(state.maxYaw, sample.yaw);
      state.minPitch = Math.min(state.minPitch, sample.pitch);
      state.maxPitch = Math.max(state.maxPitch, sample.pitch);
    } else {
      state.windowFrom = state.samples.length;
      state.windowStart = now;
      state.minYaw = state.maxYaw = sample.yaw;
      state.minPitch = state.maxPitch = sample.pitch;
    }
    state.samples.push(sample);
  } else {
    // No face: the window empties, the step clock keeps running.
    state.windowFrom = state.samples.length;
  }

  const stillDone =
    state.samples.length > state.windowFrom &&
    now - state.windowStart >= profile.calibrationStillnessTime;
  const timedOut = now - state.stepStart >= profile.calibrationStepTimeout;
  if (!stillDone && !timedOut) return events.length ? events : EMPTY;

  const m = measure(stillDone ? state.samples.slice(state.windowFrom) : state.samples);
  finishStep(state, m);
  events.push({ type: 'step', run: state.run, step: state.step, completed: true, timeout: !stillDone });
  state.step = nextStep(state);
  startStep(state, now);
  if (state.step === 'done') {
    events.push({ type: 'done', run: state.run, result: buildResult(state, profile) });
  } else {
    events.push({ type: 'step', run: state.run, step: state.step, completed: false, timeout: false });
  }
  return events;
}
