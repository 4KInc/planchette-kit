/**
 * P16 in full — bad timestamps are ignored per source (Req 9 AC 4, design §6
 * "Per-source timestamp ordering"), through createPlanchette + feedSamples.
 *
 * Streams:
 *  - camera: about 30 fps with ±20 % spacing. A frame's `now` is its capture time; it is
 *    delivered 20–80 ms later (MediaPipe processing), so it arrives after switch samples
 *    with later timestamps.
 *  - keyboard and gamepad: one sample per animation frame (16.7 ms), both with the SAME
 *    `now` on each frame, as two adapters in one rAF callback would send. Each carries its
 *    current `signal`. Delivered 0–30 ms after their `now`, so a switch sample can also
 *    arrive after a camera frame with a later timestamp.
 *  The streams are merged in delivery order.
 *
 * Bad timestamps: after a random choice of valid samples, a copy is injected with the same
 * `now` (duplicate) or an earlier one (backwards), in that source only, with different
 * content (another head pose or no face, the opposite signal, and `cancel: true`), so that
 * accepting one would change the events.
 *
 * Checks:
 *  P16a injected bad samples change nothing: events equal the clean run's events.
 *  P16b no valid camera frame is dropped because of a switch timestamp: camera-driven
 *       events equal those of the camera stream alone.
 *  P16c no valid switch sample is dropped because of a camera timestamp or the other
 *       switch source's timestamp: scan events equal those of the switch streams alone.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { InputMode, PlanchetteEventType, TimestampedSample } from '../src/api-types';
import { createPlanchette } from '../src/index';

const SCREEN = { width: 1000, height: 800 };
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
const RAF = 1000 / 60;
const CANCEL_HOLD_TIME = 1000;
/**
 * A hold the engine measures from its first held sample to the first released sample, so
 * the measured hold can exceed the physical one by up to one sample interval (RAF). Keep
 * it below the cancel hold time with that slack, and at most 300 ms.
 */
const SHORT_HOLD = Math.min(300, CANCEL_HOLD_TIME - 2 * RAF);

/**
 * Sorted, non-overlapping short holds, each followed by a gap of at least one sample
 * interval before the next press. Overlapping holds would merge (see `held`) into one long
 * hold that the engine correctly cancels (input-core Req 6 AC 2).
 */
function shortHolds(presses: Array<[number, number]>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let earliest = 0;
  for (const [from] of [...presses].sort((a, b) => a[0] - b[0])) {
    const start = Math.max(from, earliest);
    out.push([start, SHORT_HOLD]);
    earliest = start + SHORT_HOLD + RAF;
  }
  return out;
}

interface Delivered {
  at: number; // delivery time (orders the merged stream)
  seq: number; // tie-breaker
  sample: TimestampedSample;
  bad: boolean;
}

const poseArb = fc.option(
  fc.record({ yaw: fc.double({ min: -14, max: 14, noNaN: true }), pitch: fc.double({ min: -14, max: 14, noNaN: true }) }),
  { nil: null, freq: 8 },
);

const streamArb = fc.record({
  duration: fc.integer({ min: 2500, max: 6000 }),
  cameraStart: fc.integer({ min: 0, max: 40 }),
  camJitter: fc.array(fc.double({ min: -0.2, max: 0.2, noNaN: true }), { minLength: 200, maxLength: 200 }),
  camDelay: fc.array(fc.integer({ min: 20, max: 80 }), { minLength: 200, maxLength: 200 }),
  poses: fc.array(poseArb, { minLength: 8, maxLength: 8 }), // the head moves between these
  scores: fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 8, maxLength: 8 }),
  keyPresses: fc.array(fc.tuple(fc.integer({ min: 0, max: 5800 }), fc.integer({ min: 30, max: 2500 })), { maxLength: 5 }),
  padPresses: fc.array(fc.tuple(fc.integer({ min: 0, max: 5800 }), fc.integer({ min: 30, max: 2500 })), { maxLength: 5 }),
  keyDelay: fc.array(fc.integer({ min: 0, max: 30 }), { minLength: 400, maxLength: 400 }),
  padDelay: fc.array(fc.integer({ min: 0, max: 30 }), { minLength: 400, maxLength: 400 }),
  inject: fc.record({
    camera: fc.array(fc.tuple(fc.integer({ min: 0, max: 199 }), fc.integer({ min: 0, max: 200 })), { maxLength: 12 }),
    keyboard: fc.array(fc.tuple(fc.integer({ min: 0, max: 399 }), fc.integer({ min: 0, max: 200 })), { maxLength: 12 }),
    gamepad: fc.array(fc.tuple(fc.integer({ min: 0, max: 399 }), fc.integer({ min: 0, max: 200 })), { maxLength: 12 }),
  }),
});
type Streams = typeof streamArb extends fc.Arbitrary<infer T> ? T : never;

