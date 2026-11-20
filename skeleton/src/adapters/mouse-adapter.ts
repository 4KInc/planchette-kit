/**
 * mouse-adapter.ts — the mouse pointer, and a mouse button as a switch (design §7).
 *
 * One sample per animation frame: `{ now, source: 'mouse', signal, pointer? }`. `pointer`
 * is the last position in CSS px (viewport coordinates, as getBoundingClientRect), once
 * the mouse has moved. `signal` is whether the button is held, and it counts in mouse mode
 * (a click selects) or when the switch binding is that mouse button; otherwise it is
 * false, so a carer's mouse does not act as the person's switch.
 */
import type { Profile } from '../engine/profile.js';
import { frameLoop, type InputAdapter, type InputEnvironment, type InputSink, type PointerEventLike } from './input-env.js';

const BUTTONS: Record<string, number> = { MouseLeft: 0, MouseMiddle: 1, MouseRight: 2 };

/** The mouse button that is the switch: the binding's button, or the left button in mouse mode. */
export function switchButton(profile: Profile): number | null {
  const b = BUTTONS[profile.switchBinding];
  if (b !== undefined) return b;
  return profile.mode === 'mouse' ? 0 : null;
}

export function createMouseAdapter(env: InputEnvironment, sink: InputSink): InputAdapter {
  let pointer: { x: number; y: number } | null = null;
  const held = new Set<number>();

  const onMove = (e: PointerEventLike): void => {
    pointer = { x: e.clientX, y: e.clientY };
  };
  const onDown = (e: PointerEventLike): void => {
    pointer = { x: e.clientX, y: e.clientY };
    held.add(e.button ?? 0);
  };
  const onUp = (e: PointerEventLike): void => {
    held.delete(e.button ?? 0);
  };
  const onRelease = (): void => {
    held.clear();
  };
  env.addEventListener('pointermove', onMove);
  env.addEventListener('pointerdown', onDown);
  env.addEventListener('pointerup', onUp);
  env.addEventListener('pointercancel', onRelease);
  env.addEventListener('blur', onRelease);

  const loop = frameLoop(env, sink, (now) => {
    const button = switchButton(sink.profile());
    const signal = button !== null && held.has(button);
    return pointer === null ? { now, source: 'mouse', signal } : { now, source: 'mouse', signal, pointer: { x: pointer.x, y: pointer.y } };
  });

  return {
    stop(): void {
      loop.stop();
      env.removeEventListener('pointermove', onMove);
      env.removeEventListener('pointerdown', onDown);
      env.removeEventListener('pointerup', onUp);
      env.removeEventListener('pointercancel', onRelease);
      env.removeEventListener('blur', onRelease);
    },
  };
}
