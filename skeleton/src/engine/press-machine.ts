/**
 * press-machine.ts — shared press / cancel-hold state machine (design §3).
 *
 * Used by the switch and gesture engines; only the signal source differs.
 * Pure logic: time comes in as `now`, no clocks, DOM or devices (Req 9 AC 1).
 * Depends only on profile.ts (type import).
 *
 * Post-selection pause is not handled here. Consumers (dwell, scan) apply it.
 */

import type { Profile } from './profile.js';

export enum PressState {
  IDLE = 'IDLE',
  PENDING_ACCEPT = 'PENDING_ACCEPT',
  ARMED = 'ARMED',
  ARMED_HOLD_WAIT = 'ARMED_HOLD_WAIT',
  COOLDOWN = 'COOLDOWN',
}

export interface PressMachineState {
  state: PressState;
  /** Timestamp at which the current activation started. */
  t_down: number;
  /** Timestamp of the last accepted sample (-Infinity before the first). */
  t_last: number;
}

export type PressEvent = { type: 'press' } | { type: 'cancel' };

const NO_EVENTS: readonly PressEvent[] = Object.freeze([]);

export function createPressMachineState(): PressMachineState {
  return { state: PressState.IDLE, t_down: 0, t_last: -Infinity };
}

export function clonePressMachineState(s: PressMachineState): PressMachineState {
  return { state: s.state, t_down: s.t_down, t_last: s.t_last };
}

/**
 * Advance the machine by one sample. Mutates `state` in place.
 *
 * `signal` is the current level (held or not), sent on every frame.
 * `acceptanceTime` is required so a caller cannot silently use the wrong one:
 * the switch engine passes `profile.switchAcceptanceTime`, the gesture engine
 * `profile.gestureAcceptanceTime`.
 *
 * The returned array is shared and frozen when empty. Do not mutate it.
 */
export function stepPress(
  state: PressMachineState,
  signal: boolean,
  now: number,
  profile: Profile,
  acceptanceTime: number,
): PressEvent[] {
  // Req 9 AC 4: duplicate, backwards or non-finite timestamps change nothing.
  if (!Number.isFinite(now) || !(now > state.t_last)) {
    return NO_EVENTS as PressEvent[];
  }

  // "any / no sample for inputTimeout ms": reset silently, then handle this
  // sample as a fresh one.
  if (now - state.t_last >= profile.inputTimeout) {
    state.state = PressState.IDLE;
  }
  state.t_last = now;

  let events: PressEvent[] | null = null;

  if (state.state === PressState.IDLE) {
    if (signal) {
      state.t_down = now;
      state.state = PressState.PENDING_ACCEPT;
    }
  }

  if (state.state === PressState.PENDING_ACCEPT) {
    if (!signal) {
      // Released before the acceptance time was reached: ignored (P7).
      state.state = PressState.IDLE;
    } else if (now - state.t_down >= acceptanceTime) {
      if (profile.cancelByHold) {
        state.state = PressState.ARMED_HOLD_WAIT;
      } else {
        events = [{ type: 'press' }];
        state.state = PressState.ARMED;
      }
    }
  } else if (state.state === PressState.ARMED) {
    if (!signal) state.state = PressState.IDLE;
  }

  if (state.state === PressState.ARMED_HOLD_WAIT) {
    if (now - state.t_down >= profile.cancelHoldTime) {
      // The hold reached the cancel hold time. This wins over a release in the
      // same sample, so a hold that reached it never produces a press (P18).
      events = [{ type: 'cancel' }];
      state.state = signal ? PressState.COOLDOWN : PressState.IDLE;
    } else if (!signal) {
      events = [{ type: 'press' }];
      state.state = PressState.IDLE;
    }
  } else if (state.state === PressState.COOLDOWN) {
    if (!signal) state.state = PressState.IDLE;
  }

  return events ?? (NO_EVENTS as PressEvent[]);
}
