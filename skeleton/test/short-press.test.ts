/**
 * Short presses (design §7 "Short presses"): a key or button that goes down and up inside
 * one animation frame still counts, with its real down and up times from the events'
 * own timestamps. With fake events and fake frames.
 */
import { describe, expect, it } from 'vitest';
import type { TimestampedSample } from '../src/api-types';
import type { InputSink } from '../src/adapters/input-env';
import { createKeyboardAdapter } from '../src/adapters/keyboard-adapter';
import { createMouseAdapter } from '../src/adapters/mouse-adapter';
import { defaultProfile, type Profile } from '../src/engine/profile';
import { createPlanchetteInternal } from '../src/planchette';
import { FakeInputEnv } from './fakes';

function sink(profile: Partial<Profile> = {}): InputSink & { samples: TimestampedSample[] } {
  const p: Profile = { ...defaultProfile, ...profile };
  const samples: TimestampedSample[] = [];
  return { samples, profile: () => p, feed: (s) => samples.push(s) };
}
const signals = (s: TimestampedSample[]) => s.map((x) => [x.now, x.signal]);
const increasing = (s: TimestampedSample[]) => s.every((x, i) => i === 0 || x.now > s[i - 1].now);

describe('keyboard adapter: edges between frames', () => {
  it('a 5 ms tap inside one frame sends its down and up at the events\' own times', () => {
    const env = new FakeInputEnv();
    const s = sink();
    createKeyboardAdapter(env, s);
    env.frames.step(16);
    env.dispatch('keydown', { key: ' ', timeStamp: 20 });
    env.dispatch('keyup', { key: ' ', timeStamp: 25 });
    env.frames.step(32);
    expect(signals(s.samples)).toEqual([[16, false], [20, true], [25, false], [32, false]]);
  });

  it('holding is still one sample per frame', () => {
    const env = new FakeInputEnv();
    const s = sink();
    createKeyboardAdapter(env, s);
    env.frames.step(16);
    env.dispatch('keydown', { key: ' ', timeStamp: 20 });
    env.frames.step(32);
    env.dispatch('keydown', { key: ' ', repeat: true, timeStamp: 40 }); // auto-repeat: not an edge
    env.frames.step(48);
    env.dispatch('keyup', { key: ' ', timeStamp: 50 });
    env.frames.step(64);
    expect(signals(s.samples)).toEqual([[16, false], [20, true], [32, true], [48, true], [50, false], [64, false]]);
  });

  it('down, up, down inside one frame: the bounce is dropped, the key stays held', () => {
    const env = new FakeInputEnv();
    const s = sink();
    createKeyboardAdapter(env, s);
    env.frames.step(16);
    env.dispatch('keydown', { key: ' ', timeStamp: 20 });
    env.dispatch('keyup', { key: ' ', timeStamp: 22 });
    env.dispatch('keydown', { key: ' ', timeStamp: 24 });
    env.frames.step(32);
    expect(signals(s.samples)).toEqual([[16, false], [20, true], [32, true]]);
  });

  it('a key held over the frame, released and pressed again inside the next: nothing new', () => {
    const env = new FakeInputEnv();
    const s = sink();
    createKeyboardAdapter(env, s);
    env.dispatch('keydown', { key: ' ', timeStamp: 5 });
    env.frames.step(16);
    env.dispatch('keyup', { key: ' ', timeStamp: 20 });
    env.dispatch('keydown', { key: ' ', timeStamp: 22 });
    env.frames.step(32);
    expect(signals(s.samples)).toEqual([[5, true], [16, true], [32, true]]);
  });

  it('a press and release in the same millisecond keep increasing times', () => {
    const env = new FakeInputEnv();
    const s = sink();
    createKeyboardAdapter(env, s);
    env.frames.step(16);
    env.dispatch('keydown', { key: ' ', timeStamp: 20 });
    env.dispatch('keyup', { key: ' ', timeStamp: 20 });
    env.frames.step(32);
    expect(increasing(s.samples)).toBe(true);
    expect(s.samples.map((x) => x.signal)).toEqual([false, true, false, false]);
  });

  it('an edge later than the next frame time still keeps the times increasing', () => {
    const env = new FakeInputEnv();
    const s = sink();
    createKeyboardAdapter(env, s);
    env.frames.step(16);
    env.dispatch('keydown', { key: ' ', timeStamp: 40 });
    env.dispatch('keyup', { key: ' ', timeStamp: 45 });
    env.frames.step(32);
    env.frames.step(48);
    expect(increasing(s.samples)).toBe(true);
    expect(s.samples.map((x) => x.signal)).toEqual([false, true, false, false]);
  });
});

