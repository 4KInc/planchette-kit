/**
 * board-controls.ts — the Controls row and the Status panel's message line (Req 13). It
 * follows skeleton/demo/main.ts and design.md "Input controls".
 *
 *  - `#mode` (select) and `#calibrate` (button) are plain controls for a carer, not targets.
 *  - `camera-toggle` is a plain button and a registered target (board-dom.ts registers it
 *    with the other `data-planchette-target` elements and has no action for it). A `select`
 *    event for it starts or stops the camera.
 *  - This module never starts the camera by itself. `startBoard` calls `startCamera()` once
 *    on load, and only when the Profile says so; it then tells this module with `setCameraOn`.
 *
 * Calibrate is in the Settings dialog. With the camera off it keeps the dialog open and says
 * why in the dialog's own message line (`#settings-message`); with the camera on it closes the
 * dialog, focuses `#settings-button` and calls `startCalibration()`. Step text still goes to
 * `#controls-message`.
 *
 * Plain mouse clicks on the toggle. The skeleton turns a mouse press into a `select` only in
 * mouse mode (the mouse adapter counts the button as the switch only there). In every other
 * mode a carer's click would do nothing, so the toggle also has a DOM `click` handler. In
 * mouse mode a real pointer click already gives a `select`, so the handler skips it to avoid
 * toggling twice. A keyboard activation (click with `detail` 0) is skipped in the two scan
 * modes, where Space is the person's switch and would otherwise act twice.
 */
import type { InputMode, Planchette } from '@planchette/skeleton';
import { messages } from './messages.js';
import { createSettingsGate } from './settings-gate.js';

export type ControlsHost = Pick<
  Planchette,
  'setMode' | 'startCamera' | 'stopCamera' | 'startCalibration' | 'getProfile' | 'addEventListener' | 'removeEventListener'
>;

export interface BoardControlsOptions {
  readonly host: ControlsHost;
  readonly document: Document;
  /** Called after a mode change and after a calibration run ends. */
  readonly saveProfile: () => void;
  /** True when no saved Profile existed at load: shows the first-run hint. Default false. */
  readonly firstRun?: boolean;
}

export interface BoardControls {
  /** Tells the controls the camera was started (or failed to start) outside them, on load. */
  setCameraOn(on: boolean): void;
  destroy(): void;
}

const MODES: ReadonlyArray<{ value: InputMode; label: string }> = [
  { value: 'head + dwell', label: messages.controls.modes.headDwell },
  { value: 'head + gesture', label: messages.controls.modes.headGesture },
  { value: 'scan', label: messages.controls.modes.scan },
  { value: 'gesture scan', label: messages.controls.modes.gestureScan },
  { value: 'mouse', label: messages.controls.modes.mouse },
];

const STEP_TEXT: Readonly<Record<string, string>> = messages.controls.calibrationSteps;

function byId<T extends HTMLElement>(doc: Document, id: string): T {
  const el = doc.getElementById(id);
  if (el === null) throw new Error(`board: #${id} is missing from board/index.html`);
  return el as T;
}

