/**
 * seance-dom.ts: the only file that draws the page and registers the board's and Summary's targets
 * (design.md, `seance-dom.ts`). It owns the view, the page seed and Round number, the last Carry's
 * undo record and the arrival-guard state. Game rules live in the pure modules (round.ts, support.ts,
 * summary.ts, board-link.ts); this file connects them to the DOM, the Planchette and storage.
 * It starts no camera and makes no sound unless the person selects the Sound target.
 */
import type { InputMode, Planchette } from '@planchette/skeleton';
import { createTargetRegistry, type TargetRegistry } from '@planchette/skeleton/ui';
import { carryDwellToBoard, clampDwell, readBoard, undoCarry, type CarryRecord, type StorageLike } from './board-link.js';
import { messages } from './messages.js';
import { createRound, stepRound, type RoundEvent, type RoundInput, type RoundState } from './round.js';
import { BOARD_CELLS, guardedTargets, insideRect, type Point } from './seance-layout.js';
import type { Sound } from './sound.js';
import { pickMessage } from './spirit-messages.js';
import { canOfferCarry, summarise } from './summary.js';
import { createSupport, stepSupport, type SupportEvent, type SupportInput, type SupportLevel, type SupportState } from './support.js';
export type SeanceHost = Pick<
  Planchette,
  'registerTarget' | 'updateTarget' | 'unregisterTarget' | 'setScreen' | 'getProfile' | 'setProfile' | 'addEventListener' | 'removeEventListener'
