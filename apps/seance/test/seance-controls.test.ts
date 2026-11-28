// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startSeance } from '../src/main';
import { KEY_SEANCE } from '../src/seance-storage';
import { FakeHost, bodyHtml, installDialogStub, stubLayout } from './seance-test-helpers';
import { MemoryStorage } from './memory-storage';
const getUserMedia = vi.fn(() => {
  throw new Error('a real camera must never be started in tests');
});
let host: FakeHost;
let storage: MemoryStorage;
const $ = (id: string): HTMLElement => document.getElementById(id)!;
const toggle = (): HTMLElement => document.querySelector<HTMLElement>('[data-planchette-target="camera-toggle"]')!;
const line = (): string => $('controls-message').textContent ?? '';
function start(saved?: object, profile: Partial<FakeHost['profile']> = {}): void {
  host = new FakeHost();
  Object.assign(host.profile, profile);
  if (saved !== undefined) storage.setItem(KEY_SEANCE, JSON.stringify({ version: 1, profile: saved }));
  startSeance(document, { create: (() => host) as never, seed: 1, storage });
}
beforeEach(() => {
  installDialogStub();
  stubLayout();
  document.body.innerHTML = bodyHtml;
  storage = new MemoryStorage();
  getUserMedia.mockClear();
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
});
afterEach(() => {
  expect(getUserMedia).not.toHaveBeenCalled();
  document.body.innerHTML = '';
});
describe('Séance controls wiring', () => {
  it('has every element the shared controls expect, and starts with the default 2100 ms when nothing was saved', () => {
    start();
    expect(host.setProfile).toHaveBeenCalledWith({ dwellTime: 2100 });
    expect([...($('mode') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['head + dwell', 'head + gesture', 'scan', 'gesture scan', 'mouse']);
    expect(toggle().textContent).toBe('Start camera');
    expect($('calibrate').textContent).toBe('Calibrate');
  });
  it('shows the first-run hint on a fresh Profile, never starts the camera, and ends the hint on the first select', () => {
    start();
    expect(line()).toBe('Choose an input mode, or press Start camera');
    expect(host.startCamera).not.toHaveBeenCalled();
    host.select('letter-a', performance.now() + 5);
    expect(line()).not.toBe('Choose an input mode, or press Start camera');
    expect(host.startCamera).not.toHaveBeenCalled();
  });
  it('never shows the hint when a Profile was saved, and keeps the saved dwell time whatever it is', () => {
    start({ dwellTime: 1000, mode: 'scan' });
    expect(line()).not.toBe('Choose an input mode, or press Start camera');
    expect(host.setProfile).toHaveBeenCalledWith({ dwellTime: 1000, mode: 'scan' });
  });
  it('does not start the camera on load, a mode change or a Round start', () => {
    start();
    ($('mode') as HTMLSelectElement).value = 'scan';
    $('mode').dispatchEvent(new Event('change'));
    host.select('stop', performance.now() + 50);
    host.select('next-round', performance.now() + 500);
    expect(host.startCamera).not.toHaveBeenCalled();
  });
  it('starts the camera once on load only when the saved Profile says so', async () => {
    start({ startCameraOnLoad: true }, { startCameraOnLoad: true });
    expect(host.startCamera).toHaveBeenCalledTimes(1);
    expect(toggle().textContent).toBe('Stop camera');
  });
  it('a rejected on-load start puts the toggle back to "Start camera"', async () => {
    host = new FakeHost();
    host.profile.startCameraOnLoad = true;
    host.startCamera.mockRejectedValueOnce(new Error('denied'));
    storage.setItem(KEY_SEANCE, JSON.stringify({ version: 1, profile: { startCameraOnLoad: true } }));
    startSeance(document, { create: (() => host) as never, seed: 1, storage });
    await Promise.resolve();
    await Promise.resolve();
    expect(toggle().textContent).toBe('Start camera');
  });
  it('the toggle reads "Start camera" again after each of the three failure causes', () => {
    start();
    for (const status of ['permission-denied', 'load-failed', 'no-face-timeout']) {
      host.select('camera-toggle', performance.now() + 100);
      expect(toggle().textContent).toBe('Stop camera');
      host.emit('tracking-status', { status, message: 'x' });
      expect(toggle().textContent, status).toBe('Start camera');
    }
  });
  it('a mode change is saved with the Profile', () => {
    start();
    ($('mode') as HTMLSelectElement).value = 'mouse';
    $('mode').dispatchEvent(new Event('change'));
    expect(JSON.parse(storage.data.get(KEY_SEANCE)!)).toMatchObject({ version: 1, profile: { mode: 'mouse' } });
  });
  it('exposes the Planchette for the end-to-end tests', () => {
    start();
    expect((window as unknown as { planchetteSeance: { planchette: unknown } }).planchetteSeance.planchette).toBe(host);
  });
});
