/**
 * api-types.ts — the types of the public API (design §6). Types only: this file has no
 * runtime code, so nothing here ends up in the compiled JavaScript.
 */
import type { CalibrationResult, CalibrationRun, CalibrationStepName } from './engine/calibration.js';
import type { DetectedFace, GestureScores } from './engine/head-pointer.js';
import type { ImportResult, Mode, Profile } from './engine/profile.js';
import type { ScanHighlightKind } from './engine/scan.js';
import type { Rect, TargetRole } from './engine/targets.js';

export type { CalibrationResult, DetectedFace, GestureScores, ImportResult, Profile, Rect, ScanHighlightKind, TargetRole };

/** The input mode: the same strings as the profile's `mode` field. */
export type InputMode = Mode;
export type CalibrationStep = CalibrationStepName;
export type SelectSource = 'dwell' | 'scan' | 'gesture' | 'mouse';
export type TrackingStatus =
  | 'found'
  | 'lost'
  | 'low-confidence'
  | 'permission-denied'
  | 'load-failed'
  | 'no-face-timeout';

export interface ScreenSize {
  width: number;
  height: number;
}

export interface PlanchetteOptions {
  /** The size of the screen the pointer moves on, in CSS px. */
  screen: ScreenSize;
  /** Profile fields to start with; the rest are the defaults. Values are clamped. */
  profile?: Partial<Profile>;
  /**
   * Where the app serves the head-tracking files: `vision_wasm_internal.js`,
   * `vision_wasm_internal.wasm` (from @mediapipe/tasks-vision's `wasm/` folder) and
   * `face_landmarker.task` (from this package's `assets/`). Same origin, never a CDN.
   * Default '/mediapipe/'. With a Vite `base`, pass `import.meta.env.BASE_URL + 'mediapipe/'`.
   */
  assetsUrl?: string;
  /**
   * Which input devices to listen to in a browser. Default: keyboard, mouse and gamepad.
   * `false` listens to none (feed samples yourself with `feedSamples`).
   */
  inputs?: false | { keyboard?: boolean; mouse?: boolean; gamepad?: boolean };
  /**
   * The tracking indicator (design §7, Task 16.3): "camera on", face lost, low confidence
   * and the camera failure messages. Default: a small status box added to the page while
   * there is something to show. An element: render into it instead. `false`: none; the app
   * shows the `tracking-status` events itself.
   */
  trackingIndicator?: false | HTMLElement;
}

/**
 * Why the camera could not be started, for `tracking-status: permission-denied`
 * (the browser rejected getUserMedia; Req 8 AC 1).
 */
export type CameraFailureCause = 'denied' | 'no-camera' | 'in-use' | 'other';

export interface TargetOptions {
  autoRepeat?: boolean;
  role?: TargetRole;
}

export interface TargetInfo {
  id: string;
  rect: Rect;
  autoRepeat: boolean;
  role: TargetRole;
}

export type SampleSource = 'camera' | 'keyboard' | 'mouse' | 'gamepad' | 'synthetic';

export interface TimestampedSample {
  /** Time in ms. Per source, a sample whose `now` is not later than the previous one is ignored. */
  now: number;
  source: SampleSource;
  faces?: ReadonlyArray<DetectedFace>;
  /** Mouse mode: the pointer position in CSS px. */
  pointer?: { x: number; y: number };
  /** Switch held (true) or released (false). */
  signal?: boolean;
  /** True is a cancel input (for example the Escape key). */
  cancel?: boolean;
  /** Blendshape scores, 0–1. */
  gestureScores?: GestureScores;
}

export interface PlanchetteEventMap {
  'pointer-move': { x: number; y: number };
  'dwell-progress': { targetId: string; progress: number };
  highlight: { kind: ScanHighlightKind; targetId: string; targetIds: string[] };
  select: { targetId: string; now: number; source: SelectSource; role: TargetRole };
  cancel: Record<string, never>;
  'tracking-status': {
    status: TrackingStatus;
    /** For lost, low-confidence and the failures: what to tell the person, in plain language. */
    message?: string;
    /** For the failures: the input modes to offer instead (switch scanning and mouse). */
    alternatives?: InputMode[];
    /** For permission-denied: which kind of camera problem it was. */
    cause?: CameraFailureCause;
  };
  'mode-change': { mode: InputMode };
  'calibration-step': {
    run: CalibrationRun;
    step: CalibrationStep;
    completed: boolean;
    timeout: boolean;
    /** On the `done` step only, and only when the run finished (not when it was cancelled). */
    result?: CalibrationResult;
  };
}

export type PlanchetteEventType = keyof PlanchetteEventMap;

export interface Planchette extends EventTarget {
  addEventListener<K extends PlanchetteEventType>(
    type: K,
    listener: (event: CustomEvent<PlanchetteEventMap[K]>) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends PlanchetteEventType>(
    type: K,
    listener: (event: CustomEvent<PlanchetteEventMap[K]>) => void,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void;

  // Targets
  registerTarget(id: string, rect: Rect, options?: TargetOptions): void;
  updateTarget(id: string, rect: Rect): void;
  unregisterTarget(id: string): void;
  getTargets(): ReadonlyArray<TargetInfo>;

  // Screen
  setScreen(size: ScreenSize): void;

  // Mode
  setMode(mode: InputMode): void;

  // Camera
  startCamera(): Promise<void>;
  stopCamera(): void;
  relockFace(faceIndex: number): void;

  // Profile
  getProfile(): Profile;
  setProfile(profile: Partial<Profile>): void;
  exportProfile(): string;
  importProfile(json: string): ImportResult;

  // Calibration
  startCalibration(): void;
  cancelCalibration(): void;
  recentre(): void;

  // Synthetic input (simulator and tests)
  feedSamples(samples: ReadonlyArray<TimestampedSample>): void;

  /** Stop the camera, stop listening to input devices and remove the status box. */
  destroy(): void;
}
