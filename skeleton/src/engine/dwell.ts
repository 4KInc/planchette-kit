/**
 * dwell.ts — dwell timer (Req 3, design §5 "Dwell engine details").
 *
 * Pure logic: time is an input (`now`); no clocks, DOM or devices.
 * Depends on profile.ts and targets.ts only (type imports).
 *
 * Rules implemented here:
 *  - Dwell time accumulates only between consecutive samples that are both on the
 *    target, and one sample gap adds at most MAX_SAMPLE_GAP_MS. A gap off the target
 *    adds nothing. A gap no longer than `graceTime` pauses the timer; a longer gap
 *    ends the stay and resets it.
 *  - One `select` per stay unless the target allows auto-repeat.
 *  - Auto-repeat selects again once per max(autoRepeatInterval, postSelectionPause).
 *  - After any selection no dwell time counts for any target until the
 *    post-selection pause ends, and progress shows 0.
 *  - Rest-area targets and empty space never select.
 *  - When a stay ends, one `dwell-progress` with progress 0 is emitted for its target.
 *  - Silence of `inputTimeout` or more ends the current stay.
 */

import type { Profile } from './profile.js';
import type { DwellTarget, Rect, TargetRole } from './targets.js';

/**
 * The most time one sample gap can add to the dwell timer (ms). Normal frame gaps
 * (16 to 100 ms, so down to a 10 fps camera) count in full. A stall between two
 * on-target samples cannot select by itself.
 */
export const MAX_SAMPLE_GAP_MS = 100;

export interface DwellState {
  /** Target of the current stay, or null when there is no stay. */
  targetId: string | null;
  /** Time accumulated on the target in this stay (ms). */
  accumulated: number;
  /** Timestamp of the last sample that was on the stay's target. */
  lastOnTime: number;
  /** True when the previous sample was on the stay's target. */
  prevOn: boolean;
  /** True once the stay has produced a select. */
  selected: boolean;
  /** Timestamp of the stay's most recent select (-Infinity if none). */
  selectedAt: number;
  /** No dwell time counts and nothing is selected before this timestamp. */
  pauseEnd: number;
  /** Timestamp of the last accepted sample (-Infinity before the first). */
  t_last: number;
}

export type DwellEvent =
  | { type: 'dwell-progress'; targetId: string; progress: number }
  | { type: 'select'; targetId: string; now: number; source: 'dwell'; role: TargetRole };

export interface DwellInput {
  /** Pointer position in CSS px, or null when the pointer is lost. */
  pointer: { x: number; y: number } | null;
  targets: ReadonlyArray<DwellTarget>;
}

const NO_EVENTS: readonly DwellEvent[] = Object.freeze([]);

export function createDwellState(): DwellState {
  return {
    targetId: null,
    accumulated: 0,
    lastOnTime: -Infinity,
    prevOn: false,
    selected: false,
    selectedAt: -Infinity,
    pauseEnd: -Infinity,
    t_last: -Infinity,
  };
}

export function cloneDwellState(s: DwellState): DwellState {
  return { ...s };
}

/** End the current stay, if any, and record the clearing event for its target. */
function endStay(s: DwellState, events: DwellEvent[]): void {
  if (s.targetId !== null) {
    events.push({ type: 'dwell-progress', targetId: s.targetId, progress: 0 });
  }
  s.targetId = null;
  s.accumulated = 0;
  s.lastOnTime = -Infinity;
  s.prevOn = false;
  s.selected = false;
  s.selectedAt = -Infinity;
}

function contains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
}

/**
 * The target under the pointer, or null. Rest areas are not selectable and are
 * skipped. If rectangles overlap, the first one in `targets` wins.
 */
export function hitTest(
  p: { x: number; y: number },
  targets: ReadonlyArray<DwellTarget>,
): DwellTarget | null {
  for (const t of targets) {
    if (t.role === 'rest-area') continue;
    if (contains(t.rect, p.x, p.y)) return t;
  }
  return null;
}

/**
 * Advance the dwell engine by one sample. Mutates `state` in place.
 * The returned array is shared and frozen when empty. Do not mutate it.
 */
export function stepDwell(
  state: DwellState,
  input: DwellInput,
  now: number,
  profile: Profile,
): DwellEvent[] {
  // Req 9 AC 4: duplicate, backwards or non-finite timestamps change nothing.
  if (!Number.isFinite(now) || !(now > state.t_last)) {
    return NO_EVENTS as DwellEvent[];
  }

  const events: DwellEvent[] = [];
  const prevNow = state.t_last;
  // Req 6 AC 6: silence for the input timeout ends the stay.
  if (now - prevNow >= profile.inputTimeout) endStay(state, events);
  state.t_last = now;

  const p = input.pointer;
  if (p === null || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
    // Pointer lost: the stay ends at once (Req 2 AC 10), with no grace time.
    endStay(state, events);
    return events.length > 0 ? events : (NO_EVENTS as DwellEvent[]);
  }

  const hit = hitTest(p, input.targets);

  if (hit === null) {
    // Off every target. The stay survives only while the gap is within the grace time.
    state.prevOn = false;
    if (state.targetId !== null && now - state.lastOnTime > profile.graceTime) {
      endStay(state, events);
    }
    return events.length > 0 ? events : (NO_EVENTS as DwellEvent[]);
  }

  let counts = false; // true when the time since the previous sample is continuous on-target
  if (state.targetId === hit.id) {
    if (state.prevOn) {
      counts = true;
    } else if (now - state.lastOnTime > profile.graceTime) {
      // Returned after a gap longer than the grace time: a new stay.
      endStay(state, events);
      state.targetId = hit.id;
    }
    // Returned within the grace time: resume, adding nothing for the gap.
  } else {
    // A different target (or none before): a new stay.
    endStay(state, events);
    state.targetId = hit.id;
  }
  state.lastOnTime = now;
  state.prevOn = true;

  const inPause = now < state.pauseEnd;

  if (counts && !state.selected && !inPause) {
    // Only the part of the interval after the pause counts, and one gap adds at most
    // MAX_SAMPLE_GAP_MS.
    const from = Math.max(prevNow, state.pauseEnd);
    state.accumulated += Math.min(now - from, MAX_SAMPLE_GAP_MS);
  }

  let fire = false;
  let progress = 0;
  if (inPause) {
    progress = 0;
  } else if (!state.selected) {
    progress = Math.min(1, state.accumulated / profile.dwellTime);
    fire = state.accumulated >= profile.dwellTime;
  } else if (hit.autoRepeat) {
    const repeatAt = Math.max(
      state.selectedAt + Math.max(profile.autoRepeatInterval, profile.postSelectionPause),
      state.pauseEnd,
    );
    const span = repeatAt - state.pauseEnd;
    progress = span > 0 ? Math.min(1, (now - state.pauseEnd) / span) : 1;
    fire = now >= repeatAt;
  }
  // else: a completed stay without auto-repeat shows 0 until it ends.

  if (fire) {
    state.selected = true;
    state.selectedAt = now;
    state.pauseEnd = now + profile.postSelectionPause;
    events.push(
      { type: 'dwell-progress', targetId: hit.id, progress: 1 },
      { type: 'select', targetId: hit.id, now, source: 'dwell', role: hit.role },
    );
    return events;
  }
  events.push({ type: 'dwell-progress', targetId: hit.id, progress });
  return events;
}
