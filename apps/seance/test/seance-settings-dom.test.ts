// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountSeanceSettings, type SeanceSettings } from '../src/seance-settings-dom';
import { FakeHost, bodyHtml, installDialogStub } from './seance-test-helpers';
let host: FakeHost;
let settings: SeanceSettings;
const save = vi.fn();
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
beforeEach(() => {
  installDialogStub();
  document.body.innerHTML = bodyHtml;
  host = new FakeHost();
  save.mockClear();
  settings = mountSeanceSettings({ host: host as never, document, saveProfile: save });
});
afterEach(() => {
  settings.destroy();
  document.body.innerHTML = '';
});
const open = (): void => $('settings-button').click();
const setDwell = (v: string): void => {
  $<HTMLInputElement>('dwell-input').value = v;
  $('dwell-input').dispatchEvent(new Event('change'));
};
describe('Settings dialog', () => {
  it('opens with the current values', () => {
    host.profile.dwellTime = 1500;
    host.profile.startCameraOnLoad = true;
    open();
    expect($<HTMLDialogElement>('settings').open).toBe(true);
    expect($<HTMLInputElement>('dwell-input').value).toBe('1500');
    expect($<HTMLInputElement>('camera-on-load').checked).toBe(true);
  });
  it('dwell time is rounded to 50 and clamped to 400..3000, applied and saved', () => {
    open();
    setDwell('2124');
    expect(host.profile.dwellTime).toBe(2100);
    setDwell('9999');
    expect(host.profile.dwellTime).toBe(3000);
    setDwell('10');
    expect(host.profile.dwellTime).toBe(400);
    expect(save).toHaveBeenCalledTimes(3);
    setDwell('abc');
    expect(host.profile.dwellTime).toBe(400);
    expect($<HTMLInputElement>('dwell-input').value).toBe('400');
  });
  it('the camera-on-load box is saved with the Profile and is off by default', () => {
    open();
    expect($<HTMLInputElement>('camera-on-load').checked).toBe(false);
    $<HTMLInputElement>('camera-on-load').click();
    expect(host.profile.startCameraOnLoad).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('blocks selects while open and for a select stamped before the close; Close returns focus to Settings', () => {
    expect(settings.isBlocked(performance.now() + 1000)).toBe(false);
    open();
    expect(settings.isBlocked(performance.now() + 1000)).toBe(true);
    const before = performance.now();
    $('settings-close').click();
    expect($<HTMLDialogElement>('settings').open).toBe(false);
    expect(document.activeElement).toBe($('settings-button'));
    expect(settings.isBlocked(before)).toBe(true);
    expect(settings.isBlocked(performance.now() + 1000)).toBe(false);
  });
  it('About shows the notice and the version, and Back returns; reopening shows the settings, not About', () => {
    open();
    $('about-button').click();
    expect($('about').hidden).toBe(false);
    expect($('settings-main').hidden).toBe(true);
    expect($('about-body').textContent).toContain('not a medical device');
    expect($('about-version').textContent).toMatch(/^Version \d/);
    $('about-back').click();
    expect($('settings-main').hidden).toBe(false);
    $('about-button').click();
    $('settings-close').click();
    open();
    expect($('settings-main').hidden).toBe(false);
    expect($('about').hidden).toBe(true);
  });
  it('Tab wraps inside the dialog', () => {
    open();
    const focusable = [...document.querySelectorAll<HTMLElement>('#settings input, #settings button')].filter((c) => c.closest('[hidden]') === null);
    focusable[focusable.length - 1]!.focus();
    const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    $('settings').dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(focusable[0]);
  });
});
