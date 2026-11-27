/**
 * board-settings-dom.ts — the contents of the Settings dialog (design.md "Settings UI" and
 * "About screen"). The dialog element, the Settings button, the Calibrate button and the
 * dialog's open/close behaviour (focus return, ignoring selects while open) live in
 * board/index.html, board-dom.ts and board-controls.ts. This module fills the dialog:
 *
 *  - Board-only settings: voice, speech rate, number of suggestions, the offensive-word filter.
 *    Each is saved at once through `app.updateBoardSettings`.
 *  - Profile fields: one labelled control per skeleton Profile field (except `mode`, which is the
 *    Controls row's selector), with the allowed range from the input-core "Profile fields" table
 *    as help text. A change goes through `host.setProfile`, so the skeleton clamps it; the
 *    controls then show what the skeleton kept. The table here only carries labels and the
 *    min/max shown as help; it makes no decisions about ranges.
 *  - Export / Import, like the skeleton demo's profile box (a text box, no `blob:` URLs).
 *  - The Quick-phrases editor, with Move up / Move down for keyboard reordering.
 *  - The About section (`#about`), swapped in for the settings by the About button.
 *
 * All text comes from messages.ts. Nothing here is a `Planchette` target.
 */
import type { Planchette, Profile } from '@planchette/skeleton';
import packageJson from '../package.json';
import { BOARD_DEFAULT_DWELL_TIME, exportBoardSettings, importBoardSettings, SLOT_COUNT_MAX, SLOT_COUNT_MIN, SPEECH_RATE_MAX, SPEECH_RATE_MIN } from './board-settings.js';
import { QUICK_PHRASE_MAX_CHARS } from './board-storage.js';
import type { BoardApp } from './main.js';
import { messages } from './messages.js';

export type SettingsHost = Pick<Planchette, 'getProfile' | 'setProfile' | 'exportProfile' | 'importProfile'>;
export type SettingsApp = Pick<BoardApp, 'getSettings' | 'updateBoardSettings' | 'quickPhrases'>;
export type SettingsSynth = Pick<SpeechSynthesis, 'getVoices' | 'addEventListener' | 'removeEventListener'>;

export interface BoardSettingsDomOptions {
  readonly host: SettingsHost;
  readonly app: SettingsApp;
  readonly document: Document;
  /** Saves the Profile (`startBoard` passes the same function the Controls row uses). */
  readonly saveProfile: () => void;
  /** Re-reads the layout and every target rectangle (target size and spacing change it). */
  readonly syncTargets: () => void;
  /** `speechSynthesis`, or null when the browser has none. */
  readonly synth: SettingsSynth | null;
}

export interface BoardSettingsDom {
  destroy(): void;
}

type Group = keyof typeof messages.settings.groups;
type Kind = 'number' | 'select' | 'checkbox' | 'text';
interface FieldSpec {
  readonly key: Exclude<keyof Profile, 'mode'>;
  readonly group: Group;
  readonly kind: Kind;
  readonly unit: string;
  /** Default shown in the help text; 'calibration' means the value comes from calibration. */
  readonly def: number | string | 'calibration';
  /** Range from the input-core Profile fields table. */
  readonly min?: number;
  readonly max?: number;
  /** Set when the maximum depends on another field; it is not put on the input. */
  readonly maxNote?: keyof Pick<typeof messages.settings, 'deadZoneNote' | 'acceptanceNote' | 'releaseNote'>;
  readonly step?: string;
  readonly integer?: boolean;
}

