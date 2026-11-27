/**
 * board-dom.ts — the only module of the Board that touches the DOM and the only caller of
 * `registerTarget` / `updateTarget` (design.md, Architecture). It uses the skeleton's public
 * API only.
 *
 * The page (board/index.html) holds the static markup: the Message bar and the action row.
 * Every element with `data-planchette-target` is registered as a target, with its
 * `data-role` as the role (the same convention as the skeleton demo). `select` events are
 * routed to the Board's model or app by target id. Targets with no entry in `ACTIONS`
 * (Cancel, the rest area) are registered but need no Board code: the skeleton itself
 * cancels, and nothing is selectable in the rest area.
 *
 * The Core grid (`core-<id>` buttons, Req 2) is built here from `CORE_VOCABULARY` into
 * `#core-grid`. Each button carries its entry's `data-row` / `data-col`, and board.css
 * places it from those, never from DOM order. `--target-size` / `--target-gap` follow the
 * profile's `targetSize` / `targetSpacing`. The grid is registered and unregistered as one
 * unit (`setCoreGridActive`). The Letter board (`letter-<a-z>`, `space`, `backspace`, Req 3)
 * is built the same way into `#letter-grid`, placed by `data-row` / `data-col` (cells (4,4)
 * and (4,5) have no element). Spell mode swaps the two grids: the active one is shown and
 * registered, the other hidden and unregistered, so only one grid is ever registered. A
 * grid is shown before it is registered, because a hidden element has a zero rectangle.
 * The Settings button opens the Settings dialog; while it is open every `select` is ignored
 * (`settingsOpen`). Every visible
 * string comes from messages.ts: elements with `data-text="<path>"` are filled from it.
 */
import type { Planchette, Rect, TargetRole } from '@planchette/skeleton';
import { CORE_VOCABULARY } from './core-vocabulary.js';
import { LETTER_BOARD } from './letter-board.js';
import type { BoardApp } from './main.js';
import { messages } from './messages.js';
import type { SlotLock } from './prediction.js';
import { createSettingsGate } from './settings-gate.js';

/** The part of `Planchette` the Board's DOM layer uses. A test host implements only this. */
export type BoardHost = Pick<Planchette, 'registerTarget' | 'updateTarget' | 'unregisterTarget' | 'setScreen' | 'getProfile' | 'addEventListener' | 'removeEventListener'>;

/** The part of `BoardApp` the DOM layer uses. */
export type BoardDomApp = Pick<BoardApp, 'speakMessage'> &
  // The Prediction strip is wired only when the app has one (the grid tests' fake apps do not).
  Partial<Pick<BoardApp, 'strip' | 'setSlotLock' | 'quickPhrases'>> & {
  readonly model: Pick<BoardApp['model'], 'message' | 'partialWord' | 'dispatch' | 'undo' | 'subscribe'>;
};

export interface BoardDom {
  /** Re-reads every target's rectangle and passes the screen size on to the host. */
  syncTargets(): void;
  /** Removes the listeners added by `mountBoardDom`. */
  destroy(): void;
}

export interface BoardDomOptions {
  readonly host: BoardHost;
  readonly app: BoardDomApp;
  readonly document: Document;
}

type View = 'core' | 'spell' | 'phrases';
/** Phrases on one page of the Phrases view: 2 columns x 5 rows, row-major. */
const PHRASES_PER_PAGE = 10;
const PHRASES_NAV_ROW = 5;

const ROLES: ReadonlySet<string> = new Set<TargetRole>(['default', 'cancel', 'undo', 'rest-area']);

