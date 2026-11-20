/**
 * Property tests for the assembled API.
 *  P5 (full)  after any input and then silence, the engine is idle.
 *  Req 9 AC 3 the same samples always give the same events.
 *  No input, however malformed, makes feedSamples throw.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { InputMode, PlanchetteEventType, TimestampedSample } from '../src/api-types';
import { createPlanchetteInternal } from '../src/planchette';
import { PressState } from '../src/engine/press-machine';

const MODES: InputMode[] = ['head + dwell', 'head + gesture', 'scan', 'gesture scan', 'mouse'];
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
const SCREEN = { width: 800, height: 600 };

type Source = 'camera' | 'keyboard' | 'mouse' | 'gamepad' | 'synthetic';
const SWITCH_SOURCES: Source[] = ['keyboard', 'mouse', 'gamepad', 'synthetic'];

const f = (min: number, max: number): fc.Arbitrary<number> =>
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

const setup = fc.record({
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

type Case = typeof setup extends fc.Arbitrary<infer T> ? T : never;

interface Run {
  log: Array<{ type: string; detail: unknown }>;
  clocks: Record<Source, number>;
  inspect: ReturnType<typeof createPlanchetteInternal>['inspect'];
  p: ReturnType<typeof createPlanchetteInternal>['planchette'];
}

/** Build an instance for a case, feed its operations, and return what happened. */
function run(c: Case): Run {
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

describe('P5 (full): after silence, the engine is idle', () => {
  it('after any input followed by silence of at least inputTimeout + 1 ms, nothing is pending', () => {
    fc.assert(
      fc.property(setup, (c) => {
        const r = run(c);
        const timeout = r.p.getProfile().inputTimeout;
        const T = Math.max(...Object.values(r.clocks)) + timeout + 1;
        const before = r.log.length;
        // The silence ends with one neutral sample from each kind of source.
        r.p.feedSamples([
          { now: T, source: 'camera', faces: [] },
          ...SWITCH_SOURCES.map((source): TimestampedSample => ({ now: T, source, signal: false })),
        ]);
        const snap = r.inspect();
        expect(snap.dwell.targetId).toBeNull();
        expect(snap.gesture.press).toBe(PressState.IDLE);
        expect(snap.gesture.signal).toBe(false);
        for (const state of Object.values(snap.switches)) expect(state).toBe(PressState.IDLE);
        // Scanning is at the top of its cycle, or paused (a paused scan stays paused until a press).
        expect(snap.scan.paused || (snap.scan.level === 'top' && snap.scan.index === 0 && snap.scan.loops === 0)).toBe(true);
        // Silence never selects or cancels anything.
        const after = r.log.slice(before).map((l) => l.type);
        expect(after).not.toContain('select');
        expect(after).not.toContain('cancel');
      }),
      { numRuns: 300 },
    );
  });

  it('a held switch that was never released does not press after the silence', () => {
    fc.assert(
      fc.property(setup, fc.constantFrom(...SWITCH_SOURCES), (c, source) => {
        const r = run({ ...c, ops: [...c.ops, { kind: 'switch', source, dt: 5, signal: true, pointer: undefined, cancel: false }] });
        const timeout = r.p.getProfile().inputTimeout;
        const T = Math.max(...Object.values(r.clocks)) + timeout + 1;
        const before = r.log.length;
        r.p.feedSamples([
          { now: T, source, signal: false },
          { now: T + 20, source, signal: false },
        ]);
        expect(r.log.slice(before).map((l) => l.type)).not.toContain('select');
      }),
      { numRuns: 200 },
    );
  });
});

describe('determinism (Req 9 AC 3)', () => {
  it('the same profile and samples give the same events', () => {
    fc.assert(
      fc.property(setup, (c) => {
        expect(run(c).log).toEqual(run(c).log);
      }),
      { numRuns: 100 },
    );
  });
});

describe('malformed input never throws', () => {
  it('any JSON-like value fed as a sample, with any source and time, is survivable', () => {
    const junk = fc.anything({ withNullPrototype: true, withBigInt: false });
    const sample = fc.oneof(
      junk,
      fc.record(
        {
          now: fc.oneof(f(-10, 1e6), fc.constant(NaN), fc.constant(Infinity), junk),
          source: fc.oneof(fc.constantFrom('camera', 'keyboard', 'mouse', 'gamepad', 'synthetic'), junk),
          faces: junk,
          pointer: junk,
          signal: junk,
          cancel: junk,
          gestureScores: junk,
        },
        { requiredKeys: [] },
      ),
    );
    fc.assert(
      fc.property(fc.constantFrom(...MODES), fc.array(sample, { maxLength: 40 }), (mode, samples) => {
        const { planchette: p } = createPlanchetteInternal({ screen: SCREEN, profile: { mode } });
        p.registerTarget('a', { x: 0, y: 0, width: 800, height: 600 });
        expect(() => p.feedSamples(samples as TimestampedSample[])).not.toThrow();
      }),
      { numRuns: 300 },
    );
  });
});