/** The Profile fields table of input-core (min, max, default), minus `mode`. */
const FIELDS: readonly FieldSpec[] = [
  { key: 'startCameraOnLoad', group: 'camera', kind: 'checkbox', unit: '', def: 'off' },
  { key: 'headGain', group: 'pointing', kind: 'number', unit: '', def: 1, min: 1, max: 2, step: '0.1' },
  { key: 'headDeadZone', group: 'pointing', kind: 'number', unit: 'degrees', def: 0.5, min: 0, maxNote: 'deadZoneNote', step: '0.1' },
  { key: 'smoothingStrength', group: 'pointing', kind: 'number', unit: '', def: 0.5, min: 0, max: 1, step: '0.05' },
  { key: 'dwellTime', group: 'timing', kind: 'number', unit: 'ms', def: BOARD_DEFAULT_DWELL_TIME, min: 400, max: 3000, step: '50' },
  { key: 'graceTime', group: 'timing', kind: 'number', unit: 'ms', def: 150, min: 0, max: 500, step: '10' },
  { key: 'postSelectionPause', group: 'timing', kind: 'number', unit: 'ms', def: 500, min: 200, max: 3000, step: '50' },
  { key: 'autoRepeatInterval', group: 'timing', kind: 'number', unit: 'ms', def: 1000, min: 500, max: 3000, step: '50' },
  { key: 'cancelByHold', group: 'timing', kind: 'checkbox', unit: '', def: 'on' },
  { key: 'cancelHoldTime', group: 'timing', kind: 'number', unit: 'ms', def: 2000, min: 1000, max: 5000, step: '100' },
  { key: 'noFaceTimeout', group: 'timing', kind: 'number', unit: 'ms', def: 10000, min: 3000, max: 60000, step: '500' },
  { key: 'inputTimeout', group: 'timing', kind: 'number', unit: 'ms', def: 2000, min: 500, max: 10000, step: '100' },
  { key: 'scanInterval', group: 'scanning', kind: 'number', unit: 'ms', def: 1200, min: 500, max: 5000, step: '100' },
  { key: 'scanLoopsBeforePause', group: 'scanning', kind: 'number', unit: '', def: 3, min: 1, max: 10, step: '1', integer: true },
  { key: 'switchBinding', group: 'scanning', kind: 'text', unit: '', def: 'Space' },
  { key: 'switchAcceptanceTime', group: 'scanning', kind: 'number', unit: 'ms', def: 0, min: 0, maxNote: 'acceptanceNote', step: '50' },
  { key: 'switchGesture', group: 'gesture', kind: 'select', unit: '', def: 'jaw open' },
  { key: 'gestureAcceptanceTime', group: 'gesture', kind: 'number', unit: 'ms', def: 300, min: 100, maxNote: 'acceptanceNote', step: '50' },
  { key: 'gestureThreshold', group: 'gesture', kind: 'number', unit: '', def: 0.5, min: 0.1, max: 0.95, step: '0.05' },
  { key: 'gestureReleaseThreshold', group: 'gesture', kind: 'number', unit: '', def: 0.3, min: 0.05, maxNote: 'releaseNote', step: '0.05' },
  { key: 'calibrationRangeLeft', group: 'calibration', kind: 'number', unit: 'degrees', def: 'calibration', min: 3, max: 90, step: '1' },
  { key: 'calibrationRangeRight', group: 'calibration', kind: 'number', unit: 'degrees', def: 'calibration', min: 3, max: 90, step: '1' },
  { key: 'calibrationRangeUp', group: 'calibration', kind: 'number', unit: 'degrees', def: 'calibration', min: 3, max: 90, step: '1' },
  { key: 'calibrationRangeDown', group: 'calibration', kind: 'number', unit: 'degrees', def: 'calibration', min: 3, max: 90, step: '1' },
  { key: 'calibrationStillnessThreshold', group: 'calibration', kind: 'number', unit: 'degrees', def: 2, min: 0.5, max: 6, step: '0.5' },
  { key: 'calibrationStillnessTime', group: 'calibration', kind: 'number', unit: 'ms', def: 1500, min: 500, max: 4000, step: '100' },
  { key: 'calibrationStepTimeout', group: 'calibration', kind: 'number', unit: 'ms', def: 6000, min: 3000, max: 20000, step: '500' },
  { key: 'targetSize', group: 'layout', kind: 'number', unit: 'CSS px', def: 96, min: 64, max: 400, step: '1' },
  { key: 'targetSpacing', group: 'layout', kind: 'number', unit: 'CSS px', def: 16, min: 8, max: 64, step: '1' },
];

const GROUP_ORDER: readonly Group[] = ['camera', 'pointing', 'timing', 'scanning', 'gesture', 'calibration', 'layout'];

