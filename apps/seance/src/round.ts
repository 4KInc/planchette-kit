/**
 * round.ts: one Round of Séance as a deterministic state machine (design.md, `round.ts`).
 * `stepRound(state, input, now)` updates the small state object in place and returns events.
 * It never reads a clock, `Math.random`, the DOM or storage: time is passed in.
 */
import type { Message } from './spirit-messages.js';
export type RoundStatus = 'playing' | 'complete' | 'stopped';
export interface RoundState {
  readonly message: Message;
  status: RoundStatus;
  /** Hits standing; the current Step is `message.steps[index]`. */
  index: number;
  startedAt: number;
  /** -1 until the Round ends. */
  endedAt: number;
  /** The last accepted timestamp; starts at `startedAt`. */
  lastAt: number;
  /** When the current Step became the next target. */
  stepShownAt: number;
  /** Hits ever made, Taken-back ones included: it counts selections, so none is counted twice or uncounted. */
  hits: number;
  misses: number;
  takenBack: number;
  /** Per Step, ms from shown to Hit; -1 = none standing. */
  readonly stepMs: number[];
}
export type RoundInput =
  | { readonly type: 'select'; readonly target: string }
  | { readonly type: 'undo' }
  | { readonly type: 'stop' };
export type RoundEvent =
  | { readonly type: 'hit'; readonly target: string; readonly index: number; readonly ms: number }
  | { readonly type: 'miss'; readonly target: string; readonly expected: string }
  | { readonly type: 'undone'; readonly index: number }
  | { readonly type: 'complete' }
  | { readonly type: 'stopped' };
export function createRound(message: Message, now: number): RoundState {
  return {
    message,
    status: 'playing',
    index: 0,
    startedAt: now,
    endedAt: -1,
    lastAt: now,
    stepShownAt: now,
    hits: 0,
    misses: 0,
    takenBack: 0,
    stepMs: message.steps.map(() => -1),
  };
}
export function cloneRound(state: RoundState): RoundState {
  return { ...state, stepMs: [...state.stepMs] };
}
const NONE: RoundEvent[] = [];
export function stepRound(state: RoundState, input: RoundInput, now: number): RoundEvent[] {
  if (state.status !== 'playing') return NONE.slice();
  if (input.type === 'stop') {
    state.status = 'stopped';
    state.endedAt = Math.max(now, state.lastAt);
    return [{ type: 'stopped' }];
  }
  // Time is measured, never counted: a stamp that is not later than the last one is ignored.
  if (!(now > state.lastAt)) return NONE.slice();
  state.lastAt = now;
  if (input.type === 'undo') {
    if (state.index === 0) return NONE.slice();
    state.index -= 1;
    state.stepMs[state.index] = -1;
    state.takenBack += 1;
    state.stepShownAt = now;
    return [{ type: 'undone', index: state.index }];
  }
  const steps = state.message.steps;
  const expected = steps[state.index]!;
  if (input.target !== expected) {
    state.misses += 1;
    return [{ type: 'miss', target: input.target, expected }];
  }
  const ms = now - state.stepShownAt;
  const index = state.index;
  state.stepMs[index] = ms;
  state.index += 1;
  state.hits += 1;
  state.stepShownAt = now;
  const events: RoundEvent[] = [{ type: 'hit', target: input.target, index, ms }];
  if (state.index === steps.length) {
    state.status = 'complete';
    state.endedAt = now;
    events.push({ type: 'complete' });
  }
  return events;
}
