/**
 * The keyboard, mouse and gamepad adapters (Task 14.6, design §7), with a fake window,
 * fake animation frames and fake gamepads.
 */
import { describe, expect, it } from 'vitest';
import type { TimestampedSample } from '../src/api-types';
import { createGamepadAdapter, gamepadButton } from '../src/adapters/gamepad-adapter';
import type { InputSink } from '../src/adapters/input-env';
import { createKeyboardAdapter, isKeyBinding } from '../src/adapters/keyboard-adapter';
import { createMouseAdapter, switchButton } from '../src/adapters/mouse-adapter';
import { defaultProfile, type Profile } from '../src/engine/profile';
import { createPlanchetteInternal } from '../src/planchette';
import { FakeInputEnv } from './fakes';

function sink(profile: Partial<Profile> = {}): InputSink & { samples: TimestampedSample[]; p: Profile } {
  const p: Profile = { ...defaultProfile, ...profile };
  const samples: TimestampedSample[] = [];
  return { p, samples, profile: () => p, feed: (s) => samples.push(s) };
}

describe('keyboard adapter', () => {
  it('sends one sample per animation frame, each with the current signal', () => {
    const env = new FakeInputEnv();
    const s = sink();
    createKeyboardAdapter(env, s);
    env.frames.step(16);
    env.dispatch('keydown', { key: ' ' });
    env.frames.step(32);
    env.frames.step(48);
    env.dispatch('keyup', { key: ' ' });
    env.frames.step(64);
    expect(s.samples).toEqual([
      { now: 16, source: 'keyboard', signal: false },
      { now: 32, source: 'keyboard', signal: true },
      { now: 48, source: 'keyboard', signal: true },
      { now: 64, source: 'keyboard', signal: false },
    ]);
    for (const x of s.samples) expect(typeof x.signal).toBe('boolean');
  });

  it('several key events between two frames still give one sample', () => {
    const env = new FakeInputEnv();
    const s = sink();
    createKeyboardAdapter(env, s);
    env.dispatch('keydown', { key: ' ' });
    env.dispatch('keyup', { key: ' ' });
    env.dispatch('keydown', { key: ' ' });
    env.frames.step(10);
    expect(s.samples).toEqual([{ now: 10, source: 'keyboard', signal: true }]);
  });

  it('only the switch binding key counts', () => {
    const env = new FakeInputEnv();
    const s = sink({ switchBinding: 'Enter' });
    createKeyboardAdapter(env, s);
    env.dispatch('keydown', { key: ' ' });
    env.frames.step(10);
    env.dispatch('keydown', { key: 'Enter' });
    env.frames.step(20);
    expect(s.samples.map((x) => x.signal)).toEqual([false, true]);
  });

  it('follows a change of binding on the next frame', () => {
    const env = new FakeInputEnv();
    const s = sink();
    createKeyboardAdapter(env, s);
    env.dispatch('keydown', { key: 'Enter' });
    env.frames.step(10);
    s.p.switchBinding = 'Enter';
    env.frames.step(20);
    expect(s.samples.map((x) => x.signal)).toEqual([false, true]);
  });

  it('a mouse or gamepad binding is not a key: the keyboard signal stays false', () => {
    for (const binding of ['MouseLeft', 'GamepadButton0']) {
      const env = new FakeInputEnv();
      const s = sink({ switchBinding: binding });
      createKeyboardAdapter(env, s);
      env.dispatch('keydown', { key: binding });
      env.frames.step(10);
      expect(s.samples[0].signal).toBe(false);
    }
    expect(isKeyBinding(' ')).toBe(true);
    expect(isKeyBinding('MouseLeft')).toBe(false);
  });

  it('Escape sets cancel: true on the next sample only, which still carries the signal', () => {
    const env = new FakeInputEnv();
    const s = sink();
    createKeyboardAdapter(env, s);
    env.dispatch('keydown', { key: ' ' });
    env.dispatch('keydown', { key: 'Escape' });
    env.frames.step(10);
    env.frames.step(20);
    expect(s.samples).toEqual([
      { now: 10, source: 'keyboard', signal: true, cancel: true },
      { now: 20, source: 'keyboard', signal: true },
    ]);
  });

  it('a held Escape (key repeat) cancels once', () => {
    const env = new FakeInputEnv();
    const s = sink();
    createKeyboardAdapter(env, s);
    env.dispatch('keydown', { key: 'Escape' });
    env.frames.step(10);
    env.dispatch('keydown', { key: 'Escape', repeat: true });
    env.frames.step(20);
    expect(s.samples.filter((x) => x.cancel === true)).toHaveLength(1);
  });

  it('stops the bound key from scrolling the page, but leaves other keys alone', () => {
    const env = new FakeInputEnv();
    createKeyboardAdapter(env, sink());
    expect(env.dispatch('keydown', { key: ' ' }).defaultPrevented).toBe(true);
    expect(env.dispatch('keydown', { key: 'a' }).defaultPrevented).toBe(false);
  });

  it('ignores keys typed into a text field', () => {
    const env = new FakeInputEnv();
    const s = sink();
    createKeyboardAdapter(env, s);
    env.dispatch('keydown', { key: ' ', target: { tagName: 'INPUT' } });
    env.dispatch('keydown', { key: 'Escape', target: { tagName: 'textarea' } });
    env.dispatch('keydown', { key: ' ', target: { isContentEditable: true } });
    env.frames.step(10);
    expect(s.samples).toEqual([{ now: 10, source: 'keyboard', signal: false }]);
  });

  it('releases a held key when the window loses focus (no keyup arrives then)', () => {
    const env = new FakeInputEnv();
    const s = sink();
    createKeyboardAdapter(env, s);
    env.dispatch('keydown', { key: ' ' });
    env.frames.step(10);
    env.dispatch('blur');
    env.frames.step(20);
    expect(s.samples.map((x) => x.signal)).toEqual([true, false]);
  });

  it('has its own lastNow: a frame time that has not advanced sends nothing', () => {
    const env = new FakeInputEnv();
    const s = sink();
    createKeyboardAdapter(env, s);
    env.frames.step(10);
    env.frames.step(10);
    env.frames.step(5);
    env.frames.step(11);
    expect(s.samples.map((x) => x.now)).toEqual([10, 11]);
  });

  it('stop() removes its listeners and its frame callback', () => {
    const env = new FakeInputEnv();
    const s = sink();
    const a = createKeyboardAdapter(env, s);
    a.stop();
    expect(env.listenerCount).toBe(0);
    expect(env.frames.pending).toBe(0);
    env.frames.step(10);
    expect(s.samples).toEqual([]);
  });
});

