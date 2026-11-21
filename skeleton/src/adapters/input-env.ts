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
  /** The event's time on the same clock as the animation-frame time. */
  timeStamp?: number;
  preventDefault?(): void;
}
export interface PointerEventLike {
  clientX: number;
  clientY: number;
  button?: number;
  /** The event's time on the same clock as the animation-frame time. */
  timeStamp?: number;
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

/** One switch press or release, with the event's own time (and the pointer, for the mouse). */
export interface Edge {
  t: number;
  level: boolean;
  pointer?: { x: number; y: number };
}
/**
 * Collects the switch's presses and releases between two animation frames, with their own
 * times, so a press that goes down and up inside one frame still reaches the engine
 * (design §7 "Short presses").
 *
 * A release followed by a new press inside the same frame is a bounce: both edges are
 * dropped, so the switch counts as held all along and down, up, down is one press. An
 * edge that repeats the current level is ignored. An event without a time (a fake, or an
 * old browser) is not queued: the next frame sample carries its level, as before.
 */
export interface EdgeQueue {
  push(level: boolean, timeStamp: number | undefined, pointer?: { x: number; y: number }): void;
  /** The queued edges, oldest first; the queue is emptied. */
  drain(): Edge[];
}
export function createEdgeQueue(): EdgeQueue {
  let level = false; // the level after every edge pushed so far
  let queue: Edge[] = [];
  return {
    push(next, timeStamp, pointer) {
      if (next === level) return;
      level = next;
      if (typeof timeStamp !== 'number' || !Number.isFinite(timeStamp)) return;
      if (next && queue.length > 0 && !queue[queue.length - 1].level) queue.pop(); // up, down: a bounce
      else queue.push(pointer === undefined ? { t: timeStamp, level: next } : { t: timeStamp, level: next, pointer });
    },
    drain() {
      const out = queue;
      queue = [];
      return out;
    },
  };
}
/** The smallest step that keeps one source's timestamps increasing when two edges share a time. */
const NUDGE_MS = 0.001;
/**
 * Run `sample(now)` once per animation frame and send what it returns. Each adapter has
 * its own loop and its own `lastNow`: a frame time that has not advanced is skipped, and
 * it is never compared with another adapter's clock.
 *
 * `edges` (keyboard, mouse): the presses and releases since the last frame. Each is sent
 * first, as a sample at its own time with the level it set (`sample` builds it), and then
 * the frame's sample follows. An edge time that is not later than the last sample sent is
 * moved up by 0.001 ms, so a press and a release in the same millisecond stay in order.
 */
export function frameLoop(
  env: InputEnvironment,
  sink: InputSink,
  sample: (now: number) => TimestampedSample,
  edges?: { drain(): Edge[]; sample(edge: Edge): TimestampedSample },
): InputAdapter {
  let lastNow = -Infinity;
  let stopped = false;
  let id = 0;
  const onFrame = (now: number): void => {
    if (stopped) return;
    if (edges !== undefined) {
      for (const edge of edges.drain()) {
        const t = Math.max(edge.t, lastNow + NUDGE_MS);
        lastNow = t;
        sink.feed(edges.sample({ ...edge, t }));
      }
    }
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
