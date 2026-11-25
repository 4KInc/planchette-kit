// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InputMode, Planchette } from '@planchette/skeleton';
import { mountBoardControls, type BoardControls, type ControlsHost } from '../src/board-controls';
import { KEY_SETTINGS, readSettings, writeSettings } from '../src/board-storage';
import { startBoard } from '../src/main';
import { messages } from '../src/messages';
import { FakeHost as DomFakeHost } from './board-dom-helpers';

const html = readFileSync(resolve(import.meta.dirname, '../../../board/index.html'), 'utf8');
const bodyHtml = /<body>([\s\S]*)<\/body>/.exec(html)![1]!.replace(/<script[\s\S]*?<\/script>/g, '');

/** A fake Planchette: spies for the camera and calibration, and a way to emit events. */
class FakeHost extends EventTarget {
  mode: InputMode = 'head + dwell';
  startCamera = vi.fn(() => Promise.resolve());
  stopCamera = vi.fn();
  setMode = vi.fn((m: InputMode) => {
    this.mode = m;
  });
  startCalibration = vi.fn();
  getProfile() {
    return { mode: this.mode };
  }
  emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
  emitMode(mode: InputMode): void {
    this.mode = mode;
    this.emit('mode-change', { mode });
  }
  emitSelect(targetId: string): void {
    this.emit('select', { targetId, now: 0, source: 'mouse', role: 'default' });
  }
}

const getUserMedia = vi.fn(() => {
  throw new Error('a real camera must never be started in tests');
});

function $<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
const toggle = (): HTMLButtonElement => document.querySelector<HTMLButtonElement>('[data-planchette-target="camera-toggle"]')!;
const click = (el: HTMLElement, detail: number): void => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));
};

beforeEach(() => {
  document.body.innerHTML = bodyHtml;
  getUserMedia.mockClear();
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
  localStorage.clear();
});
afterEach(() => {
  expect(getUserMedia).not.toHaveBeenCalled();
});

describe('mountBoardControls', () => {
  let host: FakeHost;
  let saveProfile: ReturnType<typeof vi.fn<() => void>>;
  let controls: BoardControls;
  beforeEach(() => {
    host = new FakeHost();
    saveProfile = vi.fn<() => void>();
    controls = mountBoardControls({ host: host as unknown as ControlsHost, document, saveProfile });
  });
  afterEach(() => controls.destroy());

  it('lists exactly the five modes, with their labels', () => {
    const opts = [...$<HTMLSelectElement>('mode').options];
    expect(opts.map((o) => o.value)).toEqual(['head + dwell', 'head + gesture', 'scan', 'gesture scan', 'mouse']);
    expect(opts.map((o) => o.text)).toEqual(Object.values(messages.controls.modes));
  });

  it('calls setMode with the chosen value when the selector changes', () => {
    const sel = $<HTMLSelectElement>('mode');
    sel.value = 'scan';
    sel.dispatchEvent(new Event('change'));
    expect(host.setMode).toHaveBeenCalledWith('scan');
  });

  it('shows the mode in the selector when a mode-change event arrives', () => {
    host.emitMode('mouse');
    expect($<HTMLSelectElement>('mode').value).toBe('mouse');
  });

  it('saves the Profile on mode-change', () => {
    host.emitMode('scan');
    expect(saveProfile).toHaveBeenCalledTimes(1);
  });

  it('does not start the camera on mount or on a mode change', () => {
    host.emitMode('head + gesture');
    host.emitMode('mouse');
    expect(host.startCamera).not.toHaveBeenCalled();
    expect(toggle().textContent).toBe(messages.controls.startCamera);
  });

  it('starts the camera once when the toggle is selected while off, and reads "Stop camera"', () => {
    host.emitSelect('camera-toggle');
    expect(host.startCamera).toHaveBeenCalledTimes(1);
    expect(toggle().textContent).toBe(messages.controls.stopCamera);
  });

  it('ignores a select for another target', () => {
    host.emitSelect('speak');
    expect(host.startCamera).not.toHaveBeenCalled();
  });

  it('stops the camera when the toggle is selected while on, and reads "Start camera"', () => {
    host.emitSelect('camera-toggle');
    host.emitSelect('camera-toggle');
    expect(host.stopCamera).toHaveBeenCalledTimes(1);
    expect(toggle().textContent).toBe(messages.controls.startCamera);
    expect($<HTMLElement>('controls-message').textContent).toBe(messages.controls.cameraStopped);
  });

  it.each(['denied', 'load-failed', 'no-face-timeout'])('resets the toggle on tracking failure %s', (status) => {
    host.emitSelect('camera-toggle');
    expect(toggle().textContent).toBe(messages.controls.stopCamera);
    host.emit('tracking-status', { status });
    expect(toggle().textContent).toBe(messages.controls.startCamera);
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
  });

  it('shows "Stop camera" when tracking reports found', () => {
    host.emit('tracking-status', { status: 'found' });
    expect(toggle().textContent).toBe(messages.controls.stopCamera);
  });

  it('resets the toggle when startCamera rejects', async () => {
    host.startCamera.mockRejectedValueOnce(new Error('denied'));
    host.emitSelect('camera-toggle');
    await Promise.resolve();
    await Promise.resolve();
    expect(toggle().textContent).toBe(messages.controls.startCamera);
  });

  it('Calibrate with the camera off does not calibrate and says why', () => {
    $('calibrate').click();
    expect(host.startCalibration).not.toHaveBeenCalled();
    expect($<HTMLElement>('controls-message').textContent).toBe(messages.controls.calibrateNeedsCamera);
  });

  it('Calibrate with the camera on calls startCalibration', () => {
    host.emitSelect('camera-toggle');
    $('calibrate').click();
    expect(host.startCalibration).toHaveBeenCalledTimes(1);
  });

  it('shows the calibration step text, and saves the Profile when calibration ends', () => {
    host.emit('calibration-step', { step: 'left', completed: false });
    expect($<HTMLElement>('controls-message').textContent).toBe(messages.controls.calibrationSteps.left);
    expect(saveProfile).not.toHaveBeenCalled();
    host.emit('calibration-step', { step: 'done', completed: true });
    expect($<HTMLElement>('controls-message').textContent).toBe(messages.controls.calibrationFinished);
    expect(saveProfile).toHaveBeenCalledTimes(1);
  });

  it('shows the needs-camera hint in a head mode while the camera is off, and the privacy hint otherwise', () => {
    expect($<HTMLElement>('controls-message').textContent).toBe(messages.controls.needsCameraHint);
    host.emitMode('mouse');
    expect($<HTMLElement>('controls-message').textContent).toBe(messages.controls.privacyHint);
  });

  it('hides the message line while the tracking indicator has content', async () => {
    $('camera-status').textContent = 'Camera blocked';
    await new Promise((r) => setTimeout(r, 0));
    expect($<HTMLElement>('controls-message').hidden).toBe(true);
  });

  it('only the camera toggle is a target; the selector and Calibrate are not', () => {
    const ids = [...document.querySelectorAll('[data-planchette-target]')]
      .map((e) => e.getAttribute('data-planchette-target'))
      .filter((id) => id === 'camera-toggle');
    expect(ids).toEqual(['camera-toggle']);
    expect($('mode').hasAttribute('data-planchette-target')).toBe(false);
    expect($('calibrate').hasAttribute('data-planchette-target')).toBe(false);
  });

  describe('carer clicks on the camera toggle', () => {
    it('a DOM click in head + dwell toggles once', () => {
      click(toggle(), 1);
      expect(host.startCamera).toHaveBeenCalledTimes(1);
      click(toggle(), 1);
      expect(host.stopCamera).toHaveBeenCalledTimes(1);
    });

    it('in mouse mode a pointer click plus the skeleton select toggles once, not twice', () => {
      host.emitMode('mouse');
      click(toggle(), 1);
      host.emitSelect('camera-toggle');
      expect(host.startCamera).toHaveBeenCalledTimes(1);
      expect(host.stopCamera).not.toHaveBeenCalled();
    });

    it.each(['scan', 'gesture scan'] as const)('keyboard activation (detail 0) in %s does not toggle via click', (mode) => {
      host.emitMode(mode);
      click(toggle(), 0);
      expect(host.startCamera).not.toHaveBeenCalled();
      host.emitSelect('camera-toggle'); // the switch select still works
      expect(host.startCamera).toHaveBeenCalledTimes(1);
    });

    it('a pointer click in a scan mode toggles once', () => {
      host.emitMode('scan');
      click(toggle(), 1);
      expect(host.startCamera).toHaveBeenCalledTimes(1);
    });
  });
});

