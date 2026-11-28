/**
 * sound.ts: the thin Web Audio wrapper (design.md, `sound-plan.ts` and `sound.ts`). It creates no
 * `AudioContext` until the person turns sound on. Tones are sine oscillators with a gain ramp in and
 * out; turning sound off ramps any live tone to silence within 20 ms and suspends the context.
 * A missing or throwing constructor leaves sound off. Nothing here throws.
 */
import { SOUND_LIMITS, planSound, type SoundEvent } from './sound-plan.js';
export interface Sound {
  readonly isOn: () => boolean;
  /** Turns sound on (creating the context on the first call) or off. Returns the state afterwards. */
  setOn(on: boolean): boolean;
  play(event: SoundEvent): void;
}
/** The part of `AudioContext` this wrapper uses, so a test can pass a fake. */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: unknown;
  createOscillator(): {
    type: string;
    frequency: { value: number };
    connect(n: unknown): void;
    start(t: number): void;
    stop(t: number): void;
  };
  createGain(): {
    gain: { setValueAtTime(v: number, t: number): void; linearRampToValueAtTime(v: number, t: number): void; cancelScheduledValues(t: number): void };
    connect(n: unknown): void;
  };
  resume?(): Promise<void>;
  suspend?(): Promise<void>;
}
export type AudioContextCtor = new () => AudioContextLike;
interface Live {
  readonly gain: ReturnType<AudioContextLike['createGain']>['gain'];
  readonly endS: number;
}
export function createSound(ctor: AudioContextCtor | undefined): Sound {
  let ctx: AudioContextLike | null = null;
  let on = false;
  let lastToneEndS = -Infinity;
  let live: Live[] = [];
  const ensure = (): AudioContextLike | null => {
    if (ctx !== null) return ctx;
    if (ctor === undefined) return null;
    try {
      ctx = new ctor();
    } catch {
      ctx = null;
    }
    return ctx;
  };
  return {
    isOn: () => on,
    setOn(next) {
      if (!next) {
        on = false;
        if (ctx !== null) {
          const t = ctx.currentTime;
          for (const l of live) {
            try {
              l.gain.cancelScheduledValues(t);
              l.gain.setValueAtTime(0, t);
              l.gain.linearRampToValueAtTime(0, t + SOUND_LIMITS.minFadeS);
            } catch {
              // a tone that already ended
            }
          }
          live = [];
          try {
            void ctx.suspend?.().catch(() => undefined);
          } catch {
            // ignore
          }
        }
        return false;
      }
      const c = ensure();
      if (c === null) return (on = false);
      try {
        void c.resume?.().catch(() => undefined);
      } catch {
        // ignore
      }
      return (on = true);
    },
    play(event) {
      if (!on || ctx === null) return;
      const c = ctx;
      const now = c.currentTime;
      live = live.filter((l) => l.endS > now);
      for (const tone of planSound(event, lastToneEndS, now)) {
        try {
          const osc = c.createOscillator();
          const g = c.createGain();
          osc.type = 'sine';
          osc.frequency.value = tone.freq;
          const fade = SOUND_LIMITS.minFadeS;
          g.gain.setValueAtTime(0, tone.startS);
          g.gain.linearRampToValueAtTime(tone.gain, tone.startS + fade);
          g.gain.setValueAtTime(tone.gain, tone.startS + tone.durS - fade);
          g.gain.linearRampToValueAtTime(0, tone.startS + tone.durS);
          osc.connect(g);
          g.connect(c.destination);
          osc.start(tone.startS);
          osc.stop(tone.startS + tone.durS + 0.02);
          live.push({ gain: g.gain, endS: tone.startS + tone.durS });
          lastToneEndS = tone.startS + tone.durS;
        } catch {
          // sound is a nicety; never interrupt the game
        }
      }
    },
  };
}