describe('mouse adapter: edges between frames', () => {
  it('a 5 ms click sends its down and up with the pointer position of each event', () => {
    const env = new FakeInputEnv();
    const s = sink({ mode: 'mouse' });
    createMouseAdapter(env, s);
    env.frames.step(16);
    env.dispatch('pointerdown', { clientX: 30, clientY: 40, button: 0, timeStamp: 20 });
    env.dispatch('pointerup', { clientX: 30, clientY: 40, button: 0, timeStamp: 25 });
    env.frames.step(32);
    expect(s.samples).toEqual([
      { now: 16, source: 'mouse', signal: false },
      { now: 20, source: 'mouse', signal: true, pointer: { x: 30, y: 40 } },
      { now: 25, source: 'mouse', signal: false, pointer: { x: 30, y: 40 } },
      { now: 32, source: 'mouse', signal: false, pointer: { x: 30, y: 40 } },
    ]);
  });

  it('a button that is not the switch sends no edge', () => {
    const env = new FakeInputEnv();
    const s = sink({ mode: 'mouse' });
    createMouseAdapter(env, s);
    env.dispatch('pointerdown', { clientX: 1, clientY: 1, button: 2, timeStamp: 20 });
    env.dispatch('pointerup', { clientX: 1, clientY: 1, button: 2, timeStamp: 25 });
    env.frames.step(32);
    expect(s.samples.map((x) => x.signal)).toEqual([false]);
  });

  it('in a mode where the mouse is not a switch, no edge is sent', () => {
    const env = new FakeInputEnv();
    const s = sink({ mode: 'scan' });
    createMouseAdapter(env, s);
    env.dispatch('pointerdown', { clientX: 1, clientY: 1, button: 0, timeStamp: 20 });
    env.dispatch('pointerup', { clientX: 1, clientY: 1, button: 0, timeStamp: 25 });
    env.frames.step(32);
    expect(s.samples.map((x) => x.signal)).toEqual([false]);
  });
});

