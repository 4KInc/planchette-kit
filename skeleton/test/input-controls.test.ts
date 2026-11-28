// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InputMode } from '../src/api-types.js';
import { mountInputControls, type InputControls, type InputControlsText } from '../src/ui/input-controls.js';
const text: InputControlsText = {
  inputMode: 'IM',
  modes: { headDwell: 'HD', headGesture: 'HG', scan: 'SC', gestureScan: 'GS', mouse: 'MO' },
  startCamera: 'Start cam',
  stopCamera: 'Stop cam',
  calibrate: 'Cal',
  cameraStopped: 'Stopped.',
  calibrateNeedsCamera: 'Camera first.',
  needsCameraHint: 'NEEDS CAMERA',
  firstRunHint: 'FIRST RUN',
  privacyHint: 'PRIVATE',
  calibrationFinished: 'Cal done.',
  calibrationStopped: 'Cal stopped.',
  calibrationWorking: 'Cal working',
  calibrationSteps: { centre: 'Look at the centre' },
};
const PAGE = `
  <label for="mode"></label><select id="mode"></select>
  <button id="settings-button">Settings</button>
  <button data-planchette-target="camera-toggle"></button>
  <div id="camera-status"></div>
  <p id="controls-message"></p>
  <dialog id="settings"><button id="calibrate"></button><p id="settings-message"></p></dialog>`;
class FakeHost extends EventTarget {
  mode: InputMode = 'head + dwell';
  startCamera = vi.fn(() => Promise.resolve());
  stopCamera = vi.fn();
  setMode = vi.fn((m: InputMode) => void (this.mode = m));
  startCalibration = vi.fn();
  getProfile() {
    return { mode: this.mode };
  }
  emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
  select(targetId: string, now = 0): void {
    this.emit('select', { targetId, now, source: 'mouse', role: 'default' });
  }
}
let host: FakeHost;
let controls: InputControls;
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const toggle = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('[data-planchette-target="camera-toggle"]')!;
const line = (): string => $('controls-message').textContent ?? '';
const mount = (firstRun = false, saveProfile: () => void = () => undefined): void => {
  host = new FakeHost();
  controls = mountInputControls({ host: host as never, document, text, saveProfile, firstRun });
};
beforeEach(() => {
  document.body.innerHTML = PAGE;
  // jsdom has no <dialog> methods
  const d = $<HTMLDialogElement>('settings');
  d.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  d.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});
