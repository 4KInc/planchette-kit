/**
 * profile.ts — single source of truth for every profile field.
 *
 * No dependencies on other engine files.
 *
 * Fields (30 total, matching the Profile fields table in requirements.md):
 *  1  mode
 *  2  startCameraOnLoad
 *  3  switchGesture
 *  4  switchBinding
 *  5  headGain
 *  6  headDeadZone
 *  7  smoothingStrength
 *  8  dwellTime
 *  9  graceTime
 * 10  postSelectionPause
 * 11  autoRepeatInterval
 * 12  scanInterval
 * 13  scanLoopsBeforePause
 * 14  switchAcceptanceTime
 * 15  gestureAcceptanceTime
 * 16  gestureThreshold
 * 17  gestureReleaseThreshold
 * 18  cancelByHold
 * 19  cancelHoldTime
 * 20  noFaceTimeout
 * 21  inputTimeout
 * 22  calibrationRangeLeft
 * 23  calibrationRangeRight
 * 24  calibrationRangeUp
 * 25  calibrationRangeDown
 * 26  calibrationStillnessThreshold
 * 27  calibrationStillnessTime
 * 28  calibrationStepTimeout
 * 29  targetSize
 * 30  targetSpacing
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Mode =
  | 'head + dwell'
  | 'head + gesture'
  | 'scan'
  | 'gesture scan'
  | 'mouse';

export type SwitchGesture = 'jaw open' | 'brow raise';

export interface Profile {
  // 1
  mode: Mode;
  // 2
  startCameraOnLoad: boolean;
  // 3
  switchGesture: SwitchGesture;
  // 4  key name, e.g. ' ' (Space), 'MouseLeft', 'GamepadButton0'
  switchBinding: string;
  // 5
  headGain: number;
  // 6  degrees
  headDeadZone: number;
  // 7  0–1
  smoothingStrength: number;
  // 8  ms
  dwellTime: number;
  // 9  ms
  graceTime: number;
  // 10 ms
  postSelectionPause: number;
  // 11 ms
  autoRepeatInterval: number;
  // 12 ms
  scanInterval: number;
  // 13 count
  scanLoopsBeforePause: number;
  // 14 ms
  switchAcceptanceTime: number;
  // 15 ms
  gestureAcceptanceTime: number;
  // 16 0–1
  gestureThreshold: number;
  // 17 0–1
  gestureReleaseThreshold: number;
  // 18
  cancelByHold: boolean;
  // 19 ms
  cancelHoldTime: number;
  // 20 ms
  noFaceTimeout: number;
  // 21 ms
  inputTimeout: number;
  // 22 degrees
  calibrationRangeLeft: number;
  // 23 degrees
  calibrationRangeRight: number;
  // 24 degrees
  calibrationRangeUp: number;
  // 25 degrees
  calibrationRangeDown: number;
  // 26 degrees
  calibrationStillnessThreshold: number;
  // 27 ms
  calibrationStillnessTime: number;
  // 28 ms
  calibrationStepTimeout: number;
  // 29 CSS px
  targetSize: number;
  // 30 CSS px
  targetSpacing: number;
}

export interface ImportResult {
  profile: Profile;
  changes: string[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default calibration range (degrees) — the reference calibration from requirements. */
const DEFAULT_CALIBRATION_RANGE = 15;