function held(presses: Array<[number, number]>, t: number): boolean {
  return presses.some(([from, ms]) => t >= from && t < from + ms);
}

function face(pose: { yaw: number; pitch: number }, score: number) {
  return { bbox: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.3 }, rotation: pose, gestureScores: { jawOpen: score, browRaise: 0 } };
}

/** The merged, delivery-ordered stream. `bad` samples are the injected ones. */
function buildStreams(c: Streams, which: { camera: boolean; switches: boolean; inject: boolean }): TimestampedSample[] {
  const out: Delivered[] = [];
  let seq = 0;
  const push = (at: number, sample: TimestampedSample, bad: boolean): void => {
    out.push({ at, seq: seq++, sample, bad });
  };
  const injectFor = (source: 'camera' | 'keyboard' | 'gamepad'): Map<number, number> =>
    new Map(which.inject ? c.inject[source] : []);

  if (which.camera) {
    const inj = injectFor('camera');
    let t = c.cameraStart;
    let lastArrival = -Infinity;
    for (let i = 0; i < 200 && t <= c.duration; i++) {
      const seg = Math.min(7, Math.floor((t / c.duration) * 8));
      const pose = c.poses[seg];
      const arrival = Math.max(lastArrival, t + c.camDelay[i]); // frames are delivered in order
      lastArrival = arrival;
      const sample: TimestampedSample = { now: t, source: 'camera', faces: pose === null ? [] : [face(pose, c.scores[seg])] };
      push(arrival, sample, false);
      const back = inj.get(i);
      if (back !== undefined) {
        // Same or earlier `now`, other content, and a cancel: accepting it would show.
        const other = c.poses[(seg + 3) % 8];
        push(arrival, { now: t - back, source: 'camera', faces: other === null ? [] : [face({ yaw: -(other.yaw), pitch: other.pitch }, 1)], cancel: true }, true);
      }
      t += (1000 / 30) * (1 + c.camJitter[i]);
    }
  }

  if (which.switches) {
    for (const [source, presses, delays] of [
      ['keyboard', c.keyPresses, c.keyDelay],
      ['gamepad', c.padPresses, c.padDelay],
    ] as const) {
      const inj = injectFor(source);
      let lastArrival = -Infinity;
      for (let i = 0; i < 400; i++) {
        const now = 5 + i * RAF; // keyboard and gamepad share each frame's `now`
        if (now > c.duration) break;
        const signal = held(presses as Array<[number, number]>, now);
        const arrival = Math.max(lastArrival, now + delays[i]);
        lastArrival = arrival;
        push(arrival, { now, source, signal }, false);
        const back = inj.get(i);
        if (back !== undefined) push(arrival, { now: now - back, source, signal: !signal, cancel: true }, true);
      }
    }
  }

  out.sort((a, b) => a.at - b.at || a.seq - b.seq);
  return out.map((d) => d.sample);
}

function runEvents(mode: InputMode, samples: TimestampedSample[]): Array<{ type: string; detail: unknown }> {
  const p = createPlanchette({ screen: SCREEN, profile: { mode, cancelByHold: true, cancelHoldTime: CANCEL_HOLD_TIME, scanInterval: 500, dwellTime: 600 } });
  p.registerTarget('a', { x: 0, y: 0, width: 500, height: 400 });
  p.registerTarget('b', { x: 500, y: 0, width: 500, height: 400 });
  p.registerTarget('c', { x: 0, y: 400, width: 500, height: 400 });
  p.registerTarget('d', { x: 500, y: 400, width: 500, height: 400 }, { role: 'undo' });
  const log: Array<{ type: string; detail: unknown }> = [];
  for (const type of TYPES) p.addEventListener(type, (e) => log.push({ type, detail: (e as CustomEvent).detail }));
  p.feedSamples(samples);
  return log;
}

const MODES: InputMode[] = ['head + dwell', 'head + gesture', 'scan', 'gesture scan', 'mouse'];