describe('gamepad adapter', () => {
  it('sends one sample per frame with the bound button state, read from the pads', () => {
    const env = new FakeInputEnv();
    const s = sink({ switchBinding: 'GamepadButton2' });
    createGamepadAdapter(env, s);
    env.frames.step(10);
    env.gamepads = [null, env.pad([2])];
    env.frames.step(20);
    env.gamepads = [env.pad([0, 1])];
    env.frames.step(30);
    expect(s.samples).toEqual([
      { now: 10, source: 'gamepad', signal: false },
      { now: 20, source: 'gamepad', signal: true },
      { now: 30, source: 'gamepad', signal: false },
    ]);
  });

  it('with a binding that is not a gamepad button the signal is false on every frame', () => {
    const env = new FakeInputEnv();
    const s = sink({ switchBinding: ' ' });
    env.gamepads = [env.pad([0, 1, 2, 3])];
    createGamepadAdapter(env, s);
    env.frames.step(10);
    env.frames.step(20);
    expect(s.samples.map((x) => x.signal)).toEqual([false, false]);
    expect(gamepadButton('GamepadButton11')).toBe(11);
    expect(gamepadButton(' ')).toBeNull();
  });

  it('a button index the pad does not have is not pressed', () => {
    const env = new FakeInputEnv();
    const s = sink({ switchBinding: 'GamepadButton40' });
    env.gamepads = [env.pad([0])];
    createGamepadAdapter(env, s);
    env.frames.step(10);
    expect(s.samples[0].signal).toBe(false);
  });

  it('keeps its own lastNow and stops cleanly', () => {
    const env = new FakeInputEnv();
    const s = sink({ switchBinding: 'GamepadButton0' });
    const a = createGamepadAdapter(env, s);
    env.frames.step(10);
    env.frames.step(10);
    a.stop();
    env.frames.step(20);
    expect(s.samples.map((x) => x.now)).toEqual([10]);
  });
});

describe('mouse adapter', () => {
  it('sends one sample per frame with the pointer once the mouse has moved', () => {
    const env = new FakeInputEnv();
    const s = sink({ mode: 'mouse' });
    createMouseAdapter(env, s);
    env.frames.step(10);
    env.dispatch('pointermove', { clientX: 120, clientY: 40 });
    env.dispatch('pointermove', { clientX: 130, clientY: 45 });
    env.frames.step(20);
    expect(s.samples).toEqual([
      { now: 10, source: 'mouse', signal: false },
      { now: 20, source: 'mouse', signal: false, pointer: { x: 130, y: 45 } },
    ]);
  });

  it('in mouse mode the left button is the switch', () => {
    const env = new FakeInputEnv();
    const s = sink({ mode: 'mouse' });
    createMouseAdapter(env, s);
    env.dispatch('pointerdown', { clientX: 5, clientY: 6, button: 0 });
    env.frames.step(10);
    env.dispatch('pointerup', { clientX: 5, clientY: 6, button: 0 });
    env.frames.step(20);
    expect(s.samples.map((x) => x.signal)).toEqual([true, false]);
  });

  it('in other modes a mouse button counts only when it is the switch binding', () => {
    const env = new FakeInputEnv();
    const s = sink({ mode: 'scan', switchBinding: ' ' });
    createMouseAdapter(env, s);
    env.dispatch('pointerdown', { clientX: 5, clientY: 6, button: 0 });
    env.frames.step(10);
    s.p.switchBinding = 'MouseLeft';
    env.frames.step(20);
    s.p.switchBinding = 'MouseRight';
    env.frames.step(30);
    env.dispatch('pointerdown', { clientX: 5, clientY: 6, button: 2 });
    env.frames.step(40);
    expect(s.samples.map((x) => x.signal)).toEqual([false, true, false, true]);
    expect(switchButton({ ...defaultProfile, mode: 'head + dwell' })).toBeNull();
  });

  it('pointercancel and losing focus release the button', () => {
    for (const release of ['pointercancel', 'blur']) {
      const env = new FakeInputEnv();
      const s = sink({ mode: 'mouse' });
      createMouseAdapter(env, s);
      env.dispatch('pointerdown', { clientX: 5, clientY: 6, button: 0 });
      env.frames.step(10);
      env.dispatch(release);
      env.frames.step(20);
      expect(s.samples.map((x) => x.signal), release).toEqual([true, false]);
    }
  });

  it('stop() removes its listeners and its frame callback', () => {
    const env = new FakeInputEnv();
    const a = createMouseAdapter(env, sink());
    a.stop();
    expect(env.listenerCount).toBe(0);
    expect(env.frames.pending).toBe(0);
  });
});

