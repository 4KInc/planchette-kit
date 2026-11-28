import { describe, expect, it, vi } from 'vitest';
import { createSound, type AudioContextLike } from '../src/sound';
function fakeCtx() {
  const created: FakeCtx[] = [];
  class FakeCtx implements AudioContextLike {
    currentTime = 10;
    destination = {};
    oscillators = 0;
    gains: Array<{ cancelled: number; ramps: Array<[number, number]> }> = [];
    suspended = 0;
    constructor() {
      created.push(this);
    }
    createOscillator() {
      this.oscillators++;
      return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} };
    }
    createGain() {
      const rec = { cancelled: 0, ramps: [] as Array<[number, number]> };
      this.gains.push(rec);
      return {
        gain: {
          setValueAtTime() {},
          linearRampToValueAtTime: (v: number, t: number) => void rec.ramps.push([v, t]),
          cancelScheduledValues: () => void rec.cancelled++,
        },
        connect() {},
      };
    }
    resume() {
      return Promise.resolve();
    }
    suspend() {
      this.suspended++;
      return Promise.resolve();
    }
  }
  return { Ctor: FakeCtx, created };
}
describe('sound', () => {
  it('creates no AudioContext until it is turned on, and only once', () => {
    const { Ctor, created } = fakeCtx();
    const s = createSound(Ctor);
    expect(created).toHaveLength(0);
    s.play('hit');
    expect(created).toHaveLength(0);
    expect(s.setOn(true)).toBe(true);
    s.setOn(false);
    s.setOn(true);
    expect(created).toHaveLength(1);
  });
  it('is silent while off, and plays a tone while on', () => {
    const { Ctor, created } = fakeCtx();
    const s = createSound(Ctor);
    s.setOn(true);
    s.setOn(false);
    s.play('hit');
    expect(created[0]!.oscillators).toBe(0);
    s.setOn(true);
    s.play('hit');
    expect(created[0]!.oscillators).toBe(1);
  });
  it('turning off ramps any live tone to zero and suspends the context', () => {
    const { Ctor, created } = fakeCtx();
    const s = createSound(Ctor);
    s.setOn(true);
    s.play('hit');
    s.setOn(false);
    const c = created[0]!;
    expect(c.suspended).toBe(1);
    expect(c.gains[0]!.cancelled).toBe(1);
    expect(c.gains[0]!.ramps.at(-1)).toEqual([0, 10.02]);
  });
  it('a constructor that throws, or none, leaves sound off without throwing', () => {
    const boom = vi.fn(() => {
      throw new Error('no audio');
    });
    const s = createSound(boom as unknown as new () => AudioContextLike);
    expect(s.setOn(true)).toBe(false);
    expect(() => s.play('complete')).not.toThrow();
    expect(createSound(undefined).setOn(true)).toBe(false);
  });
});
