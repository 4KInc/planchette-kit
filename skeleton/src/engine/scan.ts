/**
 * scan.ts — single-switch scanning (Req 4, design §5 "Scan engine details").
 *
 * Pure logic: time is an input (`now`); no clocks, DOM or devices.
 * Depends on profile.ts and targets.ts only (type imports). The press itself is
 * counted elsewhere (press-machine.ts); this engine receives `press: true` on the
 * step where a press was counted.
 */

import type { Profile } from './profile';
import type { DwellTarget, TargetRole } from './targets';

/** Id reported when the virtual "back" item is highlighted. */
export const SCAN_BACK_ID = '$back';
/** Id reported when the virtual "cancel" item is highlighted. */
export const SCAN_CANCEL_ID = '$cancel';

export type ScanHighlightKind = 'item' | 'row' | 'back' | 'cancel' | 'none';

export type ScanEvent =
  | {
      type: 'highlight';
      kind: ScanHighlightKind;
      /** The item's id; the first item's id for a row; SCAN_BACK_ID / SCAN_CANCEL_ID; '' for 'none'. */
      targetId: string;
      /** Every target id the highlight covers: one for an item, all for a row, none otherwise. */
      targetIds: string[];
    }
  | { type: 'select'; targetId: string; now: number; source: 'scan'; role: TargetRole }
  | { type: 'cancel' };

export interface ScanInput {
  /** True on the step where a press was counted. */
  press: boolean;
  targets: ReadonlyArray<DwellTarget>;
  /** Optional custom scan order, as target ids. Targets not listed follow in reading order. */
  order?: ReadonlyArray<string>;
}

export interface ScanState {
  /** False until the first step after creation or an input-timeout reset. */
  started: boolean;
  /** True after the profile's number of loops without a press. */
  paused: boolean;
  /** 'top' scans rows (grid) or items (list); 'row' scans the items inside one row. */
  level: 'top' | 'row';
  /** Slot index in the current level's cycle (items or rows, then back/cancel). */
  index: number;
  /** The row being scanned when level is 'row'. */
  row: number;
  /** Completed loops without a press. */
  loops: number;
  /** The highlight advances at the first sample at or after this timestamp. */
  nextAdvance: number;
  /** No press acts before this timestamp (post-selection pause). */
  pauseEnd: number;
  /** Timestamp of the last accepted sample (-Infinity before the first). */
  t_last: number;
}

const NO_EVENTS: readonly ScanEvent[] = Object.freeze([]);

export function createScanState(): ScanState {
  return {
    started: false,
    paused: false,
    level: 'top',
    index: 0,
    row: 0,
    loops: 0,
    nextAdvance: Infinity,
    pauseEnd: -Infinity,
    t_last: -Infinity,
  };
}

export function cloneScanState(s: ScanState): ScanState {
  return { ...s };
}

// ---------------------------------------------------------------------------
// Layout: reading order, rows and the custom order
// ---------------------------------------------------------------------------

interface Layout {
  /** Every scannable target in scan order. */
  flat: DwellTarget[];
  /** The same targets grouped into rows (top to bottom, items in scan order). */
  rows: DwellTarget[][];
  /** True when the top level scans rows first: two or more rows and a row with two or more items. */
  rowMode: boolean;
}

const finite = (v: number): number => (Number.isFinite(v) ? v : 0);

/** Group targets into visual rows and return them in reading order (top to bottom, left to right). */
function readingRows(targets: DwellTarget[]): DwellTarget[][] {
  const entries = targets.map((t, i) => ({
    t,
    i,
    x: finite(t.rect.x),
    y: finite(t.rect.y),
    cy: finite(t.rect.y) + finite(t.rect.height) / 2,
  }));
  entries.sort((a, b) => a.y - b.y || a.x - b.x || a.i - b.i);

  const rows: Array<typeof entries> = [];
  let bandTop = 0;
  let bandBottom = 0;
  for (const e of entries) {
    if (rows.length > 0 && e.cy >= bandTop && e.cy <= bandBottom) {
      rows[rows.length - 1].push(e);
    } else {
      rows.push([e]);
      bandTop = e.y;
      bandBottom = e.y + finite(e.t.rect.height);
    }
  }
  return rows.map((r) => r.sort((a, b) => a.x - b.x || a.i - b.i).map((e) => e.t));
}

