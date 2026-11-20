/**
 * Property tests for the assembled API.
 *  P5 (full)  after any input and then silence, the engine is idle.
 *  Req 9 AC 3 the same samples always give the same events.
 *  No input, however malformed, makes feedSamples throw.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { TimestampedSample } from '../src/api-types';
import { createPlanchetteInternal } from '../src/planchette';
import { PressState } from '../src/engine/press-machine';
import { MODES, SCREEN, SWITCH_SOURCES, f, run, setup } from './arbitraries';

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
