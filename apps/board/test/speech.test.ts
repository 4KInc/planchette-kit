import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickLocalVoice, speak, type SpeakTimers } from '../src/speech.js';

const voice = (voiceURI: string, localService: boolean): SpeechSynthesisVoice =>
  ({ voiceURI, localService, name: voiceURI, lang: 'en-US', default: false }) as SpeechSynthesisVoice;

class FakeUtterance {
  voice: unknown = null;
  rate = 1;
  private listeners = new Map<string, Array<() => void>>();
  constructor(readonly text: string) {}
  addEventListener(type: string, fn: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  fire(type: string): void {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
}

function setup() {
  const spoken: FakeUtterance[] = [];
  const synth = {
    speak: vi.fn((u: unknown) => void spoken.push(u as FakeUtterance)),
    cancel: vi.fn(),
    getVoices: vi.fn(() => []),
  };
  let pending: (() => void) | undefined;
  const delays: number[] = [];
  const timers: SpeakTimers = {
    setTimeout: vi.fn((fn: () => void, ms: number) => {
      pending = fn;
      delays.push(ms);
      return 1;
    }),
    clearTimeout: vi.fn(),
  };
  return { synth, spoken, timers, delays, fireTimer: () => pending?.() };
}

beforeEach(() => {
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pickLocalVoice', () => {
  it('returns null when every voice is remote', () => {
    expect(pickLocalVoice([voice('a', false), voice('b', false)], 'a')).toBeNull();
  });
  it('returns a local voice from a mixed list', () => {
    const picked = pickLocalVoice([voice('r', false), voice('l', true)], 'r');
    expect(picked?.localService).toBe(true);
    expect(picked?.voiceURI).toBe('l');
  });
  it('prefers the preferred local voice', () => {
    expect(pickLocalVoice([voice('l1', true), voice('l2', true)], 'l2')?.voiceURI).toBe('l2');
  });
});

describe('speak', () => {
  it('with a null voice resolves not spoken, no synth.speak, no timer', async () => {
    const s = setup();
    await expect(speak('hi', { voice: null, rate: 1 }, s.synth, s.timers)).resolves.toEqual({ spoken: false });
    expect(s.synth.speak).not.toHaveBeenCalled();
    expect(s.timers.setTimeout).not.toHaveBeenCalled();
  });

  it('calls synth.speak once with the voice and rate', () => {
    const s = setup();
    const v = voice('l', true);
    void speak('hello', { voice: v, rate: 1.5 }, s.synth, s.timers);
    expect(s.synth.speak).toHaveBeenCalledTimes(1);
    expect(s.spoken[0].voice).toBe(v);
    expect(s.spoken[0].rate).toBe(1.5);
    expect(s.spoken[0].text).toBe('hello');
  });

  it('resolves spoken true on end and clears the timer', async () => {
    const s = setup();
    const p = speak('hi', { voice: voice('l', true), rate: 1 }, s.synth, s.timers);
    s.spoken[0].fire('end');
    await expect(p).resolves.toEqual({ spoken: true });
    expect(s.timers.clearTimeout).toHaveBeenCalled();
  });

  it('resolves spoken false on error, including interrupted', async () => {
    const s = setup();
    const p = speak('hi', { voice: voice('l', true), rate: 1 }, s.synth, s.timers);
    s.spoken[0].fire('error');
    await expect(p).resolves.toEqual({ spoken: false });
    expect(s.timers.clearTimeout).toHaveBeenCalled();
  });

  it('watchdog cancels and resolves not spoken; a later end is ignored', async () => {
    const s = setup();
    const p = speak('hi', { voice: voice('l', true), rate: 1 }, s.synth, s.timers);
    s.fireTimer();
    await expect(p).resolves.toEqual({ spoken: false });
    expect(s.synth.cancel).toHaveBeenCalledTimes(1);
    s.spoken[0].fire('end');
    await expect(p).resolves.toEqual({ spoken: false });
  });

  it('requests max(10000, 150 * length / rate) ms', () => {
    const short = setup();
    void speak('hi', { voice: voice('l', true), rate: 1 }, short.synth, short.timers);
    expect(short.delays).toEqual([10000]);
    const long = setup();
    const text = 'x'.repeat(200);
    void speak(text, { voice: voice('l', true), rate: 0.5 }, long.synth, long.timers);
    expect(long.delays).toEqual([60000]);
  });
});
