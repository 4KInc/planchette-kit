// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Planchette, Profile } from '@planchette/skeleton';
import { mountBoardControls, type ControlsHost } from '../src/board-controls';
import { mountBoardDom, type BoardDomApp, type BoardHost } from '../src/board-dom';
import { mountBoardSettings, type BoardSettingsDom, type SettingsSynth } from '../src/board-settings-dom';
import { readSettings, type StorageLike } from '../src/board-storage';
import { CORE_VOCABULARY } from '../src/core-vocabulary';
import { createBoardApp, type BoardApp } from '../src/main';
import { messages } from '../src/messages';
import { FakeHost as DomFakeHost, installDialogStub } from './board-dom-helpers';

const html = readFileSync(resolve(import.meta.dirname, '../../../board/index.html'), 'utf8');
const bodyHtml = /<body>([\s\S]*)<\/body>/.exec(html)![1]!.replace(/<script[\s\S]*?<\/script>/g, '');

const memory = (): StorageLike => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

const getUserMedia = vi.fn(() => {
  throw new Error('a real camera must never be started in tests');
});

/** A fake Planchette: records, clamps the one field the tests push out of range, never opens a camera. */
function makeHost() {
  const base = new DomFakeHost();
  let profile: Record<string, unknown> = { mode: 'head + dwell', targetSize: 96, targetSpacing: 16, dwellTime: 1400, startCameraOnLoad: false, headGain: 1, switchBinding: ' ', switchGesture: 'jaw open', cancelByHold: true };
  const host = Object.assign(base, {
    startCamera: vi.fn(() => Promise.resolve()),
    stopCamera: vi.fn(),
    setMode: vi.fn(),
    startCalibration: vi.fn(),
    setProfile: vi.fn((p: Record<string, unknown>) => {
      const next = { ...profile, ...p };
      if (typeof next.dwellTime === 'number') next.dwellTime = Math.min(3000, Math.max(400, next.dwellTime));
      profile = next;
    }),
    getProfile: () => profile,
    exportProfile: () => JSON.stringify(profile),
    importProfile: vi.fn((json: string) => {
      const parsed = JSON.parse(json) as Record<string, unknown>;
      profile = { ...profile, ...parsed };
      return { profile, changes: [] as string[] };
    }),
  });
  return host;
}