describe('P16: bad timestamps are ignored per source', () => {
  it('P16a: injected duplicate and backwards samples, in any source, change no event', () => {
    fc.assert(
      fc.property(streamArb, fc.constantFrom(...MODES), (c, mode) => {
        const clean = runEvents(mode, buildStreams(c, { camera: true, switches: true, inject: false }));
        const dirty = runEvents(mode, buildStreams(c, { camera: true, switches: true, inject: true }));
        expect(dirty).toEqual(clean);
      }),
      { numRuns: 200 },
    );
  });

  it('P16b: a valid camera frame is never dropped because of a switch timestamp', () => {
    fc.assert(
      fc.property(streamArb, fc.constantFrom<InputMode>('head + dwell', 'head + gesture'), fc.boolean(), (c, mode, inject) => {
        // Switch presses in head modes only act through hold-to-cancel. Use separate holds,
        // each shorter than the cancel hold time, so the switches emit nothing, and compare everything.
        const short = { ...c, keyPresses: shortHolds(c.keyPresses), padPresses: shortHolds(c.padPresses) };
        const alone = runEvents(mode, buildStreams(short, { camera: true, switches: false, inject }));
        const mixed = runEvents(mode, buildStreams(short, { camera: true, switches: true, inject }));
        expect(mixed).toEqual(alone);
        // Not vacuous: the camera stream did produce events.
        expect(alone.length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });

  // Per input-core Req 6 AC 2 and design.md "edge-case decisions": a hold that reaches
  // cancelHoldTime cancels. Overlapping presses merge in `held()` into one hold.
  it('P16b regression (27 Nov 2026): overlapping 300 ms presses at 0, 89, 389, 689 merge into one hold that reaches the cancel hold time', () => {
    const c: Streams = {
      duration: 2500,
      cameraStart: 0,
      camJitter: Array(200).fill(0),
      camDelay: Array(200).fill(20),
      poses: Array(8).fill(null),
      scores: Array(8).fill(0),
      keyPresses: [[0, 300], [89, 300], [389, 300], [689, 300]],
      padPresses: [],
      keyDelay: Array(400).fill(0),
      padDelay: Array(400).fill(0),
      inject: { camera: [], keyboard: [], gamepad: [] },
    };
    const log = runEvents('head + dwell', buildStreams(c, { camera: true, switches: true, inject: false }));
    const types = log.map((e) => e.type);
    expect(types.filter((t) => t === 'select')).toHaveLength(0);
    expect(types.filter((t) => t === 'cancel')).toHaveLength(1);
    expect(types.indexOf('calibration-step')).toBeGreaterThanOrEqual(0);
    expect(types.indexOf('calibration-step')).toBeLessThan(types.indexOf('cancel'));
    const cancel = log.find((e) => e.type === 'cancel')?.detail as { now: number };
    expect(cancel.now).toBeCloseTo(1005, 0);
  });

  it('P16c: a valid switch sample is never dropped because of a camera or another switch timestamp', () => {
    fc.assert(
      fc.property(streamArb, fc.boolean(), (c, inject) => {
        const scanOnly = (log: Array<{ type: string; detail: unknown }>) =>
          log.filter((e) => e.type === 'highlight' || e.type === 'select' || e.type === 'cancel');
        const alone = scanOnly(runEvents('scan', buildStreams(c, { camera: false, switches: true, inject })));
        const mixed = scanOnly(runEvents('scan', buildStreams(c, { camera: true, switches: true, inject })));
        expect(mixed).toEqual(alone);
      }),
      { numRuns: 200 },
    );
  });

  it('P16c: the keyboard and the gamepad, with the same `now` on every frame, each count their own presses', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 0, max: 30 }),
        fc.boolean(),
        (presses, offset, keyFirst) => {
          // Only the gamepad presses (short presses, cancel-by-hold off). The keyboard sends
          // "released" on the same frames, delivered first or second.
          const p = createPlanchette({ screen: SCREEN, profile: { mode: 'mouse', cancelByHold: false } });
          p.registerTarget('a', { x: 0, y: 0, width: 1000, height: 800 });
          let selects = 0;
          p.addEventListener('select', () => selects++);
          const samples: TimestampedSample[] = [];
          for (let i = 0; i < presses * 20; i++) {
            const now = offset + i * RAF;
            const down = i % 20 >= 5 && i % 20 < 10;
            const key: TimestampedSample = { now, source: 'keyboard', signal: false };
            const pad: TimestampedSample = { now, source: 'gamepad', signal: down };
            const mouse: TimestampedSample = { now, source: 'mouse', pointer: { x: 10, y: 10 } };
            samples.push(...(keyFirst ? [key, pad, mouse] : [pad, key, mouse]));
          }
          p.feedSamples(samples);
          // Pressed with the mouse pointer resting on 'a'. The gamepad's presses select.
          expect(selects).toBe(presses);
        },
      ),
      { numRuns: 100 },
    );
  });
});
