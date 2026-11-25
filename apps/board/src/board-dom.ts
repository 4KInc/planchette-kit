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
 * Every visible
 * string comes from messages.ts: elements with `data-text="<path>"` are filled from it.
 */
import type { Planchette, Rect, TargetRole } from '@planchette/skeleton';
import { CORE_VOCABULARY } from './core-vocabulary.js';
import { LETTER_BOARD } from './letter-board.js';
import type { BoardApp } from './main.js';
import { messages } from './messages.js';

/** The part of `Planchette` the Board's DOM layer uses. A test host implements only this. */
export type BoardHost = Pick<Planchette, 'registerTarget' | 'updateTarget' | 'unregisterTarget' | 'setScreen' | 'getProfile' | 'addEventListener' | 'removeEventListener'>;

/** The part of `BoardApp` the DOM layer uses. */
export type BoardDomApp = Pick<BoardApp, 'speakMessage'> & {
  readonly model: Pick<BoardApp['model'], 'message' | 'dispatch' | 'undo' | 'subscribe'>;
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
  doc.title = messages.page.title;
  const messageBar = byId(doc, 'message-bar');
  const coreGrid = byId(doc, 'core-grid');
  const letterGrid = byId(doc, 'letter-grid');

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
  // Spell mode: the Letter board replaces the Core grid; it also decides what Backspace
  // removes (a word, or in Spell mode a character).
  let spellMode = false;
  const spellToggle = doc.querySelector<HTMLElement>('[data-planchette-target="spell-toggle"]');

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
    ['backspace-action', () => app.model.dispatch({ type: 'backspace' }, spellMode)],
    ['clear', () => app.model.dispatch({ type: 'clear' }, spellMode)],
    ['undo', () => app.model.undo()],
    [
      'spell-toggle',
      () => {
        spellMode = !spellMode;
        spellToggle?.setAttribute('aria-pressed', String(spellMode));
        setCoreGridActive(!spellMode);
        setLetterBoardActive(spellMode);
      },
    ],
  ]);

  const showMessage = (message: string): void => {
    messageBar.textContent = message;
  };
  showMessage(app.model.message);
  const unsubscribe = app.model.subscribe(showMessage);

  /** Ids currently registered with the host; only these are updated on a resize. */
  const registered = new Map<string, HTMLElement>();
  const registerEl = (el: HTMLElement): void => {
    const id = el.dataset.planchetteTarget!;
    const role = el.dataset.role;
    const options = role !== undefined && ROLES.has(role) ? { role: role as TargetRole } : undefined;
    host.registerTarget(id, rectOf(el), options);
    registered.set(id, el);
  };
  const unregisterEl = (el: HTMLElement): void => {
    const id = el.dataset.planchetteTarget!;
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

  const view = doc.defaultView;
  /** Sizes and spaces the grid from the profile (the skeleton demo's variable names). */
  const applyLayout = (): void => {
    const { targetSize, targetSpacing } = host.getProfile();
    doc.documentElement.style.setProperty('--target-size', `${targetSize}px`);
    doc.documentElement.style.setProperty('--target-gap', `${targetSpacing}px`);
  };
  applyLayout();

  for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[data-planchette-target]'))) {
    if (!coreElements.includes(el) && !letterElements.includes(el)) registerEl(el);
  }
  setLetterBoardActive(false);
  setCoreGridActive(true);

  /** Re-reads the profile's layout and every registered target's rectangle. */
  const syncTargets = (): void => {
    applyLayout();
    if (view !== null) host.setScreen({ width: view.innerWidth, height: view.innerHeight });
    for (const [id, el] of registered) host.updateTarget(id, rectOf(el));
  };
  view?.addEventListener('resize', syncTargets);
  view?.addEventListener('scroll', syncTargets, { passive: true });

  // A mode change reloads the profile's layout (the skeleton demo does the same). Callers
  // that change the profile otherwise (import, calibration) call `syncTargets()`.
  host.addEventListener('mode-change', syncTargets);
  const onSelect = (e: CustomEvent<{ targetId: string }>): void => ACTIONS.get(e.detail.targetId)?.();
  host.addEventListener('select', onSelect);

  return {
    syncTargets,
    destroy() {
      unsubscribe();
      host.removeEventListener('select', onSelect);
      host.removeEventListener('mode-change', syncTargets);
      view?.removeEventListener('resize', syncTargets);
      view?.removeEventListener('scroll', syncTargets);
    },
  };
}
