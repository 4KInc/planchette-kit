/**
 * planchette.ts — assembles the engines behind the public API (design §6, Task 11).
 *
 * `createPlanchetteInternal` returns the public instance and an `inspect` function that
 * tests use to look at the engine state. Only `createPlanchette` in index.ts is public;
 * this file is private and may change.
 *
 * No clocks, no DOM and no devices are read here: time arrives in each sample's `now`.
 * The only runtime globals used are `EventTarget` and `CustomEvent`.
 */
import type {
  InputMode,
  Planchette,
  PlanchetteEventMap,
  PlanchetteEventType,
  PlanchetteOptions,
  SampleSource,
  ScreenSize,
  TargetInfo,
  TargetOptions,
} from './api-types.js';
import {
  createCalibrationState,
  stepCalibration,
  type CalibrationEvent,
  type CalibrationRun,
  type CalibrationState,
} from './engine/calibration.js';
import { createDwellState, hitTest, stepDwell, type DwellEvent } from './engine/dwell.js';
import { createGestureState, dropGesture, stepGesture, type GestureEvent } from './engine/gesture.js';
import {
  createHeadPointerState,
  relockFace as relockHeadFace,
  selectionPointer,
  stepHeadPointer,
  type DetectedFace,
  type FaceRotation,
  type GestureScores,
  type HeadPointerEvent,
} from './engine/head-pointer.js';
import { PressState } from './engine/press-machine.js';
import {
  clampProfile,
  exportProfile as exportProfileJson,
  importProfile as importProfileJson,
  type ImportResult,
  type Profile,
} from './engine/profile.js';
import { SCAN_BACK_ID, SCAN_CANCEL_ID, createScanState, stepScan, type ScanEvent } from './engine/scan.js';
import { createSwitchState, stepSwitch, type SwitchState } from './engine/switch.js';
import { messages } from './messages.js';
import { createCameraAdapter, type CameraAdapter, type CameraEnvironment } from './adapters/camera-adapter.js';
import { createTrackingIndicator, failureMessage, type DomLike, type TrackingIndicator } from './ui/tracking-indicator.js';
import { browserCameraEnvironment, browserDom, browserInputEnvironment, hasBrowser } from './adapters/browser-env.js';
import type { InputAdapter, InputEnvironment, InputSink } from './adapters/input-env.js';
import { createKeyboardAdapter } from './adapters/keyboard-adapter.js';
import { createMouseAdapter } from './adapters/mouse-adapter.js';
import { createGamepadAdapter } from './adapters/gamepad-adapter.js';
import type { DwellTarget, Rect, TargetRole } from './engine/targets.js';

const SOURCES: ReadonlySet<string> = new Set<SampleSource>(['camera', 'keyboard', 'mouse', 'gamepad', 'synthetic']);
const ROLES: ReadonlySet<string> = new Set<TargetRole>(['default', 'cancel', 'undo', 'rest-area']);
const MODES: ReadonlySet<string> = new Set<InputMode>([
  'head + dwell',
  'head + gesture',
  'scan',
  'gesture scan',
  'mouse',
]);

/** A read-only look at the engine state, for tests. */
export interface PlanchetteSnapshot {
  mode: InputMode;
  dwell: { targetId: string | null; accumulated: number };
  scan: { started: boolean; paused: boolean; level: 'top' | 'row'; index: number; loops: number };
  /** Press machine state of each source that has sent a sample. */
  switches: Record<string, PressState>;
  gesture: { press: PressState; signal: boolean };
  head: { tracking: 'none' | 'found' | 'lost'; hasPointer: boolean; x: number; y: number };
  centre: FaceRotation;
  calibration: { run: CalibrationRun; step: string } | null;
}

/**
 * What the instance uses from the browser. Tests pass fakes; `null` means "not available"
 * (for example Node). Without this argument the real browser is used when there is one.
 */
export interface PlanchetteEnvironment {
  camera?: CameraEnvironment | null;
  input?: InputEnvironment | null;
  dom?: DomLike | null;
}

/** The modes offered when the camera cannot be used (Req 8 AC 2c). */
const CAMERA_ALTERNATIVES: InputMode[] = ['scan', 'mouse'];
const DEFAULT_ASSETS_URL = '/mediapipe/';

