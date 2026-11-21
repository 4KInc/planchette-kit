/**
 * Skeleton demo page (Task 17). Halloween theme, a 3×3 grid, Cancel and Undo targets and a
 * rest area, driven by one Planchette instance. The markup is in the root index.html and
 * the look in demo.css; the dwell ring, scan highlight and tracking indicator come from
 * '@planchette/skeleton/ui'.
 *
 * Rules for this page:
 *  - The camera starts only when the person presses "Start camera", never on load. The
 *    profile's `startCameraOnLoad` field is deliberately not read here.
 *  - Mouse mode and switch scanning need no camera and work from the first load.
 *  - Nothing is loaded from another origin (see the page's Content-Security-Policy).
 */
/// <reference types="vite/client" />
import { createPlanchette, type InputMode, type Planchette, type Profile } from '@planchette/skeleton';
import { createDwellRing, createScanHighlight } from '@planchette/skeleton/ui';

const SPIRITS: ReadonlyArray<{ id: string; label: string; icon: string }> = [
  { id: 'ghost', label: 'Ghost', icon: '👻' },
  { id: 'pumpkin', label: 'Pumpkin', icon: '🎃' },
  { id: 'bat', label: 'Bat', icon: '🦇' },
  { id: 'witch', label: 'Witch', icon: '🧙' },
  { id: 'skull', label: 'Skull', icon: '💀' },
  { id: 'spider', label: 'Spider', icon: '🕷️' },
  { id: 'candle', label: 'Candle', icon: '🕯️' },
  { id: 'cauldron', label: 'Cauldron', icon: '🧪' },
  { id: 'moon', label: 'Moon', icon: '🌕' },
];

const MODES: ReadonlyArray<{ value: InputMode; label: string }> = [
  { value: 'head + dwell', label: 'Head + dwell' },
  { value: 'head + gesture', label: 'Head + gesture' },
  { value: 'scan', label: 'Switch scanning (hold Space)' },
  { value: 'gesture scan', label: 'Gesture scanning' },
  { value: 'mouse', label: 'Mouse (click)' },
];

const STEP_TEXT: Record<string, string> = {
  centre: 'Calibration: look straight at the screen and hold still.',
  left: 'Calibration: turn your head to the left as far as is comfortable.',
  right: 'Calibration: turn your head to the right as far as is comfortable.',
  up: 'Calibration: tilt your head up as far as is comfortable.',
  down: 'Calibration: tilt your head down as far as is comfortable.',
  rest: 'Calibration: relax your face.',
  gesture: 'Calibration: make your switch gesture, held.',
};

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`demo: #${id} is missing from index.html`);
  return el as T;
}

// ---- the grid ---------------------------------------------------------------
const grid = byId('grid');
for (const s of SPIRITS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'target';
  b.dataset.planchetteTarget = s.id;
  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = s.icon;
  const text = document.createElement('span');
  text.textContent = s.label;
  b.append(icon, text);
  grid.appendChild(b);
}
const labels = new Map<string, string>(SPIRITS.map((s) => [s.id, s.label]));

const modeSelect = byId<HTMLSelectElement>('mode');
for (const m of MODES) modeSelect.add(new Option(m.label, m.value));

// ---- the instance -----------------------------------------------------------
const planchette: Planchette = createPlanchette({
  screen: { width: window.innerWidth, height: window.innerHeight },
  assetsUrl: `${import.meta.env.BASE_URL}mediapipe/`,
  trackingIndicator: byId('camera-status'),
});
createDwellRing(planchette);
createScanHighlight(planchette);

// For the end-to-end tests and for people trying the kit in the console.
(window as unknown as { planchetteDemo: { planchette: Planchette } }).planchetteDemo = { planchette };

const message = byId('message');
const logList = byId('log-list');
const hint = byId('hint');
const startButton = byId<HTMLButtonElement>('camera-start');
const stopButton = byId<HTMLButtonElement>('camera-stop');
let cameraWanted = false;

function say(text: string): void {
  message.textContent = text;
}

