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

/**
 * Clamp `value` to [min, max].
 * Uses `fallback` if `value` is not a finite number (NaN, ±Infinity, wrong type).
 * The fallback is clamped too, because a dependent field's range can move after
 * the base value was chosen (for example the release threshold after the
 * gesture threshold is clamped down).
 */
function clampOrFallback(value: unknown, min: number, max: number, fallback: number): number {
  const v = typeof value === 'number' && isFinite(value) ? value : fallback;
  return Math.min(Math.max(v, min), max);
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
 * Any missing, non-finite, or wrong-type field falls back to `base`
 * (defaults to `defaultProfile`).
 */
export function clampProfile(
  partial: Partial<Profile>,
  base: Profile = defaultProfile,
): Profile {
  // Helper: pick a value or fall back to base
  function pick<K extends keyof Profile>(key: K): Profile[K] {
    return key in partial ? (partial[key] as Profile[K]) : base[key];
  }

  // Clamp a numeric field, falling back to the base value if the picked value
  // is not a finite number.
  function cn(key: keyof Profile, min: number, max: number): number {
    return clampOrFallback(pick(key), min, max, base[key] as number);
  }

  // ---- simple fields (no cross-field dependency) -------------------------

  const rawMode = pick('mode');
  const mode = VALID_MODES.includes(rawMode as Mode) ? (rawMode as Mode) : base.mode;

  const rawStartCamera = pick('startCameraOnLoad');
  const startCameraOnLoad =
    typeof rawStartCamera === 'boolean' ? rawStartCamera : base.startCameraOnLoad;

  const rawGesture = pick('switchGesture');
  const switchGesture = VALID_GESTURES.includes(rawGesture as SwitchGesture)
    ? (rawGesture as SwitchGesture)
    : base.switchGesture;

  const rawBinding = pick('switchBinding');
  const switchBinding =
    typeof rawBinding === 'string' && rawBinding !== '' ? rawBinding : base.switchBinding;

  const headGain = cn('headGain', 1.0, 2.0);
  const smoothingStrength = cn('smoothingStrength', 0, 1);
  const dwellTime = cn('dwellTime', 400, 3000);
  const graceTime = cn('graceTime', 0, 500);
  const postSelectionPause = cn('postSelectionPause', 200, 3000);
  const autoRepeatInterval = cn('autoRepeatInterval', 500, 3000);
  const scanInterval = cn('scanInterval', 500, 5000);
  // scanLoopsBeforePause is an integer count
  const scanLoopsBeforePause = Math.round(cn('scanLoopsBeforePause', 1, 10));
  const noFaceTimeout = cn('noFaceTimeout', 3000, 60000);
  const inputTimeout = cn('inputTimeout', 500, 10000);

  const rawCancelByHold = pick('cancelByHold');
  const cancelByHold =
    typeof rawCancelByHold === 'boolean' ? rawCancelByHold : base.cancelByHold;

  const targetSize = cn('targetSize', 64, 400);
  const targetSpacing = cn('targetSpacing', 8, 64);
  const calibrationStillnessThreshold = cn('calibrationStillnessThreshold', 0.5, 6);
  const calibrationStillnessTime = cn('calibrationStillnessTime', 500, 4000);
  const calibrationStepTimeout = cn('calibrationStepTimeout', 3000, 20000);

  // ---- step 1: calibration ranges ----------------------------------------
  const calibrationRangeLeft = cn('calibrationRangeLeft', 3, 90);
  const calibrationRangeRight = cn('calibrationRangeRight', 3, 90);
  const calibrationRangeUp = cn('calibrationRangeUp', 3, 90);
  const calibrationRangeDown = cn('calibrationRangeDown', 3, 90);

  // ---- step 2: dead zone (≤ 0.5 × min range) ----------------------------
  const minRange = Math.min(
    calibrationRangeLeft,
    calibrationRangeRight,
    calibrationRangeUp,
    calibrationRangeDown,
  );
  const headDeadZoneMax = 0.5 * minRange;
  const headDeadZone = clampOrFallback(pick('headDeadZone'), 0, headDeadZoneMax, base.headDeadZone);

  // ---- step 3: cancel hold time ------------------------------------------
  const cancelHoldTime = cn('cancelHoldTime', 1000, 5000);

  // ---- step 4: both acceptance times (must be < cancelHoldTime) ----------
  const switchAcceptanceTime = clampOrFallback(
    pick('switchAcceptanceTime'),
    0,
    Math.min(2000, cancelHoldTime - 1),
    base.switchAcceptanceTime,
  );
  const gestureAcceptanceTime = clampOrFallback(
    pick('gestureAcceptanceTime'),
    100,
    Math.min(2000, cancelHoldTime - 1),
    base.gestureAcceptanceTime,
  );

  // ---- step 5: gesture threshold -----------------------------------------
  const gestureThreshold = cn('gestureThreshold', 0.1, 0.95);

  // ---- step 6: release threshold (≥ 0.05, ≤ gestureThreshold − 0.05) ----
  const releaseThresholdMax = gestureThreshold - 0.05;
  const gestureReleaseThreshold = clampOrFallback(
    pick('gestureReleaseThreshold'),
    0.05,
    releaseThresholdMax,
    base.gestureReleaseThreshold,
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
 * apply clamping, and report what changed (including missing fields and
 * fields whose values were clamped).
 */
export function importProfile(json: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {
      profile: { ...defaultProfile },
      changes: ['invalid JSON — all fields reset to defaults'],
    };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      profile: { ...defaultProfile },
      changes: ['parsed value is not an object — all fields reset to defaults'],
    };
  }

  // Read each field by name explicitly — never spread the parsed object.
  const raw = parsed as Record<string, unknown>;
  const changes: string[] = [];

  function readNumber(key: string, def: number): number {
    if (!(key in raw)) {
      changes.push(`${key}: missing — using default`);
      return def;
    }
    const v = raw[key];
    if (typeof v === 'number' && isFinite(v)) return v;
    changes.push(`${key}: invalid value "${v}" — using default`);
    return def;
  }

  function readBoolean(key: string, def: boolean): boolean {
    if (!(key in raw)) {
      changes.push(`${key}: missing — using default`);
      return def;
    }
    const v = raw[key];
    if (typeof v === 'boolean') return v;
    changes.push(`${key}: invalid value "${v}" — using default`);
    return def;
  }

  function readString(key: string, def: string): string {
    if (!(key in raw)) {
      changes.push(`${key}: missing — using default`);
      return def;
    }
    const v = raw[key];
    if (typeof v === 'string' && v !== '') return v;
    changes.push(`${key}: invalid value "${v}" — using default`);
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

  // Record the values as read (before clamping) so we can detect clamping below.
  const beforeClamp = { ...partial } as Profile;
  const profile = clampProfile(partial, defaultProfile);

  // Report any additional changes caused by clamping (after the read-stage changes
  // already recorded above).
  const keys = Object.keys(profile) as (keyof Profile)[];
  for (const key of keys) {
    const pre = (beforeClamp as Record<string, unknown>)[key];
    const post = (profile as Record<string, unknown>)[key];
    if (pre !== post && !changes.some((c) => c.startsWith(`${key}:`))) {
      changes.push(`${key}: clamped from ${pre} to ${post}`);
    }
  }

  return { profile, changes };
}