function buildLayout(targets: ReadonlyArray<DwellTarget>, order?: ReadonlyArray<string>): Layout {
  const scannable = targets.filter((t) => t.role !== 'rest-area');
  const geometryRows = readingRows(scannable);
  const reading = geometryRows.flat();

  // Scan order: the custom order first (ids that exist), then the rest in reading order.
  let flat = reading;
  if (order !== undefined && order.length > 0) {
    const byId = new Map<string, DwellTarget>();
    for (const t of scannable) if (!byId.has(t.id)) byId.set(t.id, t);
    const seen = new Set<string>();
    flat = [];
    for (const id of order) {
      const t = byId.get(id);
      if (t !== undefined && !seen.has(id)) {
        seen.add(id);
        flat.push(t);
      }
    }
    for (const t of reading) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        flat.push(t);
      }
    }
  }

  // Rows follow the geometry; rows and their items follow the scan order.
  const rank = new Map<DwellTarget, number>();
  flat.forEach((t, i) => rank.set(t, i));
  const rows = geometryRows
    .map((r) => [...r].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0)))
    .sort((a, b) => (rank.get(a[0]) ?? 0) - (rank.get(b[0]) ?? 0));

  const rowMode = rows.length >= 2 && rows.some((r) => r.length >= 2);
  return { flat, rows, rowMode };
}

// ---------------------------------------------------------------------------
// Slots: what the highlight can be on at each level
// ---------------------------------------------------------------------------

function slotCount(layout: Layout, s: ScanState): number {
  if (s.level === 'top') return (layout.rowMode ? layout.rows.length : layout.flat.length) + 1;
  return layout.rows[s.row].length + 2; // items, back, cancel
}

/** Bring the state back inside the current layout (targets can change between steps). */
function fit(layout: Layout, s: ScanState): void {
  if (s.level === 'row' && (!layout.rowMode || s.row >= layout.rows.length)) {
    s.level = 'top';
    s.index = 0;
  }
  const n = slotCount(layout, s);
  if (s.index >= n) s.index = 0;
}

function highlightEvent(layout: Layout, s: ScanState): ScanEvent {
  if (s.level === 'top') {
    if (s.index === slotCount(layout, s) - 1) {
      return { type: 'highlight', kind: 'cancel', targetId: SCAN_CANCEL_ID, targetIds: [] };
    }
    if (layout.rowMode) {
      const row = layout.rows[s.index];
      if (row.length === 1) {
        return { type: 'highlight', kind: 'item', targetId: row[0].id, targetIds: [row[0].id] };
      }
      return { type: 'highlight', kind: 'row', targetId: row[0].id, targetIds: row.map((t) => t.id) };
    }
    const t = layout.flat[s.index];
    return { type: 'highlight', kind: 'item', targetId: t.id, targetIds: [t.id] };
  }
  const items = layout.rows[s.row];
  if (s.index < items.length) {
    const t = items[s.index];
    return { type: 'highlight', kind: 'item', targetId: t.id, targetIds: [t.id] };
  }
  if (s.index === items.length) {
    return { type: 'highlight', kind: 'back', targetId: SCAN_BACK_ID, targetIds: [] };
  }
  return { type: 'highlight', kind: 'cancel', targetId: SCAN_CANCEL_ID, targetIds: [] };
}

function noneHighlight(): ScanEvent {
  return { type: 'highlight', kind: 'none', targetId: '', targetIds: [] };
}

function restart(s: ScanState): void {
  s.level = 'top';
  s.index = 0;
  s.row = 0;
  s.loops = 0;
}

// ---------------------------------------------------------------------------
// step
// ---------------------------------------------------------------------------

/**
 * Advance the scan engine by one sample. Mutates `state` in place.
 * The returned array is shared and frozen when empty. Do not mutate it.
 *
 * Within one step, a press acts on the item that was highlighted before this step,
 * and then no advance happens in the same step.
 */