// ---- targets ----------------------------------------------------------------
function targetElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-planchette-target]'));
}
function rectOf(el: HTMLElement): { x: number; y: number; width: number; height: number } {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}
for (const el of targetElements()) {
  const role = el.dataset.role as 'cancel' | 'undo' | 'rest-area' | undefined;
  planchette.registerTarget(el.dataset.planchetteTarget!, rectOf(el), role === undefined ? undefined : { role });
}
function syncTargets(): void {
  planchette.setScreen({ width: window.innerWidth, height: window.innerHeight });
  for (const el of targetElements()) planchette.updateTarget(el.dataset.planchetteTarget!, rectOf(el));
}
window.addEventListener('resize', syncTargets);
window.addEventListener('scroll', syncTargets, { passive: true });

// ---- selections -------------------------------------------------------------
planchette.addEventListener('select', (e) => {
  const { targetId, role } = e.detail;
  if (role === 'undo') {
    const last = logList.lastElementChild;
    if (last === null) return say('Nothing to undo.');
    say(`Undone: ${last.textContent ?? ''}.`);
    last.remove();
    return;
  }
  const label = labels.get(targetId);
  if (label === undefined) return;
  const item = document.createElement('li');
  item.textContent = label;
  logList.appendChild(item);
  say(`Summoned: ${label}.`);
  const el = document.querySelector<HTMLElement>(`[data-planchette-target="${targetId}"]`);
  el?.classList.add('picked');
  setTimeout(() => el?.classList.remove('picked'), 600);
});
planchette.addEventListener('cancel', () => say('Cancelled. Nothing was added.'));

// ---- camera -----------------------------------------------------------------
function showHint(): void {
  const mode = planchette.getProfile().mode;
  const head = mode === 'head + dwell' || mode === 'head + gesture' || mode === 'gesture scan';
  hint.textContent =
    head && !cameraWanted
      ? 'Head and gesture modes need the camera: press Start camera. Or choose switch scanning or the mouse; they work without it.'
      : 'Everything stays on this device. No camera picture is stored or sent.';
}
function setCamera(on: boolean): void {
  cameraWanted = on;
  startButton.hidden = on;
  stopButton.hidden = !on;
  showHint();
}
startButton.addEventListener('click', () => {
  setCamera(true);
  planchette.startCamera().catch(() => setCamera(false)); // the failure itself is shown by the indicator
});
stopButton.addEventListener('click', () => {
  planchette.stopCamera();
  setCamera(false);
  say('Camera stopped.');
});
planchette.addEventListener('tracking-status', (e) => {
  const s = e.detail.status;
  if (s === 'found' || s === 'lost' || s === 'low-confidence') setCamera(true);
  else setCamera(false); // permission denied, load failed, no face: the indicator explains and offers the other modes
});

// ---- mode, calibration, profile --------------------------------------------
function applyLayout(profile: Profile): void {
  document.documentElement.style.setProperty('--target-size', `${profile.targetSize}px`);
  document.documentElement.style.setProperty('--target-gap', `${profile.targetSpacing}px`);
  modeSelect.value = profile.mode;
  showHint();
  requestAnimationFrame(syncTargets);
}
modeSelect.addEventListener('change', () => planchette.setMode(modeSelect.value as InputMode));
planchette.addEventListener('mode-change', () => applyLayout(planchette.getProfile()));

byId('calibrate').addEventListener('click', () => {
  if (!cameraWanted) return say('Calibration uses your head: press Start camera first.');
  planchette.startCalibration();
});
planchette.addEventListener('calibration-step', (e) => {
  const { step, completed, result } = e.detail;
  if (step !== 'done') return say(STEP_TEXT[step] ?? 'Calibration…');
  say(completed ? `Calibration finished.${result === undefined ? '' : ' Your range is saved in the profile.'}` : 'Calibration stopped.');
  applyLayout(planchette.getProfile());
});

const json = byId<HTMLTextAreaElement>('profile-json');
byId('profile-export').addEventListener('click', () => {
  json.value = planchette.exportProfile();
  say('Profile exported into the box. Copy it to keep it.');
});
byId('profile-import').addEventListener('click', () => {
  const { changes } = planchette.importProfile(json.value);
  applyLayout(planchette.getProfile());
  say(changes.length === 0 ? 'Profile imported.' : `Profile imported. ${changes.join('; ')}.`);
});

// First load: head + dwell is the default mode (no camera is started).
applyLayout(planchette.getProfile());
