/**
 * Shared generators for the property tests that drive the assembled API: a random
 * setup (mode, targets, profile) and a random sequence of camera, switch, mouse and
 * mode operations, fed through `feedSamples`.
 */
import fc from 'fast-check';
import type { InputMode, PlanchetteEventType, TimestampedSample } from '../src/api-types';
import { createPlanchetteInternal } from '../src/planchette';

export const MODES: InputMode[] = ['head + dwell', 'head + gesture', 'scan', 'gesture scan', 'mouse'];
export const TYPES: PlanchetteEventType[] = [
  'pointer-move',
  'dwell-progress',
  'highlight',
  'select',
  'cancel',
  'tracking-status',
  'mode-change',
  'calibration-step',
];
export const SCREEN = { width: 800, height: 600 };

export type Source = 'camera' | 'keyboard' | 'mouse' | 'gamepad' | 'synthetic';
export const SWITCH_SOURCES: Source[] = ['keyboard', 'mouse', 'gamepad', 'synthetic'];

export const f = (min: number, max: number): fc.Arbitrary<number> =>
  fc.double({ min: Math.fround(min), max: Math.fround(max), noNaN: true, noDefaultInfinity: true });

const face = fc.record({
  bbox: fc.record({ cx: f(0.1, 0.9), cy: f(0.1, 0.9), w: f(0.1, 0.5), h: f(0.1, 0.5) }),
  rotation: fc.record({ yaw: f(-40, 40), pitch: f(-40, 40) }),
  gestureScores: fc.option(fc.record({ jawOpen: f(0, 1), browRaise: f(0, 1) }), { nil: undefined }),
});

interface FaceIn {
  bbox: { cx: number; cy: number; w: number; h: number };
  rotation: { yaw: number; pitch: number };
  gestureScores?: { jawOpen: number; browRaise: number };
}
type Op =
  | { kind: 'camera'; dt: number; faces: FaceIn[] }
  | { kind: 'switch'; source: Source; dt: number; signal: boolean | undefined; pointer: { x: number; y: number } | undefined; cancel: boolean }
  | { kind: 'mode'; mode: InputMode };

const cameraOp: fc.Arbitrary<Op> = fc.record({
  kind: fc.constant('camera' as const),
  dt: fc.integer({ min: 1, max: 300 }),
  faces: fc.array(face, { maxLength: 2 }),
});
const switchOp: fc.Arbitrary<Op> = fc
  .record({
    kind: fc.constant('switch' as const),
    source: fc.constantFrom(...SWITCH_SOURCES),
    dt: fc.integer({ min: 1, max: 300 }),
    signal: fc.option(fc.boolean(), { nil: undefined }),
    pointer: fc.option(fc.record({ x: f(-50, 900), y: f(-50, 700) }), { nil: undefined }),
    cancelRoll: fc.integer({ min: 0, max: 19 }),
  })
  .map(({ cancelRoll, ...rest }) => ({ ...rest, cancel: cancelRoll === 0 }));
const modeOp: fc.Arbitrary<Op> = fc.record({ kind: fc.constant('mode' as const), mode: fc.constantFrom(...MODES) });

const opReplayable: fc.Arbitrary<Op> = fc.oneof(
  { weight: 5, arbitrary: cameraOp },
  { weight: 5, arbitrary: switchOp },
  { weight: 1, arbitrary: modeOp },
);

const target = fc.record({
  x: f(0, 700),
  y: f(0, 500),
  width: f(20, 300),
  height: f(20, 300),
  role: fc.constantFrom('default', 'default', 'cancel', 'undo', 'rest-area'),
  autoRepeat: fc.boolean(),
});

export const setup = fc.record({
  mode: fc.constantFrom(...MODES),
  targets: fc.array(target, { minLength: 0, maxLength: 6 }),
  inputTimeout: fc.integer({ min: 500, max: 10000 }),
  cancelByHold: fc.boolean(),
  dwellTime: fc.integer({ min: 400, max: 3000 }),
  scanInterval: fc.integer({ min: 500, max: 3000 }),
  offsets: fc.record({
    camera: fc.integer({ min: 0, max: 80 }),
    keyboard: fc.integer({ min: 0, max: 80 }),
    mouse: fc.integer({ min: 0, max: 80 }),
    gamepad: fc.integer({ min: 0, max: 80 }),
    synthetic: fc.integer({ min: 0, max: 80 }),
  }),
  ops: fc.array(opReplayable, { maxLength: 60 }),
});

export type Case = typeof setup extends fc.Arbitrary<infer T> ? T : never;

export interface Run {
  log: Array<{ type: string; detail: unknown }>;
  clocks: Record<Source, number>;
  inspect: ReturnType<typeof createPlanchetteInternal>['inspect'];
  p: ReturnType<typeof createPlanchetteInternal>['planchette'];
}

/** Build an instance for a case, feed its operations, and return what happened. */
export function run(c: Case): Run {
  const { planchette: p, inspect } = createPlanchetteInternal({
    screen: SCREEN,
    profile: {
      mode: c.mode,
      inputTimeout: c.inputTimeout,
      cancelByHold: c.cancelByHold,
      dwellTime: c.dwellTime,
      scanInterval: c.scanInterval,
    },
  });
  const log: Run['log'] = [];
  for (const type of TYPES) p.addEventListener(type, (e) => log.push({ type, detail: (e as CustomEvent).detail }));
  c.targets.forEach((t, i) =>
    p.registerTarget(`t${i}`, { x: t.x, y: t.y, width: t.width, height: t.height }, { role: t.role as 'default', autoRepeat: t.autoRepeat }),
  );
  const clocks: Record<Source, number> = { ...c.offsets };
  for (const o of c.ops) {
    if (o.kind === 'mode') {
      p.setMode(o.mode);
    } else if (o.kind === 'camera') {
      clocks.camera += o.dt;
      p.feedSamples([{ now: clocks.camera, source: 'camera', faces: o.faces }]);
    } else {
      clocks[o.source] += o.dt;
      const s: TimestampedSample = { now: clocks[o.source], source: o.source };
      if (o.signal !== undefined) s.signal = o.signal;
      if (o.pointer !== undefined) s.pointer = o.pointer;
      if (o.cancel) s.cancel = true;
      p.feedSamples([s]);
    }
  }
  return { log, clocks, inspect, p };
}