export function stepScan(
  state: ScanState,
  input: ScanInput,
  now: number,
  profile: Profile,
): ScanEvent[] {
  // Req 9 AC 4: duplicate, backwards or non-finite timestamps change nothing.
  if (!Number.isFinite(now) || !(now > state.t_last)) {
    return NO_EVENTS as ScanEvent[];
  }

  // Req 6 AC 6: silence for the input timeout returns scanning to the top of the cycle.
  // A paused scan stays paused until a press.
  if (now - state.t_last >= profile.inputTimeout && !state.paused) {
    state.started = false;
  }
  state.t_last = now;

  const layout = buildLayout(input.targets, input.order);

  if (!state.started) {
    // First sample (or first after a timeout): start at the top and ignore any press,
    // since nothing was highlighted yet.
    state.started = true;
    restart(state);
    state.nextAdvance = Math.max(now, state.pauseEnd) + profile.scanInterval;
    return [highlightEvent(layout, state)];
  }

  if (input.press) {
    // Req 4.7: a press during the post-selection pause is ignored.
    if (now < state.pauseEnd) return NO_EVENTS as ScanEvent[];

    if (state.paused) {
      // Req 4.8: the press that ends a scan pause only resumes scanning from the start.
      state.paused = false;
      restart(state);
      state.nextAdvance = now + profile.scanInterval;
      return [highlightEvent(layout, state)];
    }
    return act(state, layout, now, profile);
  }

  if (state.paused || now < state.nextAdvance) return NO_EVENTS as ScanEvent[];
  return advance(state, layout, now, profile);
}

/** A counted press acts on the current highlight (Req 4.6). */
function act(state: ScanState, layout: Layout, now: number, profile: Profile): ScanEvent[] {
  fit(layout, state);
  const events: ScanEvent[] = [];

  const finish = (): ScanEvent[] => {
    // Req 4.6: apply the post-selection pause. The first highlight of the new position
    // gets a full scan interval after the pause ends.
    state.loops = 0;
    state.pauseEnd = now + profile.postSelectionPause;
    state.nextAdvance = state.pauseEnd + profile.scanInterval;
    events.push(highlightEvent(layout, state));
    return events;
  };

  const lastSlot = slotCount(layout, state) - 1;

  if (state.index === lastSlot) {
    // The cancel item, at either level.
    events.push({ type: 'cancel' });
    restart(state);
    return finish();
  }

  if (state.level === 'top') {
    if (layout.rowMode) {
      const row = layout.rows[state.index];
      if (row.length > 1) {
        // Enter the row.
        state.level = 'row';
        state.row = state.index;
        state.index = 0;
        return finish();
      }
      events.push(selectEvent(row[0], now));
    } else {
      events.push(selectEvent(layout.flat[state.index], now));
    }
    restart(state);
    return finish();
  }

  const items = layout.rows[state.row];
  if (state.index === items.length) {
    // The back item: return to row scanning, on the row just left.
    state.level = 'top';
    state.index = state.row;
    return finish();
  }
  events.push(selectEvent(items[state.index], now));
  restart(state);
  return finish();
}

function selectEvent(t: DwellTarget, now: number): ScanEvent {
  return { type: 'select', targetId: t.id, now, source: 'scan', role: t.role };
}

/** Move the highlight to the next slot (Req 4.1, 4.3, 4.8). */
function advance(state: ScanState, layout: Layout, now: number, profile: Profile): ScanEvent[] {
  fit(layout, state);
  const n = slotCount(layout, state);

  // Schedule from the previous due time so highlights do not drift with the frame rate.
  // After a stall, resynchronise instead of catching up.
  state.nextAdvance += profile.scanInterval;
  if (state.nextAdvance <= now) state.nextAdvance = now + profile.scanInterval;

  state.index += 1;
  if (state.index < n) return [highlightEvent(layout, state)];

  // A loop is complete.
  state.loops += 1;
  state.index = 0;
  if (state.loops >= profile.scanLoopsBeforePause) {
    if (state.level === 'top') {
      state.paused = true;
      return [noneHighlight()];
    }
    // Inside a row: go back to row scanning, on the row just left.
    state.level = 'top';
    state.index = state.row;
    state.loops = 0;
  }
  return [highlightEvent(layout, state)];
}
