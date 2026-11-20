/**
 * dwell.ts — dwell timer (Req 3, design §3 overview).
 *
 * Pure logic: time is an input (`now`); no clocks, DOM or devices.
 * Depends on profile.ts only (type import).
 *
 * Rules implemented here:
 *  - Dwell time accumulates only between consecutive samples that are both on the
 *    target. A gap off the target adds nothing. A gap no longer than `graceTime`
 *    pauses the timer; a longer gap ends the stay and resets it.
 *  - One `select` per stay unless the target allows auto-repeat.
 *  - Auto-repeat selects again once per max(autoRepeatInterval, postSelectionPause).
 *  - After any selection nothing is selected until the post-selection pause ends.
 *    Dwell time keeps accumulating during the pause, so a target the pointer moved
 *    onto during the pause can be selected as soon as the pause ends.
 *  - Rest-area targets and empty space never select.
 *  - Silence of `inputTimeout` or more resets the current stay silently.
 */

import type { Profile } from './profile';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TargetRole = 'default' | 'cancel' | 'undo' | 'rest-area';

export interface DwellTarget {
  id: string;
  rect: Rect;
  autoRepeat: boolean;
  role: TargetRole;
}

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
  /** No select may happen before this timestamp (post-selection pause). */
  pauseEnd: number;
  /** Timestamp of the last accepted sample (-Infinity before the first). */
  t_last: number;
}

export type DwellEvent =
  | { type: 'dwell-progress'; targetId: string; progress: number }
  | { type: 'select'; targetId: string; now: number; source: 'dwell'; role: TargetRole };

export interface DwellInput {
  /** Pointer position in CSS px, or null when there is no pointer. */
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

function endStay(s: DwellState): void {
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
function hitTest(input: DwellInput): DwellTarget | null {
  const p = input.pointer;
  if (p === null || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
  for (const t of input.targets) {
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

  const prevNow = state.t_last;
  // Req 6 AC 6: silence for the input timeout ends the stay silently.
  if (now - prevNow >= profile.inputTimeout) endStay(state);
  state.t_last = now;

  const hit = hitTest(input);

  if (hit === null) {
    // Off every target. The stay survives only while the gap is within the grace time.
    state.prevOn = false;
    if (state.targetId !== null && now - state.lastOnTime > profile.graceTime) {
      endStay(state);
    }
    return NO_EVENTS as DwellEvent[];
  }

  if (state.targetId === hit.id) {
    if (state.prevOn) {
      // Continuous time on the target.
      state.accumulated += now - prevNow;
    } else if (now - state.lastOnTime > profile.graceTime) {
      // Returned after a gap longer than the grace time: a new stay.
      endStay(state);
      state.targetId = hit.id;
    }
    // Returned within the grace time: resume, adding nothing for the gap.
  } else {
    // A different target (or none before): a new stay.
    endStay(state);
    state.targetId = hit.id;
  }
  state.lastOnTime = now;
  state.prevOn = true;

  const repeatInterval = Math.max(profile.autoRepeatInterval, profile.postSelectionPause);
  const pauseOver = now >= state.pauseEnd;

  let fire = false;
  let progress: number;
  if (!state.selected) {
    progress = Math.min(1, state.accumulated / profile.dwellTime);
    fire = state.accumulated >= profile.dwellTime && pauseOver;
  } else if (hit.autoRepeat) {
    const since = now - state.selectedAt;
    progress = Math.min(1, since / repeatInterval);
    fire = since >= repeatInterval && pauseOver;
  } else {
    progress = 1;
  }

  if (fire) {
    progress = 1;
    state.selected = true;
    state.selectedAt = now;
    state.pauseEnd = now + profile.postSelectionPause;
    return [
      { type: 'dwell-progress', targetId: hit.id, progress },
      { type: 'select', targetId: hit.id, now, source: 'dwell', role: hit.role },
    ];
  }
  return [{ type: 'dwell-progress', targetId: hit.id, progress }];
}
