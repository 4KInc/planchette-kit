/**
 * switch.ts — key, mouse-button and gamepad-button switch (Req 4 AC 5–7, Req 6 AC 2–3).
 *
 * Turns a held/released level into presses and cancels with the shared press machine,
 * using the profile's switch acceptance time. The gesture engine does the same with the
 * gesture acceptance time.
 *
 * Pure logic: time is an input (`now`); no clocks, DOM or devices.
 */
import type { Profile } from './profile.js';
import {
  createPressMachineState,
  clonePressMachineState,
  stepPress,
  type PressEvent,
  type PressMachineState,
} from './press-machine.js';

export type SwitchEvent = PressEvent;
export type SwitchState = PressMachineState;

export function createSwitchState(): SwitchState {
  return createPressMachineState();
}

export function cloneSwitchState(s: SwitchState): SwitchState {
  return clonePressMachineState(s);
}

/**
 * Advance the switch by one sample. `signal` is the current level (held or not).
 * Mutates `state` in place. The returned array is shared and frozen when empty.
 */
export function stepSwitch(
  state: SwitchState,
  signal: boolean,
  now: number,
  profile: Profile,
): SwitchEvent[] {
  return stepPress(state, signal, now, profile, profile.switchAcceptanceTime);
}