export function mountBoardControls({ host, document: doc, saveProfile, firstRun = false }: BoardControlsOptions): BoardControls {
  const modeSelect = byId<HTMLSelectElement>(doc, 'mode');
  const calibrateButton = byId<HTMLButtonElement>(doc, 'calibrate');
  // Calibrate lives in the Settings dialog (Req 13 AC 1, 6), with its own message line.
  const settingsDialog = doc.getElementById('settings') as HTMLDialogElement | null;
  const settingsButton = doc.getElementById('settings-button');
  const settingsMessage = doc.getElementById('settings-message');
  const gate = createSettingsGate(doc);
  const toggle = doc.querySelector<HTMLButtonElement>('[data-planchette-target="camera-toggle"]');
  if (toggle === null) throw new Error('board: the camera-toggle target is missing from board/index.html');
  const messageLine = byId(doc, 'controls-message');
  const indicator = doc.getElementById('camera-status');

  const modeLabel = doc.querySelector<HTMLElement>('label[for="mode"]');
  if (modeLabel !== null) modeLabel.textContent = messages.controls.inputMode;
  calibrateButton.textContent = messages.controls.calibrate;
  modeSelect.replaceChildren();
  for (const m of MODES) modeSelect.add(new Option(m.label, m.value));

  let cameraOn = false;
  // Ends on the first select of any target or the first setCameraOn(true); never returns.
  let firstRunActive = firstRun;

  /** The message line shows only while the tracking indicator has nothing to say. */
  const refreshVisibility = (): void => {
    messageLine.hidden = indicator !== null && indicator.childNodes.length > 0;
  };
  const say = (text: string): void => {
    messageLine.textContent = text;
    refreshVisibility();
  };
  const showHint = (): void => {
    const mode = host.getProfile().mode;
    const needsCamera = mode === 'head + dwell' || mode === 'head + gesture' || mode === 'gesture scan';
    if (firstRunActive) return say(messages.controls.firstRunHint);
    say(needsCamera && !cameraOn ? messages.controls.needsCameraHint : messages.controls.privacyHint);
  };
  const setCameraOn = (on: boolean): void => {
    cameraOn = on;
    if (on) firstRunActive = false;
    toggle.textContent = on ? messages.controls.stopCamera : messages.controls.startCamera;
    toggle.setAttribute('aria-pressed', String(on));
    showHint();
  };
  const toggleCamera = (): void => {
    if (cameraOn) {
      host.stopCamera();
      setCameraOn(false);
      say(messages.controls.cameraStopped);
    } else {
      setCameraOn(true);
      host.startCamera().catch(() => setCameraOn(false)); // the indicator shows the failure
    }
  };

  const refreshMode = (): void => {
    modeSelect.value = host.getProfile().mode;
    showHint();
  };

  const onChange = (): void => host.setMode(modeSelect.value as InputMode);
  const onModeChange = (): void => {
    refreshMode();
    saveProfile();
  };
  const onCalibrate = (): void => {
    if (!cameraOn) {
      // The dialog stays open and says why in its own line.
      if (settingsMessage !== null) settingsMessage.textContent = messages.controls.calibrateNeedsCamera;
      return;
    }
    if (settingsMessage !== null) settingsMessage.textContent = '';
    // Close the dialog first so the steps and the overlay show on the page, then return focus.
    if (settingsDialog?.open === true) settingsDialog.close();
    settingsButton?.focus();
    host.startCalibration();
  };
  const onStep = (e: CustomEvent<{ step: string; completed: boolean }>): void => {
    const { step, completed } = e.detail;
    if (step !== 'done') return say(STEP_TEXT[step] ?? messages.controls.calibrationWorking);
    refreshMode(); // shows the hint, so the result is said after it
    say(completed ? messages.controls.calibrationFinished : messages.controls.calibrationStopped);
    saveProfile(); // a stopped run leaves the Profile unchanged, so saving again is harmless
  };
  const onTracking = (e: CustomEvent<{ status: string }>): void => {
    const s = e.detail.status;
    if (s === 'found' || s === 'lost' || s === 'low-confidence') setCameraOn(true);
    else setCameraOn(false); // permission denied, load failed, no face: the indicator explains
  };
  const onSelect = (e: CustomEvent<{ targetId: string; now: number }>): void => {
    if (firstRunActive) {
      // The first select of any target ends the hint, whether or not the Board acts on it.
      firstRunActive = false;
      showHint();
    }
    if (settingsDialog?.open === true || gate.isStale(e.detail.now)) return; // no Target selection has any effect while Settings is open
    if (e.detail.targetId === 'camera-toggle') toggleCamera();
  };
  const onClick = (e: MouseEvent): void => {
    const mode = host.getProfile().mode;
    if (mode === 'mouse' && e.detail > 0) return; // the mouse adapter already sent a select
    if ((mode === 'scan' || mode === 'gesture scan') && e.detail === 0) return; // Space is the switch
    toggleCamera();
  };

  modeSelect.addEventListener('change', onChange);
  calibrateButton.addEventListener('click', onCalibrate);
  toggle.addEventListener('click', onClick);
  host.addEventListener('mode-change', onModeChange);
  host.addEventListener('calibration-step', onStep);
  host.addEventListener('tracking-status', onTracking);
  host.addEventListener('select', onSelect);
  const observer = indicator !== null && typeof MutationObserver !== 'undefined' ? new MutationObserver(refreshVisibility) : null;
  if (indicator !== null) observer?.observe(indicator, { childList: true, subtree: true, characterData: true });

  setCameraOn(false);
  refreshMode();

  return {
    setCameraOn,
    destroy() {
      modeSelect.removeEventListener('change', onChange);
      calibrateButton.removeEventListener('click', onCalibrate);
      toggle.removeEventListener('click', onClick);
      host.removeEventListener('mode-change', onModeChange);
      host.removeEventListener('calibration-step', onStep);
      host.removeEventListener('tracking-status', onTracking);
      host.removeEventListener('select', onSelect);
      observer?.disconnect();
      gate.destroy();
    },
  };
}