function makeSynth(voices: Array<{ name: string; voiceURI: string; localService: boolean }>): SettingsSynth & { fire(): void } {
  const target = new EventTarget();
  return Object.assign(target, {
    getVoices: () => voices as unknown as SpeechSynthesisVoice[],
    fire: () => target.dispatchEvent(new Event('voiceschanged')),
  }) as unknown as SettingsSynth & { fire(): void };
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const dialog = (): HTMLDialogElement => $<HTMLDialogElement>('settings');
const byLabel = (text: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement => {
  const label = [...dialog().querySelectorAll('label')].find((l) => l.textContent === text);
  if (label === undefined) throw new Error(`no label "${text}"`);
  return document.getElementById(label.htmlFor) as HTMLInputElement;
};
const change = (el: Element): void => void el.dispatchEvent(new Event('change', { bubbles: true }));

let stub: ReturnType<typeof installDialogStub>;
let cleanup: Array<() => void> = [];
let storage: StorageLike;

function setup(opts: { voices?: Array<{ name: string; voiceURI: string; localService: boolean }>; wordList?: Map<string, number>; excluded?: Set<string> } = {}) {
  document.body.innerHTML = bodyHtml;
  storage = memory();
  const speak = vi.fn(() => Promise.resolve({ spoken: true }));
  const app: BoardApp = createBoardApp({
    speak,
    now: () => 0,
    storage,
    ...(opts.wordList === undefined ? {} : { wordList: { words: opts.wordList } }),
    ...(opts.excluded === undefined ? {} : { excluded: opts.excluded }),
  });
  const host = makeHost();
  const saveProfile = (): void => app.saveProfile(JSON.parse(host.exportProfile()) as Partial<Profile>);
  const dom = mountBoardDom({ host: host as unknown as BoardHost, app: app as unknown as BoardDomApp, document });
  const controls = mountBoardControls({ host: host as unknown as ControlsHost, document, saveProfile });
  const synth = makeSynth(opts.voices ?? []);
  const syncTargets = vi.fn(() => dom.syncTargets());
  const settings: BoardSettingsDom = mountBoardSettings({ host: host as unknown as Pick<Planchette, 'getProfile' | 'setProfile' | 'exportProfile' | 'importProfile'>, app, document, saveProfile, syncTargets, synth });
  cleanup = [() => settings.destroy(), () => controls.destroy(), () => dom.destroy()];
  return { app, host, speak, synth, syncTargets, saveProfile };
}

beforeEach(() => {
  stub = installDialogStub();
  getUserMedia.mockClear();
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
});
afterEach(() => {
  for (const fn of cleanup) fn();
  cleanup = [];
  expect(getUserMedia).not.toHaveBeenCalled();
});

describe('the Settings dialog', () => {
  it('has an accessible name from its heading', () => {
    setup();
    const name = document.getElementById(dialog().getAttribute('aria-labelledby')!)!;
    expect(name.textContent).toBe(messages.settings.title);
    expect($('settings-button').textContent).toBe(messages.controls.settings);
  });

  it('opens from the Settings button and closes from Close, returning focus to the button', () => {
    setup();
    $('settings-button').click();
    expect(dialog().open).toBe(true);
    $('settings-close').click();
    expect(dialog().open).toBe(false);
    expect(document.activeElement).toBe($('settings-button'));
  });

  it('returns focus to the Settings button after an Escape-style close', () => {
    setup();
    $('settings-button').click();
    $('about-button').focus();
    stub.escape(dialog());
    expect(dialog().open).toBe(false);
    expect(document.activeElement).toBe($('settings-button'));
  });

  it('ignores every select while open, and works again after it closes', () => {
    const { app, host, speak } = setup();
    app.model.dispatch({ type: 'add-word', text: 'I' }, false);
    const ids = [`core-${CORE_VOCABULARY[0]!.id}`, 'prediction-slot-0', 'speak', 'clear', 'undo', 'spell-toggle', 'phrases-toggle', 'camera-toggle', 'backspace-action', 'quick-phrase-qp-1'];
    $('settings-button').click();
    for (const id of ids) host.select(id);
    host.dispatchEvent(new CustomEvent('select', { detail: { targetId: 'cancel', now: 0, source: 'mouse', role: 'cancel' } }));
    expect(app.model.message).toBe('I');
    expect(speak).not.toHaveBeenCalled();
    expect(host.startCamera).not.toHaveBeenCalled();
    expect(host.stopCamera).not.toHaveBeenCalled();
    expect($('core-grid').hidden).toBe(false);
    expect($('phrases-grid').hidden).toBe(true);
    $('settings-close').click();
    host.select(`core-${CORE_VOCABULARY[0]!.id}`);
    expect(app.model.message).toBe(`I ${CORE_VOCABULARY[0]!.label}`);
    host.select('phrases-toggle');
    expect($('phrases-grid').hidden).toBe(false);
  });

  it('ignores a select whose press happened while the dialog was open, even if it arrives after close', () => {
    const { app, host } = setup();
    const word = CORE_VOCABULARY[0]!;
    const pressedAt = performance.now();
    $('settings-button').click();
    $('settings-close').click(); // the engine reads the press on the next frame, after the dialog has closed
    const late = (now: number): void =>
      void host.dispatchEvent(new CustomEvent('select', { detail: { targetId: `core-${word.id}`, now, source: 'mouse', role: 'default' } }));
    late(pressedAt);
    host.select('camera-toggle');
    expect(app.model.message).toBe('');
    late(performance.now() + 1);
    expect(app.model.message).toBe(word.label);
  });

  it('wraps Tab from the last control to the first, and Shift+Tab from the first to the last', () => {
    setup();
    $('settings-button').click();
    const list = [...dialog().querySelectorAll<HTMLElement>('input, select, textarea, button, a[href]')].filter((c) => !(c as HTMLInputElement).disabled && c.closest('[hidden]') === null);
    const key = (shiftKey: boolean): KeyboardEvent => {
      const e = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
      document.activeElement!.dispatchEvent(e);
      return e;
    };
    list.at(-1)!.focus();
    expect(key(false).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(list[0]);
    expect(key(true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(list.at(-1));
    list[3]!.focus();
    expect(key(false).defaultPrevented).toBe(false); // in the middle the browser moves focus
  });

  it('opening and closing change neither the view nor the phrases page', () => {
    const { host } = setup();
    host.select('phrases-toggle');
    expect($('phrases-grid').hidden).toBe(false);
    $('settings-button').click();
    $('settings-close').click();
    expect($('phrases-grid').hidden).toBe(false);
    expect($('core-grid').hidden).toBe(true);
    expect($('phrases-page').textContent).toBe(messages.phrases.pageOf(1, 1));
  });

  it('Calibrate with the camera off keeps the dialog open, says why, and does not calibrate', () => {
    const { host } = setup();
    $('settings-button').click();
    $('calibrate').click();
    expect(dialog().open).toBe(true);
    expect($('settings-message').textContent).toBe(messages.controls.calibrateNeedsCamera);
    expect(host.startCalibration).not.toHaveBeenCalled();
  });

  it('Calibrate with the camera on closes the dialog, focuses the Settings button and calibrates once', () => {
    const { host } = setup();
    host.dispatchEvent(new CustomEvent('tracking-status', { detail: { status: 'found' } }));
    $('settings-button').click();
    $('calibrate').click();
    expect(dialog().open).toBe(false);
    expect(document.activeElement).toBe($('settings-button'));
    expect(host.startCalibration).toHaveBeenCalledTimes(1);
  });

  it('swaps in About and returns with Back', () => {
    setup();
    $('settings-button').click();
    $('about-button').click();
    expect($('about').hidden).toBe(false);
    expect($('settings-main').hidden).toBe(true);
    expect(document.activeElement).toBe($('about-back'));
    $('about-back').click();
    expect($('about').hidden).toBe(true);
    expect($('settings-main').hidden).toBe(false);
    expect(document.activeElement).toBe($('about-button'));
  });

  it('reopens on the settings, not on About', () => {
    setup();
    $('settings-button').click();
    $('about-button').click();
    $('settings-close').click();
    $('settings-button').click();
    expect($('about').hidden).toBe(true);
    expect($('settings-main').hidden).toBe(false);
  });

  it('gives every control an accessible name and keeps it in the Tab order', () => {
    setup();
    const controls = [...dialog().querySelectorAll<HTMLElement>('input, select, textarea, button')].filter((c) => c.closest('#about') === null);
    expect(controls.length).toBeGreaterThan(40);
    for (const c of controls) {
      const labelled = (c as HTMLInputElement).labels?.length ? (c as HTMLInputElement).labels![0]!.textContent : '';
      const name = c.getAttribute('aria-label') ?? (labelled || c.textContent);
      expect(name, `${c.tagName} #${c.id}`).toBeTruthy();
      expect(c.tabIndex, `${c.tagName} #${c.id} tabindex`).toBeGreaterThanOrEqual(0);
    }
    // The fixed order: Settings sections first, then Calibrate, then About and Close.
    const order = controls.map((c) => c.id);
    expect(order.indexOf('calibrate')).toBeGreaterThan(order.indexOf(byLabel(messages.settings.transfer.box).id));
    expect(order.slice(-2)).toEqual(['about-button', 'settings-close']);
  });
});

describe('voice and speech rate', () => {
  it('says "No local voices available" when no voice is a local service', () => {
    setup({ voices: [{ name: 'Cloud', voiceURI: 'cloud', localService: false }] });
    const select = byLabel(messages.settings.voice) as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual([messages.settings.noLocalVoices]);
    expect(select.disabled).toBe(true);
    expect(dialog().textContent).toContain(messages.settings.noLocalVoices);
  });

  it('lists local voices only, saves the choice at once, and follows voiceschanged', () => {
    const { app, synth } = setup({ voices: [] });
    const select = byLabel(messages.settings.voice) as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    (synth as unknown as { getVoices: () => unknown }).getVoices = () => [
      { name: 'Local A', voiceURI: 'a', localService: true },
      { name: 'Cloud', voiceURI: 'c', localService: false },
    ];
    synth.fire();
    expect([...select.options].map((o) => o.value)).toEqual(['', 'a']);
    select.value = 'a';
    change(select);
    expect(app.getSettings().voiceURI).toBe('a');
    expect(readSettings(storage).value.board.voiceURI).toBe('a');
  });

  it('saves the speech rate at once', () => {
    const { app } = setup();
    const rate = byLabel(messages.settings.speechRate) as HTMLInputElement;
    expect(rate.type).toBe('range');
    rate.value = '1.5';
    change(rate);
    expect(app.getSettings().speechRate).toBe(1.5);
    expect(readSettings(storage).value.board.speechRate).toBe(1.5);
  });
});

describe('Board settings', () => {
  it('clamps the number of suggestions, saves it, and keeps the live strip as it is', () => {
    const { app } = setup();
    const count = byLabel(messages.settings.predictionSlotCount) as HTMLInputElement;
    expect(count.value).toBe('4');
    count.value = '12';
    change(count);
    expect(count.value).toBe('8');
    expect(readSettings(storage).value.board.predictionSlotCount).toBe(8);
    expect(app.strip.slots.length).toBe(4);
    expect(dialog().textContent).toContain('scrolling');
  });

  it('has the filter checkbox on at first run; toggling saves it and changes the candidates, not the Message', () => {
    const wordList = new Map([['bad', 1], ['good', 0.5], ['fine', 0.4], ['ok', 0.3], ['sure', 0.2]]);
    const { app } = setup({ wordList, excluded: new Set(['bad']) });
    const filter = byLabel(messages.settings.filterOffensiveWords) as HTMLInputElement;
    expect(filter.type).toBe('checkbox');
    expect(filter.checked).toBe(true);
    app.model.dispatch({ type: 'add-word', text: 'I' }, false);
    expect(app.strip.slots.map((s) => s.word)).not.toContain('bad');
    filter.checked = false;
    change(filter);
    expect(app.strip.slots.map((s) => s.word)).toContain('bad');
    expect(app.model.message).toBe('I');
    expect(readSettings(storage).value.board.filterOffensiveWords).toBe(false);
  });
});

describe('Profile fields', () => {
  it('shows "Start camera when the page opens" unchecked at first run; toggling saves the Profile and starts nothing', () => {
    const { host } = setup();
    const box = byLabel(messages.settings.startCameraOnLoad) as HTMLInputElement;
    expect(box.type).toBe('checkbox');
    expect(box.checked).toBe(false);
    box.checked = true;
    change(box);
    expect(host.setProfile).toHaveBeenCalledWith({ startCameraOnLoad: true });
    expect(readSettings(storage).value.profile.startCameraOnLoad).toBe(true);
    expect(host.startCamera).not.toHaveBeenCalled();
  });

  it('shows a help text with the allowed range, applies through setProfile, and shows what the skeleton kept', () => {
    const { host, syncTargets } = setup();
    const dwell = byLabel(messages.settings.fields.dwellTime) as HTMLInputElement;
    expect(dwell.value).toBe('1400');
    expect(document.getElementById(dwell.getAttribute('aria-describedby')!)!.textContent).toBe('Allowed: 400 to 3000 ms. Default: 2100 ms.');
    dwell.value = '99999';
    change(dwell);
    expect(host.setProfile).toHaveBeenCalledWith({ dwellTime: 99999 });
    expect(dwell.value).toBe('3000');
    expect(readSettings(storage).value.profile.dwellTime).toBe(3000);
    expect(syncTargets).not.toHaveBeenCalled();
    const size = byLabel(messages.settings.fields.targetSize) as HTMLInputElement;
    size.value = '120';
    change(size);
    expect(syncTargets).toHaveBeenCalledTimes(1);
  });

  it('ignores an empty or non-numeric entry and restores the shown value', () => {
    const { host } = setup();
    const dwell = byLabel(messages.settings.fields.dwellTime) as HTMLInputElement;
    dwell.value = '';
    change(dwell);
    expect(host.setProfile).not.toHaveBeenCalled();
    expect(dwell.value).toBe('1400');
  });

  it('has a labelled control with range help for every Profile field except mode', () => {
    setup();
    for (const label of Object.values(messages.settings.fields)) expect(byLabel(label), label).toBeTruthy();
    expect(document.getElementById(byLabel(messages.settings.fields.headDeadZone).getAttribute('aria-describedby')!)!.textContent).toContain('half the smallest calibration limit');
    expect(dialog().querySelector('#mode')).toBeNull();
  });
});

describe('Export and Import', () => {
  it('Export puts the BoardExport JSON in the text box', () => {
    const { host } = setup();
    const box = byLabel(messages.settings.transfer.box) as HTMLTextAreaElement;
    [...dialog().querySelectorAll('button')].find((b) => b.textContent === messages.settings.transfer.export)!.click();
    const out = JSON.parse(box.value) as { version: number; profile: Record<string, unknown>; board: Record<string, unknown> };
    expect(out.version).toBe(1);
    expect(out.profile).toEqual(host.getProfile());
    expect(out.board).toEqual({ predictionSlotCount: 4, voiceURI: '', speechRate: 1, filterOffensiveWords: true });
  });

  it('Import of a valid export updates the model, saves, and reports no changes', () => {
    const { app } = setup();
    const box = byLabel(messages.settings.transfer.box) as HTMLTextAreaElement;
    const buttons = [...dialog().querySelectorAll('button')];
    box.value = JSON.stringify({ version: 1, profile: { dwellTime: 2000 }, board: { predictionSlotCount: 6, voiceURI: 'x', speechRate: 1.2, filterOffensiveWords: false } });
    buttons.find((b) => b.textContent === messages.settings.transfer.import)!.click();
    expect(app.getSettings()).toEqual({ predictionSlotCount: 6, voiceURI: 'x', speechRate: 1.2, filterOffensiveWords: false });
    expect((byLabel(messages.settings.fields.dwellTime) as HTMLInputElement).value).toBe('2000');
    expect((byLabel(messages.settings.filterOffensiveWords) as HTMLInputElement).checked).toBe(false);
    expect(readSettings(storage).value.board.predictionSlotCount).toBe(6);
    expect($('settings-import-report').textContent).toBe(messages.settings.transfer.imported);
  });

  it('Import with an out-of-range value reports the clamp', () => {
    const { app } = setup();
    const box = byLabel(messages.settings.transfer.box) as HTMLTextAreaElement;
    box.value = JSON.stringify({ version: 1, profile: {}, board: { predictionSlotCount: 4, voiceURI: '', speechRate: 9, filterOffensiveWords: true } });
    [...dialog().querySelectorAll('button')].find((b) => b.textContent === messages.settings.transfer.import)!.click();
    expect(app.getSettings().speechRate).toBe(2);
    expect($('settings-import-report').textContent).toContain('speechRate');
    expect($('settings-import-report').textContent).toContain('adjusted to 2');
  });
});

describe('Quick-phrases editor', () => {
  const phraseInputs = (): HTMLInputElement[] => [...dialog().querySelectorAll<HTMLInputElement>('.phrase-list input')];
  const button = (li: Element, part: string): HTMLButtonElement => li.querySelector<HTMLButtonElement>(`button[data-part="${part}"]`)!;
  const add = (text: string): void => {
    (byLabel(messages.settings.phrases.newPhrase) as HTMLInputElement).value = text;
    [...dialog().querySelectorAll('button')].find((b) => b.textContent === messages.settings.phrases.add)!.click();
  };

  it('lists the starter phrases with an accessible name each', () => {
    setup();
    expect(phraseInputs().map((i) => i.value)).toEqual([...messages.starterQuickPhrases]);
    expect(phraseInputs()[0]!.getAttribute('aria-label')).toBe('Phrase 1');
  });

  it('edits, adds, removes and reorders with Move up / Move down, saving each change', () => {
    const { app } = setup();
    const texts = (): string[] => app.quickPhrases.phrases.map((p) => p.text);
    const first = phraseInputs()[0]!;
    first.value = 'Yes please';
    change(first);
    expect(texts()[0]).toBe('Yes please');
    add('Water');
    expect(texts().at(-1)).toBe('Water');
    expect(phraseInputs().at(-1)!.value).toBe('Water');
    const items = (): Element[] => [...dialog().querySelectorAll('.phrase-list li')];
    button(items()[1]!, 'up').click();
    expect(texts().slice(0, 2)).toEqual(['No', 'Yes please']);
    expect(document.activeElement).toBe(button(items()[0]!, 'up').disabled ? items()[0]!.querySelector('input') : button(items()[0]!, 'up'));
    button(items()[0]!, 'down').click();
    expect(texts().slice(0, 2)).toEqual(['Yes please', 'No']);
    expect(button(items()[0]!, 'up').disabled).toBe(true);
    expect(button(items().at(-1)!, 'down').disabled).toBe(true);
    button(items().at(-1)!, 'remove').click();
    expect(texts()).not.toContain('Water');
    expect(phraseInputs().length).toBe(texts().length);
  });

  it('shows the full message for the 101st phrase and leaves the list unchanged', () => {
    const { app } = setup();
    while (app.quickPhrases.phrases.length < 100) app.quickPhrases.add(`p${app.quickPhrases.phrases.length}`);
    const before = app.quickPhrases.phrases.map((p) => p.text);
    add('one too many');
    expect($('quick-phrases-status').textContent).toBe(messages.quickPhrases.full);
    expect(app.quickPhrases.phrases.map((p) => p.text)).toEqual(before);
    expect(phraseInputs().length).toBe(100);
  });
});
