/**
 * seance-settings-dom.ts: the Settings dialog (Requirement 8). Dwell time, "Start camera when the page
 * opens", Calibrate (its button and message are handled by the shared input controls) and About.
 * While the dialog is open no `select` has any effect, and a `select` stamped at or before its last
 * close is ignored too (the skeleton's settings gate). Escape and Close close it and return focus.
 */
import type { Planchette } from '@planchette/skeleton';
import { createSettingsGate } from '@planchette/skeleton/ui';
import packageJson from '../package.json';
import { messages } from './messages.js';
export type SettingsHost = Pick<Planchette, 'getProfile' | 'setProfile'>;
export interface SeanceSettings {
  /** True for a `select` that must be ignored: the dialog is open, or the select was stamped before it closed. */
  isBlocked(selectNow: number): boolean;
  destroy(): void;
}
export interface SeanceSettingsOptions {
  readonly host: SettingsHost;
  readonly document: Document;
  /** Called after a Settings change that belongs in the saved Profile. */
  readonly saveProfile: () => void;
}
const DWELL_MIN = 400;
const DWELL_MAX = 3000;
const DWELL_STEP = 50;
function need<T extends HTMLElement>(doc: Document, id: string): T {
  const el = doc.getElementById(id);
  if (el === null) throw new Error(`seance: #${id} is missing from seance/index.html`);
  return el as T;
}
export function mountSeanceSettings({ host, document: doc, saveProfile }: SeanceSettingsOptions): SeanceSettings {
  const dialog = need<HTMLDialogElement>(doc, 'settings');
  const button = need(doc, 'settings-button');
  const dwellInput = need<HTMLInputElement>(doc, 'dwell-input');
  const cameraOnLoad = need<HTMLInputElement>(doc, 'camera-on-load');
  const main = need(doc, 'settings-main');
  const about = need(doc, 'about');
  const aboutBody = need(doc, 'about-body');
  const aboutButton = need<HTMLButtonElement>(doc, 'about-button');
  const backButton = need<HTMLButtonElement>(doc, 'about-back');
  const closeButton = need<HTMLButtonElement>(doc, 'settings-close');
  const gate = createSettingsGate(doc);
  let open = false;
  const cleanups: Array<() => void> = [];
  const on = <E extends Event>(el: EventTarget, type: string, fn: (e: E) => void): void => {
    el.addEventListener(type, fn as EventListener);
    cleanups.push(() => el.removeEventListener(type, fn as EventListener));
  };
  const refresh = (): void => {
    const p = host.getProfile();
    dwellInput.value = String(p.dwellTime);
    cameraOnLoad.checked = p.startCameraOnLoad;
  };
  aboutBody.replaceChildren(
    ...messages.settings.aboutBody.map((t) => {
      const p = doc.createElement('p');
      p.textContent = t;
      return p;
    }),
    (() => {
      const p = doc.createElement('p');
      p.id = 'about-version';
      p.textContent = messages.settings.version(packageJson.version);
      return p;
    })(),
    (() => {
      const p = doc.createElement('p');
      p.id = 'about-notice';
      p.textContent = messages.notice;
      return p;
    })(),
  );
  on(button, 'click', () => {
    if (dialog.open) return;
    refresh();
    open = true;
    dialog.showModal();
  });
  on(dialog, 'close', () => {
    open = false;
    main.hidden = false;
    about.hidden = true;
    button.focus();
  });
  on(dwellInput, 'change', () => {
    const typed = Number(dwellInput.value);
    if (!Number.isFinite(typed)) return refresh();
    const dwell = Math.min(DWELL_MAX, Math.max(DWELL_MIN, Math.round(typed / DWELL_STEP) * DWELL_STEP));
    host.setProfile({ dwellTime: dwell });
    saveProfile();
    refresh();
  });
  on(cameraOnLoad, 'change', () => {
    host.setProfile({ startCameraOnLoad: cameraOnLoad.checked });
    saveProfile();
  });
  const showAbout = (shown: boolean): void => {
    main.hidden = shown;
    about.hidden = !shown;
    (shown ? backButton : aboutButton).focus();
  };
  on(aboutButton, 'click', () => showAbout(true));
  on(backButton, 'click', () => showAbout(false));
  on(closeButton, 'click', () => dialog.close());
  // A modal <dialog> makes the page inert, but Chromium still lets Tab leave the last control for the
  // browser's own UI, so the ends wrap by hand (the Board does the same).
  on<KeyboardEvent>(dialog, 'keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>('input, select, textarea, button, a[href]')].filter(
      (c) => !(c as HTMLInputElement).disabled && c.closest('[hidden]') === null,
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) return;
    const active = doc.activeElement;
    const inside = active !== null && active !== dialog && dialog.contains(active);
    if (e.shiftKey && (!inside || active === first)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (!inside || active === last)) {
      e.preventDefault();
      first.focus();
    }
  });
  refresh();
  return {
    isBlocked: (selectNow) => open || dialog.open || gate.isStale(selectNow),
    destroy() {
      for (const fn of cleanups.splice(0)) fn();
      gate.destroy();
    },
  };
}