export interface PlanchetteInternals {
  planchette: Planchette;
  inspect(): PlanchetteSnapshot;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function sanitizeScreen(v: unknown): ScreenSize {
  const w = isObject(v) ? v.width : undefined;
  const h = isObject(v) ? v.height : undefined;
  return { width: finite(w) && w >= 1 ? w : 1, height: finite(h) && h >= 1 ? h : 1 };
}

function sanitizeRect(v: unknown): Rect | null {
  if (!isObject(v)) return null;
  const { x, y, width, height } = v;
  if (!finite(x) || !finite(y) || !finite(width) || !finite(height)) return null;
  if (!(width > 0) || !(height > 0)) return null;
  return { x, y, width, height };
}

function sanitizeScores(v: unknown): GestureScores | undefined {
  if (!isObject(v)) return undefined;
  const jawOpen = finite(v.jawOpen) ? v.jawOpen : 0;
  const browRaise = finite(v.browRaise) ? v.browRaise : 0;
  return { jawOpen, browRaise };
}

function sanitizeFaces(v: unknown): DetectedFace[] {
  if (!Array.isArray(v)) return [];
  const out: DetectedFace[] = [];
  for (const f of v as unknown[]) {
    if (!isObject(f) || !isObject(f.bbox)) continue;
    const rot = isObject(f.rotation) ? (f.rotation as unknown as FaceRotation) : undefined;
    out.push({
      bbox: f.bbox as unknown as DetectedFace['bbox'],
      rotation: rot as FaceRotation,
      gestureScores: sanitizeScores(f.gestureScores),
      ...(finite(f.confidence) ? { confidence: f.confidence } : {}),
    });
  }
  return out;
}

export function createPlanchetteInternal(options: PlanchetteOptions, environment?: PlanchetteEnvironment): PlanchetteInternals {
  const opts: Partial<PlanchetteOptions> = isObject(options) ? options : {};
  const browser = environment === undefined && hasBrowser();
  const env: Required<PlanchetteEnvironment> = {
    camera: environment === undefined ? (browser ? browserCameraEnvironment() : null) : (environment.camera ?? null),
    input: environment === undefined ? (browser ? browserInputEnvironment() : null) : (environment.input ?? null),
    dom: environment === undefined ? (browser ? browserDom() : null) : (environment.dom ?? null),
  };
  let profile: Profile = clampProfile(isObject(opts.profile) ? opts.profile : {});
  let screen: ScreenSize = sanitizeScreen(opts.screen);

  // ---- targets -----------------------------------------------------------
  const targets = new Map<string, DwellTarget>();
  let targetList: DwellTarget[] = [];
  const refreshTargets = (): void => {
    targetList = [...targets.values()];
  };

  // ---- engine state ------------------------------------------------------
  let head = createHeadPointerState();
  const dwell = createDwellState();
  const scan = createScanState();
  const gesture = createGestureState();
  const switches = new Map<string, SwitchState>();
  const lastNow = new Map<string, number>();
  let mousePointer: { x: number; y: number } | null = null;
  let lastMouseShown: { x: number; y: number } | null = null;

  // ---- session state (design §4 "Centre step") ----------------------------
  let centre: FaceRotation = { yaw: 0, pitch: 0 };
  let calibration: { run: CalibrationRun; state: CalibrationState } | null = null;
  /** True once the start-up centre step of this camera session has started. */
  let startupCentreStarted = false;

  const target = new EventTarget();
  function emit<K extends PlanchetteEventType>(type: K, detail: PlanchetteEventMap[K]): void {
    target.dispatchEvent(new CustomEvent(type, { detail }));
  }

  const isHeadMode = (): boolean => profile.mode === 'head + dwell' || profile.mode === 'head + gesture';

  // ---- idle and cancel ---------------------------------------------------
  /**
   * Return every selection engine to idle without emitting `cancel`.
   * `full` also forgets the engines' clocks (used when the mode or camera changes, so a
   * different source's timestamps are not compared with the old ones).
   * A switch or gesture that is still held must be released before it can press again.
   */
  function toIdle(full: boolean, resetScan = true, resetDwell = true): void {
    if (resetDwell) {
      if (dwell.targetId !== null) emit('dwell-progress', { targetId: dwell.targetId, progress: 0 });
      const dwellClock = dwell.t_last;
      const dwellPause = dwell.pauseEnd;
      Object.assign(dwell, createDwellState());
      if (!full) {
        dwell.t_last = dwellClock;
        dwell.pauseEnd = dwellPause;
      }
    }
    if (resetScan) {
      const scanClock = scan.t_last;
      const scanPause = scan.pauseEnd;
      Object.assign(scan, createScanState());
      if (!full) {
        scan.t_last = scanClock;
        scan.pauseEnd = scanPause;
      }
    }
    dropGesture(gesture);
    if (full) {
      gesture.t_last = -Infinity;
      gesture.press.t_last = -Infinity;
    }
    for (const sw of switches.values()) {
      if (sw.state !== PressState.IDLE) sw.state = PressState.COOLDOWN;
      if (full) sw.t_last = -Infinity;
    }
  }

  /** A cancel: back to idle and exactly one `cancel` event. */
  function cancelToIdle(now: number, targetId?: string, resetScan = true, resetDwell = true): void {
    toIdle(false, resetScan, resetDwell);
    emit('cancel', targetId === undefined ? { now } : { now, targetId });
  }

  // ---- profile -----------------------------------------------------------
  function applyProfile(partial: unknown): void {
    if (!isObject(partial)) return;
    const next = clampProfile(partial as Partial<Profile>, profile);
    const modeChanged = next.mode !== profile.mode;
    profile = next;
    if (modeChanged) {
      toIdle(true);
      mousePointer = null;
      lastMouseShown = null;
      emit('mode-change', { mode: profile.mode });
    }
  }

  // ---- calibration -------------------------------------------------------
  function startRun(run: CalibrationRun): void {
    calibration = { run, state: createCalibrationState(run) };
    startupCentreStarted = true;
  }

  function handleCalibrationEvents(events: CalibrationEvent[]): void {
    for (const e of events) {
      if (e.type === 'step') {
        emit('calibration-step', { run: e.run, step: e.step, completed: e.completed, timeout: e.timeout });
      } else {
        calibration = null;
        if (e.result.centre !== null) centre = { yaw: e.result.centre.yaw, pitch: e.result.centre.pitch };
        if (Object.keys(e.result.profile).length > 0) applyProfile(e.result.profile);
        emit('calibration-step', {
          run: e.run,
          step: 'done',
          completed: true,
          timeout: false,
          result: e.result,
        });
      }
    }
  }

  // ---- selection helpers -------------------------------------------------
  function selectAt(p: { x: number; y: number } | null, now: number, source: 'gesture' | 'mouse'): void {
    if (p === null) return;
    const hit = hitTest(p, targetList);
    if (hit === null) return;
    // Req 6 AC 1: a target with role 'cancel' cancels instead of selecting.
    if (hit.role === 'cancel') cancelToIdle(now, hit.id);
    else emit('select', { targetId: hit.id, now, source, role: hit.role });
  }

  function emitDwell(events: DwellEvent[]): void {
    for (const e of events) {
      if (e.type === 'dwell-progress') emit('dwell-progress', { targetId: e.targetId, progress: e.progress });
      // The dwell stay stays as the engine left it (finished, so it does not fire again
      // while the pointer rests on the cancel target); everything else returns to idle.
      else if (e.type === 'cancel') cancelToIdle(e.now, e.targetId, true, false);
      else emit('select', { targetId: e.targetId, now: e.now, source: 'dwell', role: e.role });
    }
  }

  /** Emit scan events. A scan `cancel` is passed on; the scan engine has already returned to the top. */
  function emitScan(events: ScanEvent[]): void {
    for (const e of events) {
      if (e.type === 'highlight') {
        emit('highlight', { kind: e.kind, targetId: e.targetId, targetIds: e.targetIds });
      } else if (e.type === 'select') {
        emit('select', { targetId: e.targetId, now: e.now, source: 'scan', role: e.role });
      } else {
        cancelToIdle(e.now, e.targetId, false);
      }
    }
  }

  function runScan(press: boolean, now: number): void {
    // A press from another source can carry a time that is not later than the scan clock
    // (several switch sources, one scan). Nudge it forward rather than lose the press.
    const t = press && !(now > scan.t_last) ? scan.t_last + 0.001 : now;
    emitScan(stepScan(scan, { press, targets: targetList }, t, profile));
  }

  // ---- camera, status box and input adapters ------------------------------
  let camera: CameraAdapter | null = null;
  let statusView: TrackingIndicator | null = null;
  let inputs: InputAdapter[] = [];

  function status(): TrackingIndicator | null {
    if (statusView !== null || env.dom === null || opts.trackingIndicator === false) return statusView;
    const parent = opts.trackingIndicator === undefined ? null : (opts.trackingIndicator as unknown as { appendChild(c: unknown): unknown });
    statusView = createTrackingIndicator(env.dom, parent, {
      // "Try the camera again": a full restart, also after a no-face timeout while the
      // camera runs (startCamera alone does nothing then).
      retry: () => {
        api.stopCamera();
        void api.startCamera();
      },
      setMode: (mode) => api.setMode(mode),
    });
    return statusView;
  }

  /** A `tracking-status` event; the failures carry their plain-language message and the alternatives. */
  function trackingStatus(value: PlanchetteEventMap['tracking-status']['status'], cause?: PlanchetteEventMap['tracking-status']['cause']): void {
    if (value === 'permission-denied' || value === 'load-failed' || value === 'no-face-timeout') {
      const detail: PlanchetteEventMap['tracking-status'] = {
        status: value,
        message: failureMessage(value, cause),
        alternatives: [...CAMERA_ALTERNATIVES],
      };
      if (cause !== undefined) detail.cause = cause;
      status()?.show({ kind: 'failed', status: value, cause });
      emit('tracking-status', detail);
      return;
    }
    if (value === 'lost' || value === 'low-confidence') {
      status()?.show({ kind: value });
      emit('tracking-status', { status: value, message: value === 'lost' ? messages.lost : messages.lowConfidence });
      return;
    }
    status()?.show({ kind: camera !== null && camera.state === 'running' ? 'on' : 'hidden' });
    emit('tracking-status', { status: value });
  }

  if (env.camera !== null) {
    const assetsUrl = typeof opts.assetsUrl === 'string' && opts.assetsUrl !== '' ? opts.assetsUrl : DEFAULT_ASSETS_URL;
    camera = createCameraAdapter(env.camera, assetsUrl, {
      sample: (sample) => feedOne(sample),
      started: () => status()?.show({ kind: 'starting' }),
      running: () => status()?.show({ kind: 'on' }),
      failed: (value, cause) => trackingStatus(value, cause),
      stopped: () => status()?.show({ kind: 'hidden' }),
    });
  }

  // ---- camera samples ----------------------------------------------------
  function cameraSample(raw: Record<string, unknown>, now: number): void {
    if (!startupCentreStarted && calibration === null) startRun('centre');
    // Selection by camera input is held while any calibration step runs.
    const holding = calibration !== null;
    // The position a gesture selects at: before this sample's step, so the sample on which
    // the gesture ends still sees the freeze position (design §4, P13).
    const before = selectionPointer(head);

    const headEvents: HeadPointerEvent[] = stepHeadPointer(
      head,
      { faces: sanitizeFaces(raw.faces), gestureScores: sanitizeScores(raw.gestureScores), screen, centre },
      now,
      profile,
    );
    for (const e of headEvents) {
      if (e.type === 'tracking-status') trackingStatus(e.status);
      else if (isHeadMode()) emit('pointer-move', { x: e.x, y: e.y });
    }

    if (calibration !== null) {
      handleCalibrationEvents(
        stepCalibration(calibration.state, { rotation: head.rotation, gestureScores: head.scores }, now, profile),
      );
    }

    switch (profile.mode) {
      case 'head + dwell': {
        emitDwell(stepDwell(dwell, { pointer: holding ? null : selectionPointer(head), targets: targetList }, now, profile));
        break;
      }
      case 'head + gesture': {
        const events = stepGesture(gesture, { gestureScores: holding ? null : head.scores }, now, profile);
        handleGestureEvents(events, before, now, false);
        break;
      }
      case 'gesture scan': {
        const events = stepGesture(gesture, { gestureScores: holding ? null : head.scores }, now, profile);
        const press = handleGestureEvents(events, before, now, true);
        if (press !== 'cancelled') runScan(press === 'press', now);
        break;
      }
      default:
        break;
    }
  }

  /** Returns what the events were: a press, a cancel (already handled) or nothing. */
  function handleGestureEvents(
    events: GestureEvent[],
    before: { x: number; y: number } | null,
    now: number,
    forScan: boolean,
  ): 'press' | 'cancelled' | 'none' {
    let result: 'press' | 'cancelled' | 'none' = 'none';
    for (const e of events) {
      if (e.type === 'cancel') {
        cancelToIdle(now);
        result = 'cancelled';
      } else if (result !== 'cancelled') {
        result = 'press';
        if (!forScan) selectAt(before, now, 'gesture');
      }
    }
    return result;
  }

  // ---- switch, mouse and synthetic samples -------------------------------
  function switchSample(source: string, raw: Record<string, unknown>, now: number): void {
    let sw = switches.get(source);
    if (sw === undefined) {
      sw = createSwitchState();
      switches.set(source, sw);
    }
    let press = false;
    let cancelled = false;
    for (const e of stepSwitch(sw, raw.signal === true, now, profile)) {
      if (e.type === 'cancel') cancelled = true;
      else press = true;
    }
    if (cancelled) {
      cancelToIdle(now);
      return;
    }
    if (profile.mode === 'scan') {
      runScan(press, now);
    } else if (profile.mode === 'mouse') {
      const p = raw.pointer;
      if (isObject(p) && finite(p.x) && finite(p.y)) {
        mousePointer = {
          x: Math.max(0, Math.min(screen.width - 1, p.x)),
          y: Math.max(0, Math.min(screen.height - 1, p.y)),
        };
      }
      if (
        mousePointer !== null &&
        (lastMouseShown === null || lastMouseShown.x !== mousePointer.x || lastMouseShown.y !== mousePointer.y)
      ) {
        lastMouseShown = mousePointer;
        emit('pointer-move', { x: mousePointer.x, y: mousePointer.y });
      }
      if (press) selectAt(mousePointer, now, 'mouse');
    }
  }

  // ---- feedSamples -------------------------------------------------------
  function feedOne(raw: unknown): void {
    if (!isObject(raw)) return;
    const now = raw.now;
    const source = raw.source;
    if (!finite(now) || typeof source !== 'string' || !SOURCES.has(source)) return;
    // Req 9 AC 4: per source, a sample not later than the previous one is ignored.
    const last = lastNow.get(source);
    if (last !== undefined && !(now > last)) return;
    lastNow.set(source, now);

    if (raw.cancel === true) {
      cancelToIdle(now);
      return;
    }
    const cameraContent = source === 'camera' || raw.faces !== undefined || raw.gestureScores !== undefined;
    if (cameraContent) cameraSample(raw, now);
    if (source !== 'camera' && (raw.signal !== undefined || !cameraContent)) switchSample(source, raw, now);
  }

  // ---- the public instance -----------------------------------------------
  const api = {
    registerTarget(id: string, rect: Rect, options?: TargetOptions): void {
      const r = sanitizeRect(rect);
      if (typeof id !== 'string' || id === '' || id === SCAN_BACK_ID || id === SCAN_CANCEL_ID || r === null) return;
      const rawRole = isObject(options) ? options.role : undefined;
      const role: TargetRole = typeof rawRole === 'string' && ROLES.has(rawRole) ? (rawRole as TargetRole) : 'default';
      // Auto-repeat makes no sense for a cancel target: it cancels once per stay.
      const autoRepeat = isObject(options) && options.autoRepeat === true && role !== 'cancel';
      targets.set(id, { id, rect: r, autoRepeat, role });
      refreshTargets();
    },
    updateTarget(id: string, rect: Rect): void {
      const old = targets.get(id);
      const r = sanitizeRect(rect);
      if (old === undefined || r === null) return;
      targets.set(id, { ...old, rect: r });
      refreshTargets();
    },
    unregisterTarget(id: string): void {
      if (targets.delete(id)) refreshTargets();
    },
    getTargets(): ReadonlyArray<TargetInfo> {
      return targetList.map((t) => ({ id: t.id, rect: { ...t.rect }, autoRepeat: t.autoRepeat, role: t.role }));
    },

    setScreen(size: ScreenSize): void {
      screen = sanitizeScreen(size);
      if (mousePointer !== null) {
        mousePointer = {
          x: Math.min(mousePointer.x, screen.width - 1),
          y: Math.min(mousePointer.y, screen.height - 1),
        };
      }
    },

    setMode(mode: InputMode): void {
      if (typeof mode === 'string' && MODES.has(mode)) applyProfile({ mode });
    },

    startCamera(): Promise<void> {
      // Already on or starting: nothing new.
      if (camera !== null && (camera.state === 'running' || camera.state === 'starting')) return camera.start();
      // A new camera session (also a retry after a failure): the start-up centre step runs
      // on its first sample, and the no-face timeout starts again (Task 14.4a, 14.5).
      startupCentreStarted = false;
      head = createHeadPointerState();
      lastNow.delete('camera');
      if (camera === null) return Promise.resolve();
      return camera.start(); // the status box appears when the camera is on
    },
    stopCamera(): void {
      camera?.stop(); // every track is stopped: the browser's camera light goes off
      status()?.show({ kind: 'hidden' });
      startupCentreStarted = false;
      head = createHeadPointerState();
      lastNow.delete('camera');
      toIdle(true);
      if (calibration !== null) api.cancelCalibration();
    },
    relockFace(faceIndex: number): void {
      for (const e of relockHeadFace(head, faceIndex)) {
        if (e.type === 'tracking-status') trackingStatus(e.status);
      }
    },

    getProfile(): Profile {
      return { ...profile };
    },
    setProfile(partial: Partial<Profile>): void {
      applyProfile(partial);
    },
    exportProfile(): string {
      return exportProfileJson(profile);
    },
    importProfile(json: string): ImportResult {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        parsed = undefined;
      }
      if (!isObject(parsed) || Array.isArray(parsed)) {
        // Not a profile file: keep the person's current profile rather than reset it.
        return { profile: { ...profile }, changes: ['not a profile file: the profile is unchanged'] };
      }
      const result = importProfileJson(json);
      applyProfile(result.profile);
      return result;
    },

    startCalibration(): void {
      if (calibration === null) startRun('full');
    },
    cancelCalibration(): void {
      if (calibration === null) return;
      const run = calibration.run;
      calibration = null;
      emit('calibration-step', { run, step: 'done', completed: false, timeout: false });
    },
    recentre(): void {
      if (calibration === null) startRun('centre');
    },

    feedSamples(samples: ReadonlyArray<unknown>): void {
      if (!Array.isArray(samples)) return;
      for (const s of samples) feedOne(s);
    },
    destroy(): void {
      api.stopCamera();
      for (const a of inputs) a.stop();
      inputs = [];
      statusView?.destroy();
      statusView = null;
    },
  };