describe('startBoard camera start on load', () => {
  /** A fake Planchette with just enough surface for startBoard, the DOM layer and the ui helpers. */
  function makeFake(): Planchette & { startCamera: ReturnType<typeof vi.fn> } {
    const base = new DomFakeHost();
    let profile: Record<string, unknown> = { mode: 'head + dwell', targetSize: 96, targetSpacing: 16 };
    const fake = Object.assign(base, {
      startCamera: vi.fn(() => Promise.resolve()),
      stopCamera: vi.fn(),
      setMode: vi.fn(),
      startCalibration: vi.fn(),
      setProfile: vi.fn((p: Record<string, unknown>) => {
        profile = { ...profile, ...p };
      }),
      getProfile: () => profile,
      exportProfile: () => JSON.stringify(profile),
    });
    return fake as unknown as Planchette & { startCamera: ReturnType<typeof vi.fn> };
  }

  it('does not start the camera with the default Profile', () => {
    const fake = makeFake();
    startBoard(document, () => fake);
    expect(fake.startCamera).not.toHaveBeenCalled();
  });

  it('does not start the camera when startCameraOnLoad is false', () => {
    const board = readSettings().value.board;
    writeSettings({ profile: { startCameraOnLoad: false }, board });
    expect(localStorage.getItem(KEY_SETTINGS)).not.toBeNull();
    const fake = makeFake();
    startBoard(document, () => fake);
    expect(fake.startCamera).not.toHaveBeenCalled();
  });

  it('starts the camera once on load when startCameraOnLoad is true', () => {
    const board = readSettings().value.board;
    writeSettings({ profile: { startCameraOnLoad: true }, board });
    const fake = makeFake();
    startBoard(document, () => fake);
    expect(fake.startCamera).toHaveBeenCalledTimes(1);
    expect(toggle().textContent).toBe(messages.controls.stopCamera);
  });

  it('resets the toggle when the on-load start is rejected', async () => {
    const board = readSettings().value.board;
    writeSettings({ profile: { startCameraOnLoad: true }, board });
    const fake = makeFake();
    fake.startCamera.mockRejectedValueOnce(new Error('denied'));
    startBoard(document, () => fake);
    await Promise.resolve();
    await Promise.resolve();
    expect(toggle().textContent).toBe(messages.controls.startCamera);
  });
});
