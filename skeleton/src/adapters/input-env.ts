/**
 * input-env.ts — what the keyboard, mouse and gamepad adapters need from the browser,
 * and the frame loop they share (design §7). Tests pass a fake environment.
 */
import type { Profile } from '../engine/profile.js';
import type { TimestampedSample } from '../api-types.js';

export interface KeyEventLike {
  key: string;
  repeat?: boolean;
  target?: unknown;
  preventDefault?(): void;
}
export interface PointerEventLike {
  clientX: number;
  clientY: number;
  button?: number;
}
export interface GamepadLike {
  readonly buttons: ReadonlyArray<{ readonly pressed: boolean }>;
}

export interface InputEnvironment {
  addEventListener(type: string, listener: (event: never) => void): void;
  removeEventListener(type: string, listener: (event: never) => void): void;
  /** requestAnimationFrame: the callback gets the frame time in ms. */
  requestFrame(callback: (now: number) => void): number;
  cancelFrame(id: number): void;
  getGamepads(): ReadonlyArray<GamepadLike | null>;
}

export interface InputAdapter {
  stop(): void;
}

/** What an adapter needs from the instance: the live profile and a way to send samples. */
export interface InputSink {
  profile(): Profile;
  feed(sample: TimestampedSample): void;
}

/**
 * Run `sample(now)` once per animation frame and send what it returns. Each adapter has
 * its own loop and its own `lastNow`: a frame time that has not advanced is skipped, and
 * it is never compared with another adapter's clock.
 */
export function frameLoop(env: InputEnvironment, sink: InputSink, sample: (now: number) => TimestampedSample): InputAdapter {
  let lastNow = -Infinity;
  let stopped = false;
  let id = 0;
  const onFrame = (now: number): void => {
    if (stopped) return;
    if (now > lastNow) {
      lastNow = now;
      sink.feed(sample(now));
    }
    if (!stopped) id = env.requestFrame(onFrame);
  };
  id = env.requestFrame(onFrame);
  return {
    stop(): void {
      stopped = true;
      env.cancelFrame(id);
    },
  };
}

/** True when a key event comes from a text field, where keys are typing, not a switch. */
export function isEditable(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const t = target as { isContentEditable?: boolean; tagName?: string };
  if (t.isContentEditable === true) return true;
  const tag = typeof t.tagName === 'string' ? t.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
