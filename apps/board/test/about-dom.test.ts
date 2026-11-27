// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Planchette } from '@planchette/skeleton';
import { mountBoardDom, type BoardDomApp, type BoardHost } from '../src/board-dom';
import { mountBoardSettings, type BoardSettingsDom } from '../src/board-settings-dom';
import { createBoardApp } from '../src/main';
import { messages } from '../src/messages';
import { FakeHost, installDialogStub } from './board-dom-helpers';

const html = readFileSync(resolve(import.meta.dirname, '../../../board/index.html'), 'utf8');
const bodyHtml = /<body>([\s\S]*)<\/body>/.exec(html)![1]!.replace(/<script[\s\S]*?<\/script>/g, '');
const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')) as { version: string };

let cleanup: Array<() => void> = [];
beforeEach(() => {
  installDialogStub();
  document.body.innerHTML = bodyHtml;
  const store = new Map<string, string>();
  const app = createBoardApp({
    speak: vi.fn(() => Promise.resolve({ spoken: true })),
    now: () => 0,
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
  });
  const host = Object.assign(new FakeHost(), { setProfile: vi.fn(), exportProfile: () => '{}', importProfile: vi.fn() });
  const dom = mountBoardDom({ host: host as unknown as BoardHost, app: app as unknown as BoardDomApp, document });
  const settings: BoardSettingsDom = mountBoardSettings({
    host: host as unknown as Pick<Planchette, 'getProfile' | 'setProfile' | 'exportProfile' | 'importProfile'>,
    app,
    document,
    saveProfile: () => {},
    syncTargets: () => {},
    synth: null,
  });
  cleanup = [() => settings.destroy(), () => dom.destroy()];
});
afterEach(() => cleanup.forEach((fn) => fn()));

const about = (): HTMLElement => document.getElementById('about')!;
const hrefs = (): string[] => [...about().querySelectorAll('a')].map((a) => a.getAttribute('href')!);

describe('About screen', () => {
  it('is reachable from the Settings dialog: the About button comes after the sections, in Tab order', () => {
    const button = document.getElementById('about-button') as HTMLButtonElement;
    expect(button.closest('#settings')).not.toBeNull();
    expect(button.tabIndex).toBeGreaterThanOrEqual(0);
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe(messages.settings.about);
    const controls = [...document.querySelectorAll<HTMLElement>('#settings button, #settings input, #settings select, #settings textarea')];
    expect(controls.indexOf(button)).toBeGreaterThan(controls.indexOf(document.getElementById('calibrate')!));
    expect(about().hidden).toBe(true);
    button.click();
    expect(about().hidden).toBe(false);
    expect(document.activeElement).toBe(document.getElementById('about-back'));
  });

  it('shows a non-empty version first, then the not-a-medical-device notice', () => {
    const text = about().textContent!;
    const version = document.getElementById('about-version')!.textContent!;
    expect(version).toBe(messages.aboutScreen.version(pkg.version));
    expect(pkg.version).not.toBe('');
    expect(document.getElementById('about-notice')!.textContent).toBe(messages.notMedicalDevice);
    expect(text.indexOf(version)).toBeLessThan(text.indexOf(messages.notMedicalDevice));
  });

  it('credits the Universal Core vocabulary, the Prediction word list and the Exclusion list in order', () => {
    const text = about().textContent!;
    const parts = [
      'Center for Literacy and Disability Studies',
      'CC BY 4.0',
      'FrequencyWords by Hermit Dave',
      'OpenSubtitles 2018 via OPUS',
      'CC BY-SA 4.0',
      'trimmed, lower-cased and filtered',
      'stays CC BY-SA 4.0',
      'Board code is MIT',
      'copyright 2012-2020 Shutterstock, Inc.',
      'normalised to single lower-case words',
    ];
    let at = -1;
    for (const p of parts) {
      const i = text.indexOf(p, at);
      expect(i, p).toBeGreaterThan(-1);
      at = i;
    }
  });

  it('links to every source and licence', () => {
    expect(hrefs()).toEqual([
      'https://www.med.unc.edu/healthsciences/clds/universal-core-vocabulary/',
      'https://creativecommons.org/licenses/by/4.0/',
      'https://github.com/hermitdave/FrequencyWords',
      'https://creativecommons.org/licenses/by-sa/4.0/',
      'https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words',
      'https://creativecommons.org/licenses/by/4.0/',
    ]);
    for (const a of about().querySelectorAll('a')) expect(a.rel).toContain('noopener');
  });
});