function rectOf(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

/** Looks up a dot-separated path in `messages`, e.g. `actions.speak`. */
function messageAt(path: string): string {
  let node: unknown = messages;
  for (const key of path.split('.')) node = (node as Record<string, unknown> | undefined)?.[key];
  if (typeof node !== 'string') throw new Error(`board: no message "${path}" in messages.ts`);
  return node;
}

function byId(doc: Document, id: string): HTMLElement {
  const el = doc.getElementById(id);
  if (el === null) throw new Error(`board: #${id} is missing from board/index.html`);
  return el;
}

export function mountBoardDom({ host, app, document: doc }: BoardDomOptions): BoardDom {
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[data-text]'))) {
    el.textContent = messageAt(el.dataset.text!);
  }
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[data-aria-label]'))) {
    el.setAttribute('aria-label', messageAt(el.dataset.ariaLabel!));
  }
  doc.title = messages.page.title;
  const messageBar = byId(doc, 'message-bar');
  const predictionStrip = byId(doc, 'prediction-strip');
  const coreGrid = byId(doc, 'core-grid');
  const letterGrid = byId(doc, 'letter-grid');
  const phrasesGrid = byId(doc, 'phrases-grid');
  const phrasesPageLive = byId(doc, 'phrases-page');

  // The Core grid: built once, in CORE_VOCABULARY order, placed by data-row / data-col.
  const buildGrid = (grid: HTMLElement, entries: ReadonlyArray<{ id: string; label: string; row: number; col: number }>, idOf: (id: string) => string): HTMLElement[] =>
    entries.map((b) => {
      const el = doc.createElement('button');
      el.type = 'button';
      el.className = 'target';
      el.dataset.planchetteTarget = idOf(b.id);
      el.dataset.row = String(b.row);
      el.dataset.col = String(b.col);
      el.textContent = b.label;
      grid.appendChild(el);
      return el;
    });
  const coreElements = buildGrid(coreGrid, CORE_VOCABULARY, (id) => `core-${id}`);
  const letterElements = buildGrid(letterGrid, LETTER_BOARD, (id) => id);
  // The Phrases view: 10 fixed phrase cells (row-major, 2 columns) and Previous / Next at row 5.
  // The elements are built once; which of them is a target changes with the page and the list.
  const quickPhrases = app.quickPhrases;
  const makeCell = (row: number, col: number, className: string): HTMLElement => {
    const el = doc.createElement('button');
    el.type = 'button';
    el.className = className;
    el.dataset.row = String(row);
    el.dataset.col = String(col);
    phrasesGrid.appendChild(el);
    return el;
  };
  const phraseElements = Array.from({ length: PHRASES_PER_PAGE }, (_, i) => makeCell(Math.floor(i / 2), i % 2, 'target phrase'));
  const prevElement = makeCell(PHRASES_NAV_ROW, 0, 'target');
  const nextElement = makeCell(PHRASES_NAV_ROW, 1, 'target');
  prevElement.dataset.planchetteTarget = 'phrases-prev';
  nextElement.dataset.planchetteTarget = 'phrases-next';
  prevElement.textContent = messages.phrases.previous;
  nextElement.textContent = messages.phrases.next;
  const phrasesElements = [...phraseElements, prevElement, nextElement];
  // The Prediction strip: fixed-position slot buttons inside the reserved #prediction-strip.
  // A slot is a registered target only while it holds a word; an empty slot stays in place.
  const strip = app.strip;
  const slotElements: HTMLElement[] = (strip?.slots ?? []).map((s) => {
    const el = doc.createElement('button');
    el.type = 'button';
    el.className = 'target prediction-slot';
    el.dataset.planchetteTarget = `prediction-slot-${s.index}`;
    el.dataset.empty = 'true';
    el.setAttribute('aria-disabled', 'true');
    predictionStrip.appendChild(el);
    return el;
  });
  // Spell mode: the Letter board replaces the Core grid; it also decides what Backspace
  // removes (a word, or in Spell mode a character).
  let currentView: View = 'core';
  let spellMode = false;
  let phrasesPage = 0;
  /** The text each shown phrase target selects, by target id. Rebuilt with the page. */
  const phraseTexts = new Map<string, string>();
  const spellToggle = doc.querySelector<HTMLElement>('[data-planchette-target="spell-toggle"]');
  const phrasesToggle = doc.querySelector<HTMLElement>('[data-planchette-target="phrases-toggle"]');

  // The slot-lock rule (design.md "prediction.ts"): a slot is locked while the pointer is on
  // it, while it is highlighted by the scan, or while a press on it is still being applied.
  let pointer: { x: number; y: number } | null = null;
  let dwellTargetId: string | null = null;
  let highlighted: readonly string[] = [];
  let pressPending = false;
  let clearHandle: number | null = null;
  const slotId = (i: number): string => `prediction-slot-${i}`;
  const isLocked: SlotLock = (i) => {
    if (pressPending) return true;
    const id = slotId(i);
    if (dwellTargetId === id || highlighted.includes(id)) return true;
    const r = lastRects.get(id);
    return pointer !== null && r !== undefined && pointer.x >= r.x && pointer.x < r.x + r.width && pointer.y >= r.y && pointer.y < r.y + r.height;
  };
  const schedulePendingClear = (): void => {
    if (clearHandle !== null) return;
    const done = (): void => {
      clearHandle = null;
      pressPending = false;
      strip?.recompute(app.model.message, app.model.partialWord, isLocked); // catch up
    };
    const raf = doc.defaultView?.requestAnimationFrame;
    clearHandle = raf !== undefined ? doc.defaultView!.requestAnimationFrame(done) : (setTimeout(done, 16) as unknown as number);
  };

  /** One Board call per action target id. */
  const ACTIONS = new Map<string, () => void>([
    [
      'speak',
      () => {
        // Requirement 1 AC 5: nothing is spoken for an empty Message.
        if (app.model.message === '') return;
        void app.speakMessage();
      },
    ],
    ...CORE_VOCABULARY.map((b): [string, () => void] => [
      `core-${b.id}`,
      () => app.model.dispatch({ type: 'add-word', text: b.label }, spellMode),
    ]),
    ...LETTER_BOARD.map((k): [string, () => void] => [
      k.id,
      k.id === 'space'
        ? () => app.model.dispatch({ type: 'add-space' }, spellMode)
        : k.id === 'backspace'
          ? () => app.model.dispatch({ type: 'backspace' }, spellMode)
          : () => app.model.dispatch({ type: 'add-letter', char: k.label }, spellMode),
    ]),
    ...slotElements.map((_, i): [string, () => void] => [
      `prediction-slot-${i}`,
      () => {
        const word = strip?.slots[i]?.word;
        if (word === null || word === undefined) return;
        pressPending = true; // keeps slots still until the DOM has been updated (Req 4 AC 5)
        schedulePendingClear();
        app.model.dispatch({ type: 'complete-word', text: word }, spellMode);
      },
    ]),
    ['backspace-action', () => app.model.dispatch({ type: 'backspace' }, spellMode)],
    ['clear', () => app.model.dispatch({ type: 'clear' }, spellMode)],
    ['undo', () => app.model.undo()],
    ['spell-toggle', () => setView(currentView === 'spell' ? 'core' : 'spell')],
    ['phrases-toggle', () => setView(currentView === 'phrases' ? 'core' : 'phrases')],
    [
      'phrases-prev',
      () => {
        if (phrasesPage <= 0) return;
        phrasesPage -= 1;
        renderPhrases();
      },
    ],
    [
      'phrases-next',
      () => {
        if (phrasesPage >= phrasesPageCount() - 1) return;
        phrasesPage += 1;
        renderPhrases();
      },
    ],
  ]);

  const showMessage = (message: string): void => {
    messageBar.textContent = message;
    messageBar.scrollTop = messageBar.scrollHeight; // a long Message shows its end
  };
  showMessage(app.model.message);
  const unsubscribe = app.model.subscribe(showMessage);

  /** Ids currently registered with the host; only these are updated on a resize. */
  const registered = new Map<string, HTMLElement>();
  /** The rectangle each registered target was last given; the slot lock hit-tests against it. */
  const lastRects = new Map<string, Rect>();
  const registerEl = (el: HTMLElement): void => {
    const id = el.dataset.planchetteTarget!;
    const role = el.dataset.role;
    const options = role !== undefined && ROLES.has(role) ? { role: role as TargetRole } : undefined;
    const rect = rectOf(el);
    host.registerTarget(id, rect, options);
    registered.set(id, el);
    lastRects.set(id, rect);
  };
  const unregisterEl = (el: HTMLElement): void => {
    const id = el.dataset.planchetteTarget!;
    lastRects.delete(id);
    if (registered.delete(id)) host.unregisterTarget(id);
  };

  /** Shows a grid's section and registers its targets, or hides and unregisters them. */
  const setGridActive = (grid: HTMLElement, elements: HTMLElement[], active: boolean): void => {
    const section = grid.closest<HTMLElement>('section');
    if (!active) for (const el of elements) unregisterEl(el);
    grid.hidden = !active;
    if (section !== null) section.hidden = !active;
    if (active) for (const el of elements) registerEl(el);
  };
  const setCoreGridActive = (active: boolean): void => setGridActive(coreGrid, coreElements, active);
  const setLetterBoardActive = (active: boolean): void => setGridActive(letterGrid, letterElements, active);

  const phrasesPageCount = (): number => Math.max(1, Math.ceil((quickPhrases?.phrases.length ?? 0) / PHRASES_PER_PAGE));
  /**
   * Draws the shown page and registers its targets. Called only when the view becomes Phrases,
   * the page changes, or the store changes (Req 7 AC 12), never for a Message or prediction change.
   */
  function renderPhrases(): void {
    for (const el of phrasesElements) unregisterEl(el); // before the ids change
    phraseTexts.clear();
    const list = quickPhrases?.phrases ?? [];
    const count = phrasesPageCount();
    phraseElements.forEach((el, i) => {
      const phrase = list[phrasesPage * PHRASES_PER_PAGE + i];
      if (phrase === undefined) {
        el.textContent = '';
        el.dataset.empty = 'true';
        el.setAttribute('aria-disabled', 'true');
        delete el.dataset.planchetteTarget;
        return;
      }
      const id = `quick-phrase-${phrase.id}`;
      el.textContent = phrase.text; // the full text is the accessible name; CSS clamps what is drawn
      delete el.dataset.empty;
      el.removeAttribute('aria-disabled');
      el.dataset.planchetteTarget = id;
      phraseTexts.set(id, phrase.text);
    });
    const hasPrev = phrasesPage > 0;
    const hasNext = phrasesPage < count - 1;
    for (const [el, enabled] of [[prevElement, hasPrev], [nextElement, hasNext]] as const) {
      if (enabled) el.removeAttribute('aria-disabled');
      else el.setAttribute('aria-disabled', 'true');
    }
    phrasesPageLive.textContent = messages.phrases.pageOf(phrasesPage + 1, count);
    for (const el of phrasesElements) {
      if (el.dataset.planchetteTarget !== undefined && el.getAttribute('aria-disabled') !== 'true') registerEl(el);
    }
  }
  const setPhrasesActive = (active: boolean): void => {
    const section = phrasesGrid.closest<HTMLElement>('section');
    if (!active) {
      for (const el of phrasesElements) unregisterEl(el);
      phrasesPageLive.textContent = '';
    }
    phrasesGrid.hidden = !active;
    if (section !== null) section.hidden = !active;
    if (active) renderPhrases(); // the grid is shown first: a hidden element has a zero rectangle
  };
  /** Shows one view's grid and registers only its targets; the others are hidden and unregistered. */
  const applyView = (): void => {
    spellMode = currentView === 'spell';
    if (currentView !== 'core') setCoreGridActive(false);
    if (currentView !== 'spell') setLetterBoardActive(false);
    if (currentView !== 'phrases') setPhrasesActive(false);
    if (currentView === 'core') setCoreGridActive(true);
    if (currentView === 'spell') setLetterBoardActive(true);
    if (currentView === 'phrases') setPhrasesActive(true);
    spellToggle?.setAttribute('aria-pressed', String(currentView === 'spell'));
    phrasesToggle?.setAttribute('aria-pressed', String(currentView === 'phrases'));
  };
  /** Entering Phrases shows page 0. */
  function setView(next: View): void {
    currentView = next;
    if (next === 'phrases') phrasesPage = 0;
    applyView();
  }

  // The Settings dialog (design.md "Settings UI"). `settingsOpen` is set when the dialog opens
  // and cleared on `close` (Escape, the Close button or Calibrate); while it is set no `select`
  // has any effect, because the skeleton hit-tests rectangles and would otherwise act on
  // targets lying under the modal. `cancel` is not ignored.
  const settingsButton = doc.getElementById('settings-button');
  const settingsDialog = doc.getElementById('settings') as HTMLDialogElement | null;
  let settingsOpen = false;
  // A select for a press made while the dialog was open can arrive just after it closed (see settings-gate.ts).
  const gate = createSettingsGate(doc);
  const onSettingsClick = (): void => {
    if (settingsDialog === null || settingsDialog.open) return;
    settingsOpen = true;
    settingsDialog.showModal();
  };
  const onSettingsClose = (): void => {
    settingsOpen = false;
    settingsButton?.focus();
  };
  settingsButton?.addEventListener('click', onSettingsClick);
  settingsDialog?.addEventListener('close', onSettingsClose);

  const view = doc.defaultView;
  /** Sizes and spaces the grid from the profile (the skeleton demo's variable names). */
  const applyLayout = (): void => {
    const { targetSize, targetSpacing } = host.getProfile();
    doc.documentElement.style.setProperty('--target-size', `${targetSize}px`);
    doc.documentElement.style.setProperty('--target-gap', `${targetSpacing}px`);
  };
  applyLayout();

  for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[data-planchette-target]'))) {
    if (!coreElements.includes(el) && !letterElements.includes(el) && !slotElements.includes(el) && !phrasesElements.includes(el)) registerEl(el);
  }
  /** Shows each slot's word; only a slot with a word is a target. Positions never change. */
  const renderSlots = (slots: ReadonlyArray<{ index: number; word: string | null }>): void => {
    for (const s of slots) {
      const el = slotElements[s.index];
      if (el === undefined) continue;
      el.textContent = s.word ?? '';
      if (s.word === null) {
        el.dataset.empty = 'true';
        el.setAttribute('aria-disabled', 'true');
        unregisterEl(el);
      } else {
        delete el.dataset.empty;
        el.removeAttribute('aria-disabled');
        const id = slotId(s.index);
        if (registered.has(id)) {
          const rect = rectOf(el);
          host.updateTarget(id, rect);
          lastRects.set(id, rect);
        } else registerEl(el);
      }
    }
  };
  app.setSlotLock?.(isLocked);
  const unsubscribeStrip = strip?.subscribe(renderSlots);
  if (strip !== undefined) renderSlots(strip.slots);
  const onPointerMove = (e: CustomEvent<{ x: number; y: number }>): void => {
    pointer = { x: e.detail.x, y: e.detail.y };
  };
  const onDwellProgress = (e: CustomEvent<{ targetId: string; progress: number }>): void => {
    dwellTargetId = e.detail.progress > 0 ? e.detail.targetId : dwellTargetId === e.detail.targetId ? null : dwellTargetId;
  };
  const onHighlight = (e: CustomEvent<{ targetIds: string[] }>): void => {
    highlighted = e.detail.targetIds;
  };
  if (strip !== undefined) {
    host.addEventListener('pointer-move', onPointerMove);
    host.addEventListener('dwell-progress', onDwellProgress);
    host.addEventListener('highlight', onHighlight);
  }
  applyView();
  const unsubscribePhrases = quickPhrases?.subscribe(() => {
    phrasesPage = Math.min(phrasesPage, phrasesPageCount() - 1);
    if (currentView === 'phrases') renderPhrases();
  });

  /** Re-reads the profile's layout and every registered target's rectangle. */
  const syncTargets = (): void => {
    applyLayout();
    if (view !== null) host.setScreen({ width: view.innerWidth, height: view.innerHeight });
    for (const [id, el] of registered) {
      const rect = rectOf(el);
      host.updateTarget(id, rect);
      lastRects.set(id, rect);
    }
  };
  view?.addEventListener('resize', syncTargets);
  view?.addEventListener('scroll', syncTargets, { passive: true });

  // A mode change reloads the profile's layout (the skeleton demo does the same). Callers
  // that change the profile otherwise (import, calibration) call `syncTargets()`.
  host.addEventListener('mode-change', syncTargets);
  const onSelect = (e: CustomEvent<{ targetId: string; now: number }>): void => {
    if (settingsOpen || gate.isStale(e.detail.now)) return;
    const id = e.detail.targetId;
    const text = phraseTexts.get(id);
    if (text !== undefined) app.model.dispatch({ type: 'replace', text }, false);
    else ACTIONS.get(id)?.();
  };
  host.addEventListener('select', onSelect);

  return {
    syncTargets,
    destroy() {
      unsubscribe();
      unsubscribeStrip?.();
      unsubscribePhrases?.();
      host.removeEventListener('pointer-move', onPointerMove);
      host.removeEventListener('dwell-progress', onDwellProgress);
      host.removeEventListener('highlight', onHighlight);
      if (clearHandle !== null) doc.defaultView?.cancelAnimationFrame(clearHandle);
      host.removeEventListener('select', onSelect);
      settingsButton?.removeEventListener('click', onSettingsClick);
      settingsDialog?.removeEventListener('close', onSettingsClose);
      gate.destroy();
      host.removeEventListener('mode-change', syncTargets);
      view?.removeEventListener('resize', syncTargets);
      view?.removeEventListener('scroll', syncTargets);
    },
  };
}