describe('short presses through createPlanchette', () => {
  function setup(profile: Partial<Profile>) {
    const env = new FakeInputEnv();
    const { planchette: p } = createPlanchetteInternal({ screen: { width: 1000, height: 800 }, profile }, { input: env });
    const selects: Array<{ targetId: string; source: string }> = [];
    p.addEventListener('select', (e) => selects.push({ targetId: e.detail.targetId, source: e.detail.source }));
    p.registerTarget('a', { x: 100, y: 100, width: 50, height: 50 });
    let t = 0;
    const frames = (n: number) => {
      for (let i = 0; i < n; i++) env.frames.step((t += 16));
    };
    return { env, p, selects, frames };
  }
  const tap = (env: FakeInputEnv, key: string, at: number, ms: number) => {
    env.dispatch('keydown', { key, timeStamp: at });
    env.dispatch('keyup', { key, timeStamp: at + ms });
  };

  it('scan mode, acceptance 0: a 5 ms key tap selects exactly once', () => {
    const { env, selects, frames } = setup({ mode: 'scan', cancelByHold: false, scanInterval: 5000, switchAcceptanceTime: 0 });
    frames(3); // t = 48: the item is highlighted
    tap(env, ' ', 50, 5);
    frames(5);
    expect(selects).toEqual([{ targetId: 'a', source: 'scan' }]);
  });

  it('scan mode, acceptance 100: a 5 ms key tap selects nothing', () => {
    const { env, selects, frames } = setup({ mode: 'scan', cancelByHold: false, scanInterval: 5000, switchAcceptanceTime: 100 });
    frames(3);
    tap(env, ' ', 50, 5);
    frames(5);
    expect(selects).toEqual([]);
  });

  it('scan mode, acceptance 100: a 150 ms key press still selects', () => {
    const { env, selects, frames } = setup({ mode: 'scan', cancelByHold: false, scanInterval: 5000, switchAcceptanceTime: 100 });
    frames(3);
    env.dispatch('keydown', { key: ' ', timeStamp: 50 });
    frames(10); // t = 208
    env.dispatch('keyup', { key: ' ', timeStamp: 200 });
    frames(2);
    expect(selects).toHaveLength(1);
  });

  it('scan mode, acceptance 0: a 5 ms click of the mouse switch selects exactly once', () => {
    const { env, selects, frames } = setup({ mode: 'scan', cancelByHold: false, scanInterval: 5000, switchBinding: 'MouseLeft' });
    frames(3);
    env.dispatch('pointerdown', { clientX: 5, clientY: 5, button: 0, timeStamp: 50 });
    env.dispatch('pointerup', { clientX: 5, clientY: 5, button: 0, timeStamp: 55 });
    frames(5);
    expect(selects).toEqual([{ targetId: 'a', source: 'scan' }]);
  });

  it('scan mode, acceptance 100: a 5 ms click of the mouse switch selects nothing', () => {
    const { env, selects, frames } = setup({ mode: 'scan', cancelByHold: false, scanInterval: 5000, switchBinding: 'MouseLeft', switchAcceptanceTime: 100 });
    frames(3);
    env.dispatch('pointerdown', { clientX: 5, clientY: 5, button: 0, timeStamp: 50 });
    env.dispatch('pointerup', { clientX: 5, clientY: 5, button: 0, timeStamp: 55 });
    frames(5);
    expect(selects).toEqual([]);
  });

  it('mouse mode, acceptance 0: a 5 ms click on a target selects it once; at 100 it does not', () => {
    for (const [acceptance, expected] of [[0, 1], [100, 0]] as const) {
      const { env, selects, frames } = setup({ mode: 'mouse', cancelByHold: false, switchAcceptanceTime: acceptance });
      frames(2);
      env.dispatch('pointerdown', { clientX: 120, clientY: 120, button: 0, timeStamp: 40 });
      env.dispatch('pointerup', { clientX: 120, clientY: 120, button: 0, timeStamp: 45 });
      frames(4);
      expect(selects).toHaveLength(expected);
      if (expected === 1) expect(selects[0]).toEqual({ targetId: 'a', source: 'mouse' });
    }
  });

  it('down, up, down inside one frame selects once and the key is still held afterwards', () => {
    const { env, selects, frames } = setup({ mode: 'scan', cancelByHold: false, scanInterval: 5000 });
    frames(3);
    env.dispatch('keydown', { key: ' ', timeStamp: 50 });
    env.dispatch('keyup', { key: ' ', timeStamp: 52 });
    env.dispatch('keydown', { key: ' ', timeStamp: 54 });
    frames(5);
    expect(selects).toHaveLength(1); // one press; still held, so no second one
    env.dispatch('keyup', { key: ' ', timeStamp: 200 });
    frames(2);
    expect(selects).toHaveLength(1);
  });

  it('a quick tap still counts when the page sends the up before the next frame, twice in a row', () => {
    const { env, selects, frames } = setup({ mode: 'scan', cancelByHold: false, scanInterval: 5000, postSelectionPause: 500 });
    frames(3);
    tap(env, ' ', 50, 5);
    frames(40); // past the post-selection pause
    tap(env, ' ', 800, 5);
    frames(3);
    expect(selects).toHaveLength(2);
  });
});
