/**
 * keyboard-adapter.ts — the keyboard as a switch, and Escape as cancel (design §7).
 *
 * One sample per animation frame: `{ now, source: 'keyboard', signal }`, where `signal`
 * is whether the profile's switch binding key is held. Every sample carries `signal`,
 * true or false, because a sample without it counts as released. The frame after Escape
 * is pressed also carries `cancel: true`.
 */
import { frameLoop, isEditable, type InputAdapter, type InputEnvironment, type InputSink, type KeyEventLike } from './input-env.js';

/** The switch binding is a key name (KeyboardEvent.key) unless it names a mouse or gamepad button. */
export function isKeyBinding(binding: string): boolean {
  return !/^(Mouse|Gamepad)/.test(binding);
}

export function createKeyboardAdapter(env: InputEnvironment, sink: InputSink): InputAdapter {
  const down = new Set<string>();
  let cancelPending = false;

  const onKeyDown = (e: KeyEventLike): void => {
    if (isEditable(e.target)) return;
    if (e.key === 'Escape') {
      if (e.repeat !== true) cancelPending = true;
      return;
    }
    const binding = sink.profile().switchBinding;
    if (isKeyBinding(binding) && e.key === binding) e.preventDefault?.(); // e.g. Space would scroll the page
    down.add(e.key);
  };
  const onKeyUp = (e: KeyEventLike): void => {
    down.delete(e.key);
  };
  // A key released while the window was not focused sends no keyup: release everything.
  const onBlur = (): void => {
    down.clear();
  };
  env.addEventListener('keydown', onKeyDown);
  env.addEventListener('keyup', onKeyUp);
  env.addEventListener('blur', onBlur);

  const loop = frameLoop(env, sink, (now) => {
    const binding = sink.profile().switchBinding;
    const signal = isKeyBinding(binding) && down.has(binding);
    if (cancelPending) {
      cancelPending = false;
      return { now, source: 'keyboard', signal, cancel: true };
    }
    return { now, source: 'keyboard', signal };
  });

  return {
    stop(): void {
      loop.stop();
      env.removeEventListener('keydown', onKeyDown);
      env.removeEventListener('keyup', onKeyUp);
      env.removeEventListener('blur', onBlur);
    },
  };
}
