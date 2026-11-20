/**
 * gesture.ts — face-gesture switch (Req 5, design §3 and §4 "Gesture engine details").
 *
 * Turns the score of the profile's switch gesture into a held/released signal and lets
 * the shared press machine decide presses and cancels, using the gesture acceptance time.
 *
 * Pure logic: time is an input (`now`, ms); no clocks, DOM or devices.
 * Depends on profile.ts and press-machine.ts.
 */

import type { Profile } from './profile.js';
import {
  PressState,
  createPressMachineState,
  clonePressMachineState,
  stepPress,
  type PressEvent,
  type PressMachineState,
} from './press-machine.js';
import { FREEZE_EXPIRY_EXTRA_MS, type GestureScores } from './head-pointer.js';

export type GestureEvent = PressEvent;

export interface GestureInput {
  /** The locked face's scores (0–1), or null when no face is detected. */
  gestureScores: GestureScores | null;
}

export interface GestureState {
  press: PressMachineState;
  /** Signal level, with hysteresis: set at ≥ gestureThreshold, cleared below the release threshold. */
  signal: boolean;
  /** True while the score is above the release threshold (the gesture has begun). */
  above: boolean;
  /** When the score went above the release threshold (head + gesture expiry). */
  aboveSince: number;
  /** True once the score reached the gesture threshold during the current gesture. */
  reached: boolean;
  /**
   * True when the current gesture may not produce a press: after a face loss, or after a
   * head + gesture freeze expired. Cleared when the score falls below the release threshold.
   */
  blocked: boolean;
  /** Timestamp of the last accepted sample (-Infinity before the first). */
  t_last: number;
}

const NO_EVENTS: readonly GestureEvent[] = Object.freeze([]);

export function createGestureState(): GestureState {
  return {
    press: createPressMachineState(),
    signal: false,
    above: false,
    aboveSince: 0,
    reached: false,
    blocked: false,
    t_last: -Infinity,
  };
}

export function cloneGestureState(s: GestureState): GestureState {
  return { ...s, press: clonePressMachineState(s.press) };
}

/** The score for `profile.switchGesture`; a missing or non-finite value counts as 0. */
export function switchGestureScore(scores: GestureScores, profile: Profile): number {
  const v = profile.switchGesture === 'jaw open' ? scores.jawOpen : scores.browRaise;
  return Number.isFinite(v) ? v : 0;
}

/** Return the press machine to IDLE without any event, keeping its clock. */
function resetPress(s: GestureState): void {
  s.press.state = PressState.IDLE;
}

/**
 * Drop any gesture in progress without an event (a cancel from elsewhere). A gesture
 * that is under way cannot press until the score has fallen below the release threshold.
 */
export function dropGesture(s: GestureState): void {
  if (s.above || s.signal || s.press.state !== PressState.IDLE) s.blocked = true;
  s.signal = false;
  s.above = false;
  s.reached = false;
  resetPress(s);
}

/**
 * Advance the gesture engine by one camera sample. Mutates `state` in place.
 * The returned array is shared and frozen when empty. Do not mutate it.
 */
export function stepGesture(
  state: GestureState,
  input: GestureInput,
  now: number,
  profile: Profile,
): GestureEvent[] {
  // Req 9 AC 4: duplicate, backwards or non-finite timestamps change nothing.
  if (!Number.isFinite(now) || !(now > state.t_last)) return NO_EVENTS as GestureEvent[];
  state.t_last = now;

  if (input.gestureScores === null || input.gestureScores === undefined) {
    // Req 5 AC 6: no face, no press. A gesture in progress is dropped silently (no press,
    // no cancel), and the person must release before a new gesture can count.
    if (state.above || state.signal || state.press.state !== PressState.IDLE) state.blocked = true;
    state.signal = false;
    state.above = false;
    state.reached = false;
    resetPress(state);
    // Keep the press machine's clock in step so its input timeout measures camera silence.
    state.press.t_last = now;
    return NO_EVENTS as GestureEvent[];
  }

  const v = switchGestureScore(input.gestureScores, profile);
  const thr = profile.gestureThreshold;
  const rel = profile.gestureReleaseThreshold;

  // Gesture start and end, on the release threshold (as the head-pointer freeze).
  if (!state.above && v > rel) {
    state.above = true;
    state.aboveSince = now;
    state.reached = false;
  } else if (state.above && v < rel) {
    state.above = false;
    state.reached = false;
  }
  // Released: a blocked gesture may count again from the next activation.
  if (v < rel) state.blocked = false;

  // Signal with hysteresis (design §3).
  if (v >= thr) state.signal = true;
  else if (v < rel) state.signal = false;

  // Head + gesture: a gesture that did not reach the threshold within the freeze window
  // must not press later, because its freeze has already expired (design §4).
  if (profile.mode === 'head + gesture' && state.above && !state.reached && !state.blocked) {
    if (v >= thr && now - state.aboveSince <= profile.gestureAcceptanceTime + FREEZE_EXPIRY_EXTRA_MS) {
      state.reached = true;
    } else if (now - state.aboveSince >= profile.gestureAcceptanceTime + FREEZE_EXPIRY_EXTRA_MS) {
      state.blocked = true;
    }
  }
  if (v >= thr) state.reached = true;

  const signal = state.signal && !state.blocked;
  return stepPress(state.press, signal, now, profile, profile.gestureAcceptanceTime);
}