afterEach(() => {
  controls?.destroy();
  document.body.innerHTML = '';
});
describe('mountInputControls', () => {
  it('lists the five modes with the app text and labels the select', () => {
    mount();
    const opts = [...$<HTMLSelectElement>('mode').options].map((o) => [o.value, o.textContent]);
    expect(opts).toEqual([['head + dwell', 'HD'], ['head + gesture', 'HG'], ['scan', 'SC'], ['gesture scan', 'GS'], ['mouse', 'MO']]);
    expect(document.querySelector('label[for="mode"]')!.textContent).toBe('IM');
    expect($('calibrate').textContent).toBe('Cal');
    expect(toggle().textContent).toBe('Start cam');
  });
  it('the selector calls setMode; a mode-change event shows the mode and saves the Profile', () => {
    const save = vi.fn();
    mount(false, save);
    const sel = $<HTMLSelectElement>('mode');
    sel.value = 'scan';
    sel.dispatchEvent(new Event('change'));
    expect(host.setMode).toHaveBeenCalledWith('scan');
    host.mode = 'mouse';
    host.emit('mode-change', { mode: 'mouse' });
    expect(sel.value).toBe('mouse');
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('never starts the camera on mount or on a mode change; the toggle starts and stops it', () => {
    mount();
    host.emit('mode-change', { mode: 'scan' });
    expect(host.startCamera).not.toHaveBeenCalled();
    host.select('something-else');
    expect(host.startCamera).not.toHaveBeenCalled();
    host.select('camera-toggle');
    expect(host.startCamera).toHaveBeenCalledTimes(1);
    expect(toggle().textContent).toBe('Stop cam');
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    host.select('camera-toggle');
    expect(host.stopCamera).toHaveBeenCalledTimes(1);
    expect(toggle().textContent).toBe('Start cam');
    expect(line()).toBe('Stopped.');
  });
  it('resets the toggle when startCamera rejects and on each failure status', async () => {
    mount();
    host.startCamera.mockRejectedValueOnce(new Error('denied'));
    host.select('camera-toggle');
    await Promise.resolve();
    await Promise.resolve();
    expect(toggle().textContent).toBe('Start cam');
    controls.setCameraOn(true);
    for (const status of ['permission-denied', 'load-failed', 'no-face']) {
      controls.setCameraOn(true);
      host.emit('tracking-status', { status });
      expect(toggle().textContent, status).toBe('Start cam');
    }
    host.emit('tracking-status', { status: 'found' });
    expect(toggle().textContent).toBe('Stop cam');
  });
  it('Calibrate with the camera off keeps the dialog open and says why; with it on, closes, focuses Settings and calibrates', () => {
    mount();
    const dlg = $<HTMLDialogElement>('settings');
    dlg.showModal();
    $('calibrate').click();
    expect(dlg.hasAttribute('open')).toBe(true);
    expect($('settings-message').textContent).toBe('Camera first.');
    expect(host.startCalibration).not.toHaveBeenCalled();
    controls.setCameraOn(true);
    $('calibrate').click();
    expect(dlg.hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe($('settings-button'));
    expect(host.startCalibration).toHaveBeenCalledTimes(1);
  });
  it('shows calibration steps, the result, and saves the Profile when a run ends', () => {
    const save = vi.fn();
    mount(false, save);
    host.emit('calibration-step', { step: 'centre', completed: false });
    expect(line()).toBe('Look at the centre');
    host.emit('calibration-step', { step: 'unknown', completed: false });
    expect(line()).toBe('Cal working');
    host.emit('calibration-step', { step: 'done', completed: true });
    expect(line()).toBe('Cal done.');
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('hints: needs-camera in a camera mode with the camera off, privacy otherwise', () => {
    mount();
    expect(line()).toBe('NEEDS CAMERA');
    host.mode = 'mouse';
    host.emit('mode-change', { mode: 'mouse' });
    expect(line()).toBe('PRIVATE');
  });
  it('hides the message line while the tracking indicator has content', async () => {
    mount();
    $('camera-status').textContent = 'No face';
    await new Promise((r) => setTimeout(r, 0));
    expect($('controls-message').hidden).toBe(true);
    $('camera-status').replaceChildren();
    await new Promise((r) => setTimeout(r, 0));
    expect($('controls-message').hidden).toBe(false);
  });
  it('first-run hint: shown first, ended by any select or a camera start, never returns, never starts the camera', () => {
    mount(true);
    expect(line()).toBe('FIRST RUN');
    host.emit('mode-change', { mode: 'scan' });
    expect(line()).toBe('FIRST RUN');
    host.select('anything');
    expect(line()).not.toBe('FIRST RUN');
    controls.setCameraOn(false);
    expect(line()).not.toBe('FIRST RUN');
    expect(host.startCamera).not.toHaveBeenCalled();
    controls.destroy();
    document.body.innerHTML = PAGE;
    mount(true);
    controls.setCameraOn(true);
    expect(line()).not.toBe('FIRST RUN');
  });
  it('ignores selects while the dialog is open, and a select stamped before it closed', () => {
    mount();
    const dlg = $<HTMLDialogElement>('settings');
    dlg.showModal();
    host.select('camera-toggle');
    expect(host.startCamera).not.toHaveBeenCalled();
    dlg.close();
    host.select('camera-toggle', 0); // stamped at 0: before the close
    expect(host.startCamera).not.toHaveBeenCalled();
    host.select('camera-toggle', performance.now() + 10_000);
    expect(host.startCamera).toHaveBeenCalledTimes(1);
  });
  describe('carer clicks on the toggle', () => {
    const click = (detail: number): void => void toggle().dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));
    it('a DOM click toggles once in head + dwell', () => {
      mount();
      click(1);
      expect(host.startCamera).toHaveBeenCalledTimes(1);
    });
    it('in mouse mode a pointer click is left to the skeleton select; a keyboard activation toggles', () => {
      mount();
      host.mode = 'mouse';
      click(1);
      expect(host.startCamera).not.toHaveBeenCalled();
      click(0);
      expect(host.startCamera).toHaveBeenCalledTimes(1);
    });
    it('in a scan mode a pointer click toggles and a keyboard activation does not (Space is the switch)', () => {
      mount();
      host.mode = 'scan';
      click(0);
      expect(host.startCamera).not.toHaveBeenCalled();
      click(1);
      expect(host.startCamera).toHaveBeenCalledTimes(1);
    });
  });
  it('throws a clear error when a required element is missing', () => {
    document.getElementById('mode')!.remove();
    expect(() => mountInputControls({ host: new FakeHost() as never, document, text, saveProfile: () => undefined })).toThrow(/#mode is missing/);
  });
  it('destroy removes the listeners', () => {
    mount();
    controls.destroy();
    host.select('camera-toggle');
    expect(host.startCamera).not.toHaveBeenCalled();
  });
});