function labelOf(spec: FieldSpec): string {
  return spec.key === 'startCameraOnLoad' ? messages.settings.startCameraOnLoad : messages.settings.fields[spec.key];
}

function helpOf(spec: FieldSpec): string {
  const s = messages.settings;
  if (spec.key === 'startCameraOnLoad') return s.startCameraOnLoadHelp;
  if (spec.kind === 'checkbox') return s.defaultIs(String(spec.def));
  if (spec.key === 'switchBinding') return s.switchBindingHelp;
  if (spec.kind === 'select') return '';
  if (spec.def === 'calibration') return `${s.rangeOnly(spec.min!, spec.max!, spec.unit)} ${s.fromCalibration}`;
  if (spec.maxNote !== undefined) return s.rangeMinOnly(spec.min!, s[spec.maxNote], spec.unit, spec.def);
  return s.range(spec.min!, spec.max!, spec.unit, spec.def);
}

export function mountBoardSettings({ host, app, document: doc, saveProfile, syncTargets, synth }: BoardSettingsDomOptions): BoardSettingsDom {
  const sections = doc.getElementById('settings-sections');
  const dialog = doc.getElementById('settings') as HTMLDialogElement | null;
  if (sections === null || dialog === null) throw new Error('board: the Settings dialog is missing from board/index.html');
  const cleanups: Array<() => void> = [];
  const on = <E extends Event>(el: EventTarget, type: string, fn: (e: E) => void): void => {
    el.addEventListener(type, fn as EventListener);
    cleanups.push(() => el.removeEventListener(type, fn as EventListener));
  };
  let counter = 0;
  const uid = (prefix: string): string => `${prefix}-${(counter += 1)}`;

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag);
    Object.assign(e, props);
    e.append(...children);
    return e;
  };
  const group = (title: string): { root: HTMLElement; body: HTMLElement } => {
    const root = el('section', { className: 'settings-group' });
    const id = uid('settings-group');
    root.setAttribute('aria-labelledby', id);
    root.append(el('h3', { id }, title));
    sections.append(root);
    return { root, body: root };
  };
  /** A labelled field row: the control, its label and its help text (linked by aria-describedby). */
  const row = (parent: HTMLElement, label: string, control: HTMLElement, help: string, checkboxFirst = false): HTMLElement => {
    const wrap = el('div', { className: 'settings-row' });
    const id = uid('settings-control');
    control.id = id;
    const lab = el('label', { htmlFor: id }, label);
    if (help !== '') {
      const h = el('p', { id: `${id}-help`, className: 'help' }, help);
      control.setAttribute('aria-describedby', h.id);
      wrap.append(...(checkboxFirst ? [control, lab, h] : [lab, control, h]));
    } else wrap.append(...(checkboxFirst ? [control, lab] : [lab, control]));
    parent.append(wrap);
    return wrap;
  };

  // ---- Speech: voice and rate -----------------------------------------------------------
  const speech = group(messages.settings.groups.voice);
  const voiceSelect = el('select');
  const voiceStatus = el('p', { id: uid('voice-status'), className: 'help' });
  voiceStatus.setAttribute('role', 'status');
  row(speech.body, messages.settings.voice, voiceSelect, '');
  speech.body.append(voiceStatus);
  const renderVoices = (): void => {
    const local = (synth?.getVoices() ?? []).filter((v) => v.localService === true);
    voiceSelect.replaceChildren();
    if (local.length === 0) {
      voiceSelect.add(new Option(messages.settings.noLocalVoices, ''));
      voiceSelect.disabled = true;
      voiceStatus.textContent = messages.settings.noLocalVoices;
      return;
    }
    voiceSelect.disabled = false;
    voiceStatus.textContent = '';
    voiceSelect.add(new Option(messages.settings.defaultVoice, ''));
    for (const v of local) voiceSelect.add(new Option(v.name, v.voiceURI));
    const saved = app.getSettings().voiceURI;
    voiceSelect.value = local.some((v) => v.voiceURI === saved) ? saved : '';
  };
  on(voiceSelect, 'change', () => app.updateBoardSettings({ voiceURI: voiceSelect.value }));
  if (synth !== null) {
    synth.addEventListener('voiceschanged', renderVoices);
    cleanups.push(() => synth.removeEventListener('voiceschanged', renderVoices));
  }

  const rateInput = el('input', { type: 'range', min: String(SPEECH_RATE_MIN), max: String(SPEECH_RATE_MAX), step: '0.1' });
  const rateOut = el('output');
  const rateRow = row(speech.body, messages.settings.speechRate, rateInput, messages.settings.speechRateHelp);
  rateRow.insertBefore(rateOut, rateRow.querySelector('.help'));
  const showRate = (): void => {
    rateOut.textContent = Number(rateInput.value).toFixed(1);
  };
  on(rateInput, 'input', showRate);
  on(rateInput, 'change', () => {
    const v = Number(rateInput.value);
    if (Number.isFinite(v)) app.updateBoardSettings({ speechRate: Math.min(SPEECH_RATE_MAX, Math.max(SPEECH_RATE_MIN, v)) });
    showRate();
  });

  // ---- Suggestions: count and the offensive-word filter -----------------------------------
  const suggestions = group(messages.settings.groups.suggestions);
  const slotInput = el('input', { type: 'number', min: String(SLOT_COUNT_MIN), max: String(SLOT_COUNT_MAX), step: '1' });
  row(suggestions.body, messages.settings.predictionSlotCount, slotInput, messages.settings.predictionSlotCountHelp);
  on(slotInput, 'change', () => {
    const v = Number(slotInput.value);
    if (slotInput.value.trim() !== '' && Number.isFinite(v)) {
      app.updateBoardSettings({ predictionSlotCount: Math.min(SLOT_COUNT_MAX, Math.max(SLOT_COUNT_MIN, Math.round(v))) });
    }
    slotInput.value = String(app.getSettings().predictionSlotCount);
  });
  const filterInput = el('input', { type: 'checkbox' });
  row(suggestions.body, messages.settings.filterOffensiveWords, filterInput, '', true);
  on(filterInput, 'change', () => app.updateBoardSettings({ filterOffensiveWords: filterInput.checked }));

  // ---- Profile fields ---------------------------------------------------------------------
  const profileControls = new Map<FieldSpec['key'], { spec: FieldSpec; input: HTMLInputElement | HTMLSelectElement }>();
  for (const g of GROUP_ORDER) {
    const { body } = group(messages.settings.groups[g]);
    for (const spec of FIELDS.filter((f) => f.group === g)) {
      let input: HTMLInputElement | HTMLSelectElement;
      if (spec.kind === 'checkbox') input = el('input', { type: 'checkbox' });
      else if (spec.kind === 'select') {
        input = el('select');
        for (const [value, text] of Object.entries(messages.settings.switchGestureOptions)) input.add(new Option(text, value));
      } else if (spec.kind === 'text') input = el('input', { type: 'text' });
      else {
        input = el('input', { type: 'number', step: spec.step ?? 'any' });
        if (spec.min !== undefined) input.min = String(spec.min);
        if (spec.max !== undefined) input.max = String(spec.max);
      }
      const help = helpOf(spec);
      row(body, labelOf(spec), input, help, spec.kind === 'checkbox');
      profileControls.set(spec.key, { spec, input });
      on(input, 'change', () => applyProfileField(spec, input));
    }
  }
  function applyProfileField(spec: FieldSpec, input: HTMLInputElement | HTMLSelectElement): void {
    let value: unknown;
    if (spec.kind === 'checkbox') value = (input as HTMLInputElement).checked;
    else if (spec.kind === 'number') {
      const n = Number(input.value);
      value = input.value.trim() === '' || !Number.isFinite(n) ? undefined : spec.integer === true ? Math.round(n) : n;
    } else value = input.value;
    if (value !== undefined && value !== '') {
      host.setProfile({ [spec.key]: value } as Partial<Profile>);
      saveProfile();
      if (spec.key === 'targetSize' || spec.key === 'targetSpacing') syncTargets();
    }
    refreshProfile(); // shows what the skeleton kept (it clamps), and restores a rejected entry
  }
  function refreshProfile(): void {
    const profile = host.getProfile() as Partial<Profile>;
    for (const { spec, input } of profileControls.values()) {
      const v = profile[spec.key];
      if (spec.kind === 'checkbox') (input as HTMLInputElement).checked = v === true;
      else if (v !== undefined) input.value = String(v);
    }
  }

  // ---- Export and import ----------------------------------------------------------------
  const transfer = group(messages.settings.groups.transfer);
  const box = el('textarea', { rows: 6 });
  row(transfer.body, messages.settings.transfer.box, box, '');
  const exportButton = el('button', { type: 'button' }, messages.settings.transfer.export);
  const importButton = el('button', { type: 'button' }, messages.settings.transfer.import);
  const report = el('p', { id: 'settings-import-report' });
  report.setAttribute('role', 'status');
  transfer.body.append(el('div', { className: 'settings-buttons' }, exportButton, importButton), report);
  on(exportButton, 'click', () => {
    box.value = exportBoardSettings(host, app.getSettings());
    report.textContent = messages.settings.transfer.exported;
  });
  on(importButton, 'click', () => {
    const { value, changes } = importBoardSettings(host, box.value);
    app.updateBoardSettings(value.board);
    saveProfile();
    syncTargets();
    refreshAll();
    report.textContent = changes.length === 0 ? messages.settings.transfer.imported : messages.settings.transfer.importedWithChanges(changes.join('; '));
  });

  // ---- Quick-phrases editor ---------------------------------------------------------------
  const phrases = group(messages.settings.editQuickPhrases);
  const list = el('ul', { className: 'phrase-list' });
  const full = el('p', { id: 'quick-phrases-status' });
  full.setAttribute('role', 'status');
  const newInput = el('input', { type: 'text', maxLength: QUICK_PHRASE_MAX_CHARS });
  const addButton = el('button', { type: 'button' }, messages.settings.phrases.add);
  phrases.body.append(list);
  const addRow = row(phrases.body, messages.settings.phrases.newPhrase, newInput, '');
  addRow.append(addButton);
  phrases.body.append(full);
  const store = app.quickPhrases;
  type Focus = { id: string; part: 'input' | 'up' | 'down' | 'remove' } | 'new' | null;
  const renderPhrases = (focus: Focus = null): void => {
    list.replaceChildren();
    const items = store.phrases;
    items.forEach((p, i) => {
      const n = i + 1;
      const input = el('input', { type: 'text', value: p.text, maxLength: QUICK_PHRASE_MAX_CHARS });
      input.setAttribute('aria-label', messages.settings.phrases.phraseLabel(n));
      input.dataset.part = 'input';
      const button = (part: 'up' | 'down' | 'remove', text: string, disabled: boolean): HTMLButtonElement => {
        const b = el('button', { type: 'button', disabled }, text);
        b.setAttribute('aria-label', messages.settings.phrases.actionLabel(text, p.text));
        b.dataset.part = part;
        return b;
      };
      const li = el('li', {}, input, button('up', messages.settings.phrases.moveUp, i === 0), button('down', messages.settings.phrases.moveDown, i === items.length - 1), button('remove', messages.settings.phrases.remove, false));
      li.dataset.phraseId = p.id;
      list.append(li);
    });
    if (focus === 'new') newInput.focus();
    else if (focus !== null) {
      const li = [...list.children].find((c) => (c as HTMLElement).dataset.phraseId === focus.id);
      const target = li?.querySelector<HTMLElement>(`[data-part="${focus.part}"]:not(:disabled)`) ?? li?.querySelector<HTMLElement>('[data-part="input"]');
      target?.focus();
    }
  };
  on<Event>(list, 'change', (e) => {
    const input = e.target as HTMLElement;
    const id = input.closest<HTMLElement>('li')?.dataset.phraseId;
    if (id === undefined || input.dataset.part !== 'input') return;
    const text = (input as HTMLInputElement).value;
    if (text.trim() !== '') {
      store.update(id, text);
      // The list is not redrawn while focus is in it; keep the buttons' names in step with the text.
      for (const b of input.closest('li')?.querySelectorAll<HTMLButtonElement>('button[data-part]') ?? []) {
        const label = { up: messages.settings.phrases.moveUp, down: messages.settings.phrases.moveDown, remove: messages.settings.phrases.remove }[b.dataset.part as 'up' | 'down' | 'remove'];
        b.setAttribute('aria-label', messages.settings.phrases.actionLabel(label, text));
      }
    } else renderPhrases(); // an empty phrase is not kept: show the saved text again
  });
  on<Event>(list, 'click', (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-part]');
    const li = button?.closest<HTMLElement>('li');
    const id = li?.dataset.phraseId;
    if (button === null || button === undefined || id === undefined) return;
    full.textContent = '';
    const ids = store.phrases.map((p) => p.id);
    const i = ids.indexOf(id);
    const part = button.dataset.part as 'up' | 'down' | 'remove';
    if (part === 'remove') {
      const next = ids[i + 1] ?? ids[i - 1];
      store.remove(id);
      renderPhrases(next === undefined ? 'new' : { id: next, part: 'remove' });
      return;
    }
    const j = part === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    store.reorder(ids);
    renderPhrases({ id, part });
  });
  on(addButton, 'click', () => {
    const text = newInput.value.trim();
    if (text === '') return;
    const result = store.add(text);
    if (!result.added) {
      full.textContent = messages.quickPhrases.full;
      return;
    }
    full.textContent = '';
    newInput.value = '';
    renderPhrases('new');
  });
  // Edits made elsewhere (and the add above) redraw the list; focus is restored by the callers above.
  const unsubscribe = store.subscribe(() => {
    if (!list.contains(doc.activeElement)) renderPhrases();
  });
  cleanups.push(unsubscribe);

  // ---- About ------------------------------------------------------------------------------
  const settingsMain = doc.getElementById('settings-main');
  const about = doc.getElementById('about');
  const aboutBody = doc.getElementById('about-body');
  const aboutButton = doc.getElementById('about-button');
  const backButton = doc.getElementById('about-back');
  const closeButton = doc.getElementById('settings-close');
  if (aboutBody !== null) {
    const link = (url: string): HTMLAnchorElement => el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, url);
    const credit = (c: { credit: string; sourceUrl: string; licenseUrl: string }): HTMLElement =>
      el('p', {}, c.credit, ' ', link(c.sourceUrl), ' ', link(c.licenseUrl));
    aboutBody.replaceChildren(
      el('p', { id: 'about-version' }, messages.aboutScreen.version(packageJson.version)),
      el('p', { id: 'about-notice' }, messages.notMedicalDevice),
      credit(messages.about.coreVocabulary),
      credit(messages.about.predictionWordList),
      credit(messages.about.exclusionList),
    );
  }
  const showAbout = (shown: boolean): void => {
    if (settingsMain === null || about === null) return;
    settingsMain.hidden = shown;
    about.hidden = !shown;
    (shown ? backButton : aboutButton)?.focus();
  };
  if (aboutButton !== null) on(aboutButton, 'click', () => showAbout(true));
  if (backButton !== null) on(backButton, 'click', () => showAbout(false));
  if (closeButton !== null) on(closeButton, 'click', () => dialog.close());
  // Keeps Tab and Shift+Tab inside the dialog. A modal <dialog> makes the page inert, but Chromium
  // still lets Tab leave the last control for the browser's own UI (found by the Playwright test),
  // so the ends wrap by hand (Req 6 AC 11).
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
  // Reopening shows the settings, not the About screen.
  on(dialog, 'close', () => {
    if (settingsMain !== null) settingsMain.hidden = false;
    if (about !== null) about.hidden = true;
  });

  function refreshAll(): void {
    const b = app.getSettings();
    renderVoices();
    rateInput.value = String(b.speechRate);
    showRate();
    slotInput.value = String(b.predictionSlotCount);
    filterInput.checked = b.filterOffensiveWords;
    refreshProfile();
    renderPhrases();
  }
  refreshAll();
  // Opening the dialog shows the current values (the Profile can change under it, by calibration).
  on(doc.getElementById('settings-button') ?? dialog, 'click', refreshAll);

  return {
    destroy() {
      for (const fn of cleanups.splice(0)) fn();
    },
  };
}