  // Input devices (design §7): one adapter per device, each with its own frame loop.
  if (env.input !== null && opts.inputs !== false) {
    const want = isObject(opts.inputs) ? (opts.inputs as Record<string, unknown>) : {};
    const sink: InputSink = { profile: () => profile, feed: (sample) => feedOne(sample) };
    if (want.keyboard !== false) inputs.push(createKeyboardAdapter(env.input, sink));
    if (want.mouse !== false) inputs.push(createMouseAdapter(env.input, sink));
    if (want.gamepad !== false) inputs.push(createGamepadAdapter(env.input, sink));
  }

  const planchette = Object.assign(target, api) as unknown as Planchette;

  function inspect(): PlanchetteSnapshot {
    const sw: Record<string, PressState> = {};
    for (const [k, v] of switches) sw[k] = v.state;
    return {
      mode: profile.mode,
      dwell: { targetId: dwell.targetId, accumulated: dwell.accumulated },
      scan: { started: scan.started, paused: scan.paused, level: scan.level, index: scan.index, loops: scan.loops },
      switches: sw,
      gesture: { press: gesture.press.state, signal: gesture.signal },
      head: { tracking: head.tracking, hasPointer: head.hasPointer, x: head.x, y: head.y },
      centre: { ...centre },
      calibration: calibration === null ? null : { run: calibration.run, step: calibration.state.step },
    };
  }

  return { planchette, inspect };
}