>;
export interface SeanceDomOptions {
  readonly host: SeanceHost;
  readonly document: Document;
  /** The Board key and nothing else is read or written through this, and only on a Carry. */
  readonly storage?: StorageLike | undefined;
  /** Chooses the Messages (Requirement 14 AC 5). */
  readonly seed: number;
  readonly sound: Sound;
  /** Saves the Profile (after an accepted Suggestion). */
  readonly saveProfile: () => void;
  /** True for a `select` that must be ignored (Settings open, or stamped before it closed). */
  readonly isBlocked?: (selectNow: number) => boolean;
  /** The clock for Round starts and view changes. Default `performance.now()`. */
  readonly now?: () => number;
}
export interface SeanceState {
  readonly view: 'play' | 'summary';
  readonly roundNumber: number;
  readonly messageText: string;
  readonly status: RoundState['status'];
  readonly index: number;
  readonly misses: number;
  readonly takenBack: number;
  readonly level: SupportLevel;
  readonly suggestion: number | null;
  readonly carried: boolean;
  readonly held: readonly string[];
}
export interface SeanceDom {
  /** Starts the next Round (also used by "Another round"). */
  startRound(): void;
  /** Re-measures every registered target and tells the skeleton the screen size. */
  syncTargets(): void;
  state(): SeanceState;
  destroy(): void;
}
const SVG_NS = 'http://www.w3.org/2000/svg';
function byId<T extends HTMLElement>(doc: Document, id: string): T {
  const el = doc.getElementById(id);
  if (el === null) throw new Error(`seance: #${id} is missing from seance/index.html`);
  return el as T;
}
function messageAt(path: string): string {
  let node: unknown = messages;
  for (const key of path.split('.')) node = (node as Record<string, unknown> | undefined)?.[key];
  return typeof node === 'string' ? node : '';
}
/** A small planchette glyph: a rounded pointer with a window. Decoration only. */
function planchetteGlyph(doc: Document, className: string): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', className);
  const body = doc.createElementNS(SVG_NS, 'path');
  body.setAttribute('d', 'M12 2 C17 2 21 8 21 14 C21 19 17 22 12 22 C7 22 3 19 3 14 C3 8 7 2 12 2 Z');
  const window_ = doc.createElementNS(SVG_NS, 'circle');
  window_.setAttribute('cx', '12');
  window_.setAttribute('cy', '13');
  window_.setAttribute('r', '4');
  svg.append(body, window_);
  return svg;
}
export function mountSeanceDom(options: SeanceDomOptions): SeanceDom {
  const { host, document: doc, storage, seed, sound, saveProfile, isBlocked } = options;
  const clock = options.now ?? ((): number => doc.defaultView?.performance.now() ?? 0);
  const win = doc.defaultView;
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[data-text]'))) el.textContent = messageAt(el.dataset.text!);
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[data-aria-label]'))) el.setAttribute('aria-label', messageAt(el.dataset.ariaLabel!));
  doc.title = messages.page.title;
  const page = doc.querySelector<HTMLElement>('.page')!;
  const board = byId(doc, 'board');
  const boardSection = byId(doc, 'board-section');
  const summarySection = byId(doc, 'summary-section');
  const spelledLetters = byId(doc, 'spelled-letters');
  const spelledCallout = byId(doc, 'spelled-callout');
  const live = byId(doc, 'live');
  const soundToggle = byId<HTMLButtonElement>(doc, 'sound-toggle');
  const suggestApply = byId<HTMLButtonElement>(doc, 'suggest-apply');
  const suggestDismiss = byId<HTMLButtonElement>(doc, 'suggest-dismiss');
  const carryButton = byId<HTMLButtonElement>(doc, 'carry-dwell');
  const nextButton = byId<HTMLButtonElement>(doc, 'next-round');
  const carryText = byId(doc, 'summary-board');
  const undoButton = byId<HTMLButtonElement>(doc, 'undo');
  const registry: TargetRegistry = createTargetRegistry(host);
  // ---- the board, from the fixed cell table
  const boardEls = new Map<string, HTMLElement>();
  for (const cell of BOARD_CELLS) {
    let el: HTMLElement;
    if (cell.kind === 'decor') {
      el = doc.createElement('div');
      el.className = `decor cell ${cell.id}`;
      el.setAttribute('aria-hidden', 'true');
      if (cell.id === 'decor-planchette') el.append(planchetteGlyph(doc, 'decor-glyph'));
    } else {
      el = doc.createElement('button');
      (el as HTMLButtonElement).type = 'button';
      const isLetter = cell.id.startsWith('letter-');
      el.className = `target cell ${isLetter ? 'letter' : 'word'}`;
      el.dataset.planchetteTarget = cell.id;
      el.textContent = isLetter ? cell.id.slice(-1).toUpperCase() : messageAt(`targets.${cell.id}`);
      boardEls.set(cell.id, el);
    }
    el.dataset.row = String(cell.row);
    el.dataset.col = String(cell.col);
    if (cell.colSpan > 1) el.dataset.span = String(cell.colSpan);
    board.append(el);
  }
  const labelOf = (id: string): string => (id.startsWith('letter-') ? id.slice(-1).toUpperCase() : messageAt(`targets.${id}`));
  // Summary targets use the same grid columns.
  carryButton.dataset.row = '5';
  nextButton.dataset.row = '5';
  const sideEls = ['stop', 'undo', 'cancel', 'sound-toggle', 'rest-area'].map((id) => doc.querySelector<HTMLElement>(`[data-planchette-target="${id}"]`)!);
  const cameraToggle = doc.querySelector<HTMLElement>('[data-planchette-target="camera-toggle"]');
  // ---- state
  const support: SupportState = createSupport();
  let view: 'play' | 'summary' = 'play';
  let roundNumber = 0;
  let previousId: string | null = null;
  let round: RoundState = createRound(pickMessage(seed, 1, null), 0);
  let modeChanged = false;
  let viewChangedAt = Number.NEGATIVE_INFINITY;
  let carryRecord: CarryRecord | null = null;
  let lastPointer: Point | null = null;
  const held = new Set<HTMLElement>();
  const registeredView = new Set<HTMLElement>();
  // ---- helpers
  const say = (text: string): void => {
    live.textContent = text;
  };
  const nextLabel = (): string => labelOf(round.message.steps[Math.min(round.index, round.message.steps.length - 1)]!);
  const modeOf = (): InputMode => host.getProfile().mode;
  const dwellOf = (): number => host.getProfile().dwellTime;
  function unregisterView(): void {
    for (const el of registeredView) registry.unregister(el);
    registeredView.clear();
    for (const el of held) el.removeAttribute('data-held');
    held.clear();
  }
  /** The arrival guard (Requirement 4 AC 7): hold back any target that contains the pointer. */
  function registerGuarded(els: readonly HTMLElement[]): void {
    const rects = new Map(els.map((el) => [el.dataset.planchetteTarget!, el.getBoundingClientRect()] as const));
    const asRects = new Map([...rects].map(([id, r]) => [id, { x: r.x, y: r.y, width: r.width, height: r.height }] as const));
    const { register, held: heldIds } = guardedTargets([...asRects.keys()], asRects, lastPointer);
    for (const el of els) {
      const id = el.dataset.planchetteTarget!;
      if (heldIds.includes(id)) {
        held.add(el);
        el.dataset.held = 'true';
      } else if (register.includes(id)) registry.register(el);
      registeredView.add(el);
    }
  }
  const onPointerMove = (e: CustomEvent<{ x: number; y: number }>): void => {
    lastPointer = { x: e.detail.x, y: e.detail.y };
    if (held.size === 0) return;
    for (const el of [...held]) {
      const r = el.getBoundingClientRect();
      if (!insideRect(lastPointer, { x: r.x, y: r.y, width: r.width, height: r.height })) {
        held.delete(el);
        el.removeAttribute('data-held');
        registry.register(el);
      }
    }
  };
  // ---- drawing
  function setLevel(level: SupportLevel): void {
    page.dataset.support = String(level);
  }
  function drawSpelled(): void {
    spelledLetters.dataset.kind = 'letters';
    spelledLetters.replaceChildren();
    round.message.steps.forEach((id, i) => {
      const s = doc.createElement('span');
      if (i < round.index) s.textContent = labelOf(id);
      else {
        s.textContent = '\u00b7';
        s.className = 'todo';
      }
      spelledLetters.append(s);
      if (i < round.message.steps.length - 1) spelledLetters.append(doc.createTextNode(' '));
    });
    spelledCallout.textContent = support.level >= 1 && round.status === 'playing' ? messages.round.next(nextLabel()) : '';
  }
  function drawMarker(): void {
    for (const el of boardEls.values()) {
      if (el.dataset.next === 'true') {
        delete el.dataset.next;
        el.querySelector('.marker')?.remove();
      }
    }
    if (view !== 'play' || round.status !== 'playing') return;
    const el = boardEls.get(round.message.steps[round.index]!);
    if (el === undefined) return;
    el.dataset.next = 'true';
    el.append(planchetteGlyph(doc, 'marker'));
  }
  function spelledSoFar(): string {
    return round.message.steps.slice(0, round.index).map(labelOf).join('');
  }
  function redraw(announce: 'progress' | 'none' = 'progress'): void {
    drawSpelled();
    drawMarker();
    if (announce === 'progress') say(messages.round.progress(spelledSoFar(), nextLabel()));
  }
  function openSuggestion(ms: number): void {
    for (const b of [suggestApply, suggestDismiss]) {
      b.disabled = false;
      b.removeAttribute('aria-hidden');
      b.removeAttribute('tabindex');
      delete b.dataset.empty;
    }
    suggestApply.textContent = messages.suggestion.apply(ms);
    suggestApply.setAttribute('aria-label', `${messages.suggestion.apply(ms)}. ${messages.suggestion.text(ms)}`);
    suggestDismiss.textContent = messages.suggestion.dismiss;
    registry.register(suggestApply);
    registry.register(suggestDismiss);
    say(messages.suggestion.text(ms));
  }
  function closeSuggestion(): void {
    for (const b of [suggestApply, suggestDismiss]) {
      registry.unregister(b);
      b.disabled = true;
      b.setAttribute('aria-hidden', 'true');
      b.tabIndex = -1;
      b.dataset.empty = 'true';
      b.textContent = '';
      b.removeAttribute('aria-label');
    }
  }
  function applySupport(events: readonly SupportEvent[]): void {
    for (const e of events) {
      if (e.type === 'level') setLevel(e.level);
      else if (e.type === 'suggest') openSuggestion(e.ms);
      else if (e.type === 'suggestion-closed') closeSuggestion();
      else if (e.type === 'apply-dwell') {
        host.setProfile({ dwellTime: e.ms });
        saveProfile();
        say(messages.suggestion.applied(e.ms));
      }
    }
  }
  const feedSupport = (input: SupportInput, now: number): void => applySupport(stepSupport(support, input, now));
  // ---- summary
  function renderSummary(): void {
    const profile = host.getProfile();
    const data = summarise(round, { dwellMs: profile.dwellTime, mode: profile.mode });
    byId(doc, 'summary-letters').textContent = messages.summary.letters(data.letters, data.steps);
    byId(doc, 'summary-time').textContent = messages.summary.time(data.seconds);
    byId(doc, 'summary-accidental').textContent = messages.summary.accidental(data.misses);
    byId(doc, 'summary-accidental-meaning').textContent = messages.summary.accidentalMeaning;
    byId(doc, 'summary-taken-back').textContent = messages.summary.takenBack(data.takenBack);
    byId(doc, 'summary-dwell').textContent = messages.summary.dwellAndMode(data.dwellMs, messages.modeNames[data.mode] ?? data.mode);
    renderCarry(data.dwellMs);
  }
  /** The Carry offer and the Board line, from what the Board key holds right now. */
  function renderCarry(dwellMs: number): void {
    const wasShown = registeredView.has(carryButton);
    if (wasShown) {
      registry.unregister(carryButton);
      registeredView.delete(carryButton);
      held.delete(carryButton);
    }
    carryButton.hidden = true;
    const board = readBoard(storage);
    const offer = canOfferCarry(round, { mode: modeOf(), modeChangedDuringRound: modeChanged, boardReadable: board.state !== 'unreadable' });
    const carryable = clampDwell(dwellMs);
    if (carryRecord !== null) return; // the result text is already shown
    if (!offer) {
      carryText.textContent = board.state === 'unreadable' && round.status === 'complete' && modeOf() === 'head + dwell' ? messages.summary.boardUnreadable : '';
      return;
    }
    if (board.state === 'ok' && board.dwellMs === carryable) {
      carryText.textContent = messages.summary.boardAlready(carryable);
      return;
    }
    const status =
      board.state === 'none' ? messages.summary.boardNone : board.state === 'ok' && board.dwellMs !== null ? messages.summary.boardUses(board.dwellMs) : messages.summary.boardUsesDefault;
    carryText.textContent = `${status} ${messages.summary.carryHelp}`;
    carryButton.textContent = messages.summary.carryOffer(carryable);
    carryButton.hidden = false;
    if (view === 'summary') registerGuarded([carryButton]);
  }
  function showSummary(): void {
    unregisterView();
    drawMarker();
    view = 'summary';
    viewChangedAt = clock();
    page.dataset.view = 'summary';
    boardSection.hidden = true;
    summarySection.hidden = false;
    spelledLetters.dataset.kind = 'heading';
    spelledLetters.textContent = round.status === 'complete' ? messages.summary.completeHeading(round.message.text) : messages.summary.stoppedHeading;
    spelledCallout.textContent = '';
    nextButton.textContent = messages.summary.anotherRound;
    carryRecord = null;
    undoButton.setAttribute('aria-label', messages.actions.undoSummaryHelp);
    renderSummary();
    registerGuarded([nextButton]);
    say(round.status === 'complete' ? messages.round.complete(round.message.text) : messages.round.stopped);
  }
  // ---- rounds
  function startRound(): void {
    const t = clock();
    roundNumber += 1;
    const message = pickMessage(seed, roundNumber, previousId);
    previousId = message.id;
    round = createRound(message, t);
    modeChanged = false;
    carryRecord = null;
    unregisterView();
    view = 'play';
    viewChangedAt = t;
    page.dataset.view = 'play';
    summarySection.hidden = true;
    boardSection.hidden = false;
    carryText.textContent = '';
    undoButton.setAttribute('aria-label', messages.actions.undoPlayHelp);
    feedSupport({ type: 'round-start' }, t);
    registerGuarded([...boardEls.values()]);
    redraw('none');
    say(messages.round.starting(nextLabel()));
  }
  function handleRound(events: readonly RoundEvent[], now: number): void {
    let ended = false;
    const completed = events.some((e) => e.type === 'complete');
    for (const e of events) {
      if (e.type === 'hit') {
        feedSupport({ type: 'hit' }, now);
        if (!completed) sound.play('hit');
      } else if (e.type === 'miss') feedSupport({ type: 'miss', dwellMs: dwellOf() }, now);
      else if (e.type === 'complete') {
        sound.play('complete');
        ended = true;
      } else if (e.type === 'stopped') ended = true;
    }
    if (ended) showSummary();
    else {
      const undone = events.find((e) => e.type === 'undone');
      redraw('none');
      say(undone !== undefined ? messages.round.tookBack(nextLabel()) : messages.round.progress(spelledSoFar(), nextLabel()));
    }
  }
  const playing = (): boolean => view === 'play' && round.status === 'playing';
  function carry(): void {
    if (view !== 'summary' || carryRecord !== null) return;
    const result = carryDwellToBoard(storage, host.getProfile().dwellTime);
    if (!result.ok) {
      carryText.textContent = result.reason === 'unreadable' ? messages.summary.boardUnreadable : messages.summary.carryFailed;
      return;
    }
    carryRecord = result.record;
    carryText.textContent = messages.summary.carried(result.record.dwellMs);
    registry.unregister(carryButton);
    registeredView.delete(carryButton);
    carryButton.hidden = true;
    say(carryText.textContent);
  }
  function undoInSummary(): void {
    if (carryRecord === null) return;
    const outcome = undoCarry(storage, carryRecord);
    if (outcome === 'restored') {
      carryRecord = null;
      renderCarry(host.getProfile().dwellTime);
      say(messages.summary.carryUndone(carryText.textContent ?? ''));
    } else {
      carryText.textContent = outcome === 'changed-since' ? messages.summary.carryUndoChanged : messages.summary.carryUndoFailed;
      carryRecord = null;
      say(carryText.textContent);
    }
  }
  function toggleSound(): void {
    const on = sound.setOn(!sound.isOn());
    soundToggle.setAttribute('aria-pressed', String(on));
    soundToggle.textContent = on ? messages.actions.soundOn : messages.actions.soundOff;
  }
  // ---- events
  const onSelect = (e: CustomEvent<{ targetId: string; now: number }>): void => {
    const { targetId, now } = e.detail;
    if (isBlocked?.(now) === true) return;
    if (now <= viewChangedAt) return; // stamped before the view changed: it belongs to the old view
    if (boardEls.has(targetId)) {
      if (playing()) handleRound(stepRound(round, { type: 'select', target: targetId } satisfies RoundInput, now), now);
      return;
    }
    switch (targetId) {
      case 'stop':
        if (playing()) handleRound(stepRound(round, { type: 'stop' }, now), now);
        break;
      case 'undo':
        if (playing()) handleRound(stepRound(round, { type: 'undo' }, now), now);
        else if (view === 'summary') undoInSummary();
        break;
      case 'sound-toggle':
        toggleSound();
        break;
      case 'suggest-apply':
        feedSupport({ type: 'accept' }, now);
        break;
      case 'suggest-dismiss':
        feedSupport({ type: 'dismiss' }, now);
        break;
      case 'next-round':
        if (view === 'summary') startRound();
        break;
      case 'carry-dwell':
        carry();
        break;
      default:
        break; // camera-toggle is the shared controls'; cancel arrives as its own event
    }
  };
  /** Cancel closes an open Suggestion (Requirement 3 AC 8); otherwise the skeleton has already reset the dwell. */
  const onCancel = (): void => {
    feedSupport({ type: 'dismiss' }, clock());
  };
  const onModeChange = (): void => {
    if (playing()) modeChanged = true;
    syncTargets();
  };
  function syncTargets(): void {
    if (win !== null) host.setScreen({ width: win.innerWidth, height: win.innerHeight });
    registry.update();
  }
  host.addEventListener('select', onSelect);
  host.addEventListener('cancel', onCancel);
  host.addEventListener('pointer-move', onPointerMove);
  host.addEventListener('mode-change', onModeChange);
  win?.addEventListener('resize', syncTargets);
  // the side column's targets are present in every view
  closeSuggestion();
  syncTargets();
  for (const el of sideEls) registry.register(el);
  if (cameraToggle !== null) registry.register(cameraToggle);
  soundToggle.textContent = messages.actions.soundOff;
  startRound();
  return {
    startRound,
    syncTargets,
    state: () => ({
      view,
      roundNumber,
      messageText: round.message.text,
      status: round.status,
      index: round.index,
      misses: round.misses,
      takenBack: round.takenBack,
      level: support.level,
      suggestion: support.suggestion?.ms ?? null,
      carried: carryRecord !== null,
      held: [...held].map((el) => el.dataset.planchetteTarget!),
    }),
    destroy() {
      host.removeEventListener('select', onSelect);
      host.removeEventListener('cancel', onCancel);
      host.removeEventListener('pointer-move', onPointerMove);
      host.removeEventListener('mode-change', onModeChange);
      win?.removeEventListener('resize', syncTargets);
    },
  };
}
