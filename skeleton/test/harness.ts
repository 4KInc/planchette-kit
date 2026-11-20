/**
 * Test harness for the assembled API: a Planchette on a 1000 x 800 screen with every
 * event recorded, per-source sample clocks and helpers that feed 16 ms samples.
 */
import type { PlanchetteEventMap, PlanchetteEventType, TimestampedSample } from '../src/api-types';
import { createPlanchetteInternal, type PlanchetteSnapshot } from '../src/planchette';
import type { Profile } from '../src/engine/profile';

const TYPES: PlanchetteEventType[] = [
  'pointer-move',
  'dwell-progress',
  'highlight',
  'select',
  'cancel',
  'tracking-status',
  'mode-change',
  'calibration-step',
];
export const DT = 16;

export interface Logged<K extends PlanchetteEventType = PlanchetteEventType> {
  type: K;
  detail: PlanchetteEventMap[K];
}

/** A Planchette on a 1000 x 800 screen with every event recorded, and a sample clock. */
export function harness(profile: Partial<Profile> = {}) {
  const { planchette: p, inspect } = createPlanchetteInternal({ screen: { width: 1000, height: 800 }, profile });
  const log: Logged[] = [];
  for (const type of TYPES) {
    p.addEventListener(type, (e) => log.push({ type, detail: (e as CustomEvent).detail } as Logged));
  }
  const clock = { camera: 0, keyboard: 0, mouse: 0, gamepad: 0, synthetic: 0 };
  const h = {
    p,
    log,
    inspect: (): PlanchetteSnapshot => inspect(),
    clock,
    of<K extends PlanchetteEventType>(type: K): Array<PlanchetteEventMap[K]> {
      return log.filter((l) => l.type === type).map((l) => l.detail as PlanchetteEventMap[K]);
    },
    clear(): void {
      log.length = 0;
    },
    /** `n` camera samples 16 ms apart with the head at (yaw, pitch). */
    cam(n: number, yaw = 0, pitch = 0, scores?: { jawOpen: number; browRaise: number } | ((i: number) => { jawOpen: number; browRaise: number })): void {
      const samples: TimestampedSample[] = [];
      for (let i = 0; i < n; i++) {
        clock.camera += DT;
        samples.push({
          now: clock.camera,
          source: 'camera',
          faces: [
            {
              bbox: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.3 },
              rotation: { yaw, pitch },
              gestureScores: typeof scores === 'function' ? scores(i) : scores,
            },
          ],
        });
      }
      p.feedSamples(samples);
    },
    /** `n` camera samples with no face. */
    noFace(n: number): void {
      const samples: TimestampedSample[] = [];
      for (let i = 0; i < n; i++) {
        clock.camera += DT;
        samples.push({ now: clock.camera, source: 'camera', faces: [] });
      }
      p.feedSamples(samples);
    },
    /** `n` samples of a non-camera source 16 ms apart. */
    tick(source: 'keyboard' | 'mouse' | 'gamepad' | 'synthetic', n: number, extra: Partial<TimestampedSample> = {}): void {
      const samples: TimestampedSample[] = [];
      for (let i = 0; i < n; i++) {
        clock[source] += DT;
        samples.push({ now: clock[source], source, ...extra });
      }
      p.feedSamples(samples);
    },
    /** Finish the start-up centre step with the head at (yaw, pitch). */
    settle(yaw = 0, pitch = 0): void {
      h.cam(100, yaw, pitch); // 1600 ms of stillness
    },
  };
  return h;
}

export const FULL: { x: number; y: number; width: number; height: number } = { x: 0, y: 0, width: 1000, height: 800 };