export const defaultProfile: Profile = {
  mode: 'head + dwell',
  startCameraOnLoad: false,
  switchGesture: 'jaw open',
  switchBinding: ' ', // Space key
  headGain: 1.0,
  headDeadZone: 0.5,
  smoothingStrength: 0.5,
  dwellTime: 1000,
  graceTime: 150,
  postSelectionPause: 500,
  autoRepeatInterval: 1000,
  scanInterval: 1200,
  scanLoopsBeforePause: 3,
  switchAcceptanceTime: 0,
  gestureAcceptanceTime: 300,
  gestureThreshold: 0.5,
  gestureReleaseThreshold: 0.3,
  cancelByHold: true,
  cancelHoldTime: 2000,
  noFaceTimeout: 10000,
  inputTimeout: 2000,
  calibrationRangeLeft: DEFAULT_CALIBRATION_RANGE,
  calibrationRangeRight: DEFAULT_CALIBRATION_RANGE,
  calibrationRangeUp: DEFAULT_CALIBRATION_RANGE,
  calibrationRangeDown: DEFAULT_CALIBRATION_RANGE,
  calibrationStillnessThreshold: 2,
  calibrationStillnessTime: 1500,
  calibrationStepTimeout: 6000,
  targetSize: 96,
  targetSpacing: 16,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const VALID_MODES: Mode[] = [
  'head + dwell',
  'head + gesture',
  'scan',
  'gesture scan',
  'mouse',
];

const VALID_GESTURES: SwitchGesture[] = ['jaw open', 'brow raise'];

// ---------------------------------------------------------------------------
// clampProfile
// ---------------------------------------------------------------------------

/**
 * Apply range constraints from the Profile fields table, in the clamping order
 * required by Req 7 AC 5:
 *   calibration ranges → dead zone → cancel hold time → both acceptance times
 *   → gesture threshold → release threshold
 *
 * Any missing or invalid field falls back to `base` (defaults to `defaultProfile`).
 */
export function clampProfile(
  partial: Partial<Profile>,
  base: Profile = defaultProfile,
): Profile {
  const changes: string[] = [];
  void changes; // used only in importProfile; here we just clamp silently

  // Helper: pick a value or fall back to base
  function pick<K extends keyof Profile>(key: K): Profile[K] {
    return key in partial ? (partial[key] as Profile[K]) : base[key];
  }

  // ---- simple fields (no cross-field dependency) -------------------------

  const mode = VALID_MODES.includes(pick('mode') as Mode)
    ? (pick('mode') as Mode)
    : base.mode;

  const startCameraOnLoad =
    typeof pick('startCameraOnLoad') === 'boolean'
      ? pick('startCameraOnLoad')
      : base.startCameraOnLoad;

  const switchGesture = VALID_GESTURES.includes(pick('switchGesture') as SwitchGesture)
    ? (pick('switchGesture') as SwitchGesture)
    : base.switchGesture;

  const switchBinding =
    typeof pick('switchBinding') === 'string' && pick('switchBinding') !== ''
      ? (pick('switchBinding') as string)
      : base.switchBinding;

  const headGain = clamp(pick('headGain') as number, 1.0, 2.0);
  const smoothingStrength = clamp(pick('smoothingStrength') as number, 0, 1);
  const dwellTime = clamp(pick('dwellTime') as number, 400, 3000);
  const graceTime = clamp(pick('graceTime') as number, 0, 500);
  const postSelectionPause = clamp(pick('postSelectionPause') as number, 200, 3000);
  const autoRepeatInterval = clamp(pick('autoRepeatInterval') as number, 500, 3000);
  const scanInterval = clamp(pick('scanInterval') as number, 500, 5000);
  const scanLoopsBeforePause = clamp(pick('scanLoopsBeforePause') as number, 1, 10);
  const noFaceTimeout = clamp(pick('noFaceTimeout') as number, 3000, 60000);
  const inputTimeout = clamp(pick('inputTimeout') as number, 500, 10000);
  const cancelByHold =
    typeof pick('cancelByHold') === 'boolean'
      ? pick('cancelByHold')
      : base.cancelByHold;
  const targetSize = clamp(pick('targetSize') as number, 64, 400);
  const targetSpacing = clamp(pick('targetSpacing') as number, 8, 64);
  const calibrationStillnessThreshold = clamp(
    pick('calibrationStillnessThreshold') as number,
    0.5,
    6,
  );
  const calibrationStillnessTime = clamp(
    pick('calibrationStillnessTime') as number,
    500,
    4000,
  );
  const calibrationStepTimeout = clamp(
    pick('calibrationStepTimeout') as number,
    3000,
    20000,
  );

  // ---- step 1: calibration ranges ----------------------------------------
  const calibrationRangeLeft = clamp(pick('calibrationRangeLeft') as number, 3, 90);
  const calibrationRangeRight = clamp(pick('calibrationRangeRight') as number, 3, 90);
  const calibrationRangeUp = clamp(pick('calibrationRangeUp') as number, 3, 90);
  const calibrationRangeDown = clamp(pick('calibrationRangeDown') as number, 3, 90);

  // ---- step 2: dead zone (≤ 0.5 × min range) ----------------------------
  const minRange = Math.min(
    calibrationRangeLeft,
    calibrationRangeRight,
    calibrationRangeUp,
    calibrationRangeDown,
  );
  const headDeadZoneMax = 0.5 * minRange;
  const headDeadZone = clamp(pick('headDeadZone') as number, 0, headDeadZoneMax);

  // ---- step 3: cancel hold time ------------------------------------------
  const cancelHoldTime = clamp(pick('cancelHoldTime') as number, 1000, 5000);

  // ---- step 4: both acceptance times (must be < cancelHoldTime) ----------
  const switchAcceptanceTime = clamp(
    pick('switchAcceptanceTime') as number,
    0,
    Math.min(2000, cancelHoldTime - 1),
  );
  const gestureAcceptanceTime = clamp(
    pick('gestureAcceptanceTime') as number,
    100,
    Math.min(2000, cancelHoldTime - 1),
  );

  // ---- step 5: gesture threshold -----------------------------------------
  const gestureThreshold = clamp(pick('gestureThreshold') as number, 0.1, 0.95);

  // ---- step 6: release threshold (≥ 0.05, ≤ gestureThreshold − 0.05) ----
  const releaseThresholdMax = gestureThreshold - 0.05;
  const gestureReleaseThreshold = clamp(
    pick('gestureReleaseThreshold') as number,
    0.05,
    releaseThresholdMax,
  );

  return {
    mode,
    startCameraOnLoad,
    switchGesture,
    switchBinding,
    headGain,
    headDeadZone,
    smoothingStrength,
    dwellTime,
    graceTime,
    postSelectionPause,
    autoRepeatInterval,
    scanInterval,
    scanLoopsBeforePause,
    switchAcceptanceTime,
    gestureAcceptanceTime,
    gestureThreshold,
    gestureReleaseThreshold,
    cancelByHold,
    cancelHoldTime,
    noFaceTimeout,
    inputTimeout,
    calibrationRangeLeft,
    calibrationRangeRight,
    calibrationRangeUp,
    calibrationRangeDown,
    calibrationStillnessThreshold,
    calibrationStillnessTime,
    calibrationStepTimeout,
    targetSize,
    targetSpacing,
  };
}

// ---------------------------------------------------------------------------
// exportProfile
// ---------------------------------------------------------------------------

export function exportProfile(p: Profile): string {
  return JSON.stringify(p);
}

// ---------------------------------------------------------------------------
// importProfile
// ---------------------------------------------------------------------------

/**
 * Parse `json`, read each of the 30 known fields by name (never spread),
 * apply clamping, and report what changed.
 */
export function importProfile(json: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { profile: { ...defaultProfile }, changes: ['invalid JSON — all fields reset to defaults'] };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { profile: { ...defaultProfile }, changes: ['parsed value is not an object — all fields reset to defaults'] };
  }

  // Read each field by name explicitly — never spread the parsed object.
  const raw = parsed as Record<string, unknown>;
  const changes: string[] = [];

  function readNumber(key: string, def: number): number {
    const v = raw[key];
    if (typeof v === 'number' && isFinite(v)) return v;
    if (v !== undefined) changes.push(`${key}: invalid value "${v}" — using default`);
    return def;
  }

  function readBoolean(key: string, def: boolean): boolean {
    const v = raw[key];
    if (typeof v === 'boolean') return v;
    if (v !== undefined) changes.push(`${key}: invalid value "${v}" — using default`);
    return def;
  }

  function readString(key: string, def: string): string {
    const v = raw[key];
    if (typeof v === 'string' && v !== '') return v;
    if (v !== undefined) changes.push(`${key}: invalid value "${v}" — using default`);
    return def;
  }

  const partial: Partial<Profile> = {
    mode: readString('mode', defaultProfile.mode) as Mode,
    startCameraOnLoad: readBoolean('startCameraOnLoad', defaultProfile.startCameraOnLoad),
    switchGesture: readString('switchGesture', defaultProfile.switchGesture) as SwitchGesture,
    switchBinding: readString('switchBinding', defaultProfile.switchBinding),
    headGain: readNumber('headGain', defaultProfile.headGain),
    headDeadZone: readNumber('headDeadZone', defaultProfile.headDeadZone),
    smoothingStrength: readNumber('smoothingStrength', defaultProfile.smoothingStrength),
    dwellTime: readNumber('dwellTime', defaultProfile.dwellTime),
    graceTime: readNumber('graceTime', defaultProfile.graceTime),
    postSelectionPause: readNumber('postSelectionPause', defaultProfile.postSelectionPause),
    autoRepeatInterval: readNumber('autoRepeatInterval', defaultProfile.autoRepeatInterval),
    scanInterval: readNumber('scanInterval', defaultProfile.scanInterval),
    scanLoopsBeforePause: readNumber('scanLoopsBeforePause', defaultProfile.scanLoopsBeforePause),
    switchAcceptanceTime: readNumber('switchAcceptanceTime', defaultProfile.switchAcceptanceTime),
    gestureAcceptanceTime: readNumber('gestureAcceptanceTime', defaultProfile.gestureAcceptanceTime),
    gestureThreshold: readNumber('gestureThreshold', defaultProfile.gestureThreshold),
    gestureReleaseThreshold: readNumber('gestureReleaseThreshold', defaultProfile.gestureReleaseThreshold),
    cancelByHold: readBoolean('cancelByHold', defaultProfile.cancelByHold),
    cancelHoldTime: readNumber('cancelHoldTime', defaultProfile.cancelHoldTime),
    noFaceTimeout: readNumber('noFaceTimeout', defaultProfile.noFaceTimeout),
    inputTimeout: readNumber('inputTimeout', defaultProfile.inputTimeout),
    calibrationRangeLeft: readNumber('calibrationRangeLeft', defaultProfile.calibrationRangeLeft),
    calibrationRangeRight: readNumber('calibrationRangeRight', defaultProfile.calibrationRangeRight),
    calibrationRangeUp: readNumber('calibrationRangeUp', defaultProfile.calibrationRangeUp),
    calibrationRangeDown: readNumber('calibrationRangeDown', defaultProfile.calibrationRangeDown),
    calibrationStillnessThreshold: readNumber('calibrationStillnessThreshold', defaultProfile.calibrationStillnessThreshold),
    calibrationStillnessTime: readNumber('calibrationStillnessTime', defaultProfile.calibrationStillnessTime),
    calibrationStepTimeout: readNumber('calibrationStepTimeout', defaultProfile.calibrationStepTimeout),
    targetSize: readNumber('targetSize', defaultProfile.targetSize),
    targetSpacing: readNumber('targetSpacing', defaultProfile.targetSpacing),
  };

  const before = partial as Profile;
  const profile = clampProfile(partial, defaultProfile);

  // Detect values that were clamped (changed during clamping)
  const keys = Object.keys(profile) as (keyof Profile)[];
  for (const key of keys) {
    const pre = (before as Record<string, unknown>)[key];
    const post = (profile as Record<string, unknown>)[key];
    if (pre !== post && !changes.some((c) => c.startsWith(`${key}:`))) {
      changes.push(`${key}: clamped from ${pre} to ${post}`);
    }
  }

  return { profile, changes };
}
