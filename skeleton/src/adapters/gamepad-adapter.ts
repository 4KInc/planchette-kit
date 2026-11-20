/**
 * gamepad-adapter.ts — a gamepad button as a switch (design §7).
 *
 * One sample per animation frame: `{ now, source: 'gamepad', signal }`. The Gamepad API
 * has no button events, so the adapter reads the pads on every frame. `signal` is whether
 * the bound button (switch binding 'GamepadButton<N>') is pressed on any connected pad;
 * with another binding it is false. Every sample carries `signal`.
 */
import { frameLoop, type InputAdapter, type InputEnvironment, type InputSink } from './input-env.js';

/** The button index of a 'GamepadButton<N>' binding, or null. */
export function gamepadButton(binding: string): number | null {
  const m = /^GamepadButton(\d+)$/.exec(binding);
  return m === null ? null : Number(m[1]);
}

export function createGamepadAdapter(env: InputEnvironment, sink: InputSink): InputAdapter {
  return frameLoop(env, sink, (now) => {
    const button = gamepadButton(sink.profile().switchBinding);
    let signal = false;
    if (button !== null) {
      for (const pad of env.getGamepads()) {
        if (pad !== null && pad.buttons[button]?.pressed === true) signal = true;
      }
    }
    return { now, source: 'gamepad', signal };
  });
}