describe('the adapters wired into createPlanchette', () => {
  function setup(profile: Partial<Profile>, inputs?: false | { keyboard?: boolean; mouse?: boolean; gamepad?: boolean }) {
    const env = new FakeInputEnv();
    const { planchette: p, inspect } = createPlanchetteInternal(
      { screen: { width: 1000, height: 800 }, profile, inputs },
      { input: env },
    );
    const log: Array<{ type: string; detail: unknown }> = [];
    for (const type of ['select', 'cancel', 'highlight', 'pointer-move'] as const) {
      p.addEventListener(type, (e) => log.push({ type, detail: (e as CustomEvent).detail }));
    }
    let t = 0;
    const frames = (n: number) => {
      for (let i = 0; i < n; i++) env.frames.step((t += 16));
    };
    return { env, p, inspect, log, frames };
  }

  it('a Space press scans and selects; Escape cancels', () => {
    const { env, p, log, frames } = setup({ mode: 'scan', cancelByHold: false, scanInterval: 2000 });
    p.registerTarget('a', { x: 0, y: 0, width: 10, height: 10 });
    frames(3);
    env.dispatch('keydown', { key: ' ' });
    frames(3);
    env.dispatch('keyup', { key: ' ' });
    frames(3);
    expect(log.filter((l) => l.type === 'select')).toHaveLength(1);
    env.dispatch('keydown', { key: 'Escape' });
    frames(1);
    expect(log.filter((l) => l.type === 'cancel')).toHaveLength(1);
  });

  it('holding Space for the cancel hold time cancels: the held signal reaches the press machine on every frame', () => {
    const { env, p, log, frames } = setup({ mode: 'scan', cancelByHold: true, cancelHoldTime: 1000 });
    p.registerTarget('a', { x: 0, y: 0, width: 10, height: 10 });
    frames(2);
    env.dispatch('keydown', { key: ' ' });
    frames(70); // 1120 ms
    env.dispatch('keyup', { key: ' ' });
    frames(2);
    expect(log.filter((l) => l.type === 'cancel')).toHaveLength(1);
    expect(log.filter((l) => l.type === 'select')).toEqual([]);
  });

  it('a mouse click selects in mouse mode', () => {
    const { env, p, log, frames } = setup({ mode: 'mouse', cancelByHold: false });
    p.registerTarget('a', { x: 0, y: 0, width: 100, height: 100 });
    env.dispatch('pointermove', { clientX: 50, clientY: 50 });
    frames(2);
    env.dispatch('pointerdown', { clientX: 50, clientY: 50, button: 0 });
    frames(2);
    env.dispatch('pointerup', { clientX: 50, clientY: 50, button: 0 });
    frames(2);
    expect(log.filter((l) => l.type === 'select').map((l) => (l.detail as { targetId: string }).targetId)).toEqual(['a']);
  });

  it('a gamepad button press scans', () => {
    const { env, p, log, frames } = setup({ mode: 'scan', cancelByHold: false, switchBinding: 'GamepadButton0', scanInterval: 2000 });
    p.registerTarget('a', { x: 0, y: 0, width: 10, height: 10 });
    frames(2);
    env.gamepads = [env.pad([0])];
    frames(3);
    env.gamepads = [env.pad([])];
    frames(3);
    expect(log.filter((l) => l.type === 'select')).toHaveLength(1);
  });

  it('inputs: false listens to nothing; a partial set listens to those only; destroy() removes them', () => {
    expect(setup({}, false).env.listenerCount).toBe(0);
    const only = setup({}, { mouse: false, gamepad: false });
    expect([...only.env.listeners.keys()].sort()).toEqual(['blur', 'keydown', 'keyup']);
    const all = setup({});
    expect(all.env.listenerCount).toBeGreaterThan(0);
    all.p.destroy();
    expect(all.env.listenerCount).toBe(0);
    expect(all.env.frames.pending).toBe(0);
  });

  it('without a browser (Node) createPlanchette starts no adapter', () => {
    const p = createPlanchetteInternal({ screen: { width: 10, height: 10 } }).planchette;
    expect(() => p.destroy()).not.toThrow();
  });
});
