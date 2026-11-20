/**
 * P4 — cancel always works, through the public API (createPlanchette + feedSamples).
 *
 * From any reachable state, one cancel input returns the engine to idle in one step and
 * emits exactly one `cancel`. Also: a hold of any length gives one cancel or one press,
 * never both and never neither; a cancel target cancels once per stay; and a `select`
 * never carries the role 'cancel'.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { TimestampedSample } from '../src/api-types';
import { PressState } from '../src/engine/press-machine';
import { SWITCH_SOURCES, run, setup, type Source } from './arbitraries';
import { FULL, harness } from './harness';

const ALL_SOURCES: Source[] = ['camera', ...SWITCH_SOURCES];

describe('P4: a cancel input from any reachable state', () => {
  it('emits exactly one cancel and returns to idle in one step', () => {
    fc.assert(
      fc.property(setup, fc.constantFrom(...ALL_SOURCES), (c, source) => {
        const r = run(c);
        const before = r.log.length;
        const cancelSample: TimestampedSample = { now: r.clocks[source] + 1, source, cancel: true };
        r.p.feedSamples([cancelSample]);
        const events = r.log.slice(before);

        // exactly one cancel; nothing else but the end of a dwell stay (progress back to 0)
        expect(events.filter((e) => e.type === 'cancel')).toHaveLength(1);
        for (const e of events) {
          if (e.type === 'cancel') continue;
          expect(e.type).toBe('dwell-progress');
          expect((e.detail as { progress: number }).progress).toBe(0);
        }

        // idle in that one step
        const snap = r.inspect();
        expect(snap.dwell.targetId).toBeNull();
        expect(snap.scan.started).toBe(false);
        expect(snap.scan.paused).toBe(false);
        expect(snap.gesture.press).toBe(PressState.IDLE);
        expect(snap.gesture.signal).toBe(false);
        // A switch still held is in cooldown: it cannot press until it is released.
        for (const state of Object.values(snap.switches)) {
          expect([PressState.IDLE, PressState.COOLDOWN]).toContain(state);
        }
      }),
      { numRuns: 400 },
    );
  });

  it('what was in progress does not select afterwards: the next neutral samples select nothing', () => {
    fc.assert(
      fc.property(setup, fc.constantFrom(...ALL_SOURCES), (c, source) => {
        const r = run(c);
        const t0 = Math.max(...Object.values(r.clocks)) + 1;
        const before = r.log.length;
        r.p.feedSamples([
          { now: r.clocks[source] + 1, source, cancel: true },
          { now: t0 + 20, source: 'camera', faces: [] },
          ...(['keyboard', 'mouse', 'gamepad', 'synthetic'] as const).map((s): TimestampedSample => ({ now: t0 + 20, source: s, signal: false })),
        ]);
        const after = r.log.slice(before).map((e) => e.type);
        expect(after).not.toContain('select');
        expect(after.filter((t) => t === 'cancel')).toHaveLength(1);
      }),
      { numRuns: 300 },
    );
  });

  it('every cancel sample emits one cancel, and a repeated timestamp emits none', () => {
    fc.assert(
      fc.property(setup, fc.integer({ min: 1, max: 5 }), (c, n) => {
        const r = run(c);
        const before = r.log.length;
        const samples: TimestampedSample[] = [];
        for (let i = 1; i <= n; i++) {
          samples.push({ now: r.clocks.keyboard + i * 10, source: 'keyboard', cancel: true });
          samples.push({ now: r.clocks.keyboard + i * 10, source: 'keyboard', cancel: true }); // repeated time
        }
        r.p.feedSamples(samples);
        expect(r.log.slice(before).filter((e) => e.type === 'cancel')).toHaveLength(n);
      }),
      { numRuns: 150 },
    );
  });

  it('a select event never carries the role cancel, whatever the input', () => {
    fc.assert(
      fc.property(setup, (c) => {
        const r = run(c);
        for (const e of r.log) {
          if (e.type === 'select') expect((e.detail as { role: string }).role).not.toBe('cancel');
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('hold-to-cancel, any hold length (Req 6 AC 2)', () => {
  const holdCase = fc.record({
    hold: fc.integer({ min: 400, max: 5000 }), // ms from the first held sample to the release sample
    dt: fc.integer({ min: 10, max: 100 }),
  });

  it('a switch hold gives one cancel (held to the cancel hold time) or one press, never both', () => {
    fc.assert(
      fc.property(holdCase, ({ hold, dt }) => {
        const h = harness({ mode: 'mouse', cancelByHold: true, cancelHoldTime: 1000, inputTimeout: 5000 });
        h.p.registerTarget('a', FULL);
        const pointer = { x: 100, y: 100 };
        h.p.feedSamples([{ now: 10, source: 'mouse', pointer, signal: false }]);
        const samples: TimestampedSample[] = [];
        const t0 = 10 + dt;
        for (let t = t0; t < t0 + hold; t += dt) samples.push({ now: t, source: 'mouse', pointer, signal: true });
        const release = t0 + hold;
        samples.push({ now: release, source: 'mouse', pointer, signal: false });
        samples.push({ now: release + dt, source: 'mouse', pointer, signal: false });
        h.p.feedSamples(samples);
        const cancels = h.of('cancel').length;
        const selects = h.of('select').length;
        if (release - t0 >= 1000) expect([cancels, selects]).toEqual([1, 0]);
        else expect([cancels, selects]).toEqual([0, 1]);
      }),
      { numRuns: 300 },
    );
  });

  it('a gesture hold gives one cancel, one press or nothing (too short), never both', () => {
    fc.assert(
      fc.property(holdCase, ({ hold, dt }) => {
        const h = harness({ mode: 'head + gesture', cancelByHold: true, cancelHoldTime: 1000, inputTimeout: 5000, gestureAcceptanceTime: 300 });
        h.p.registerTarget('a', FULL);
        h.settle();
        h.clear();
        const face = (now: number, jaw: number): TimestampedSample => ({
          now,
          source: 'camera',
          faces: [{ bbox: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.3 }, rotation: { yaw: 0, pitch: 0 }, gestureScores: { jawOpen: jaw, browRaise: 0 } }],
        });
        const base = h.clock.camera;
        const samples: TimestampedSample[] = [face(base + 1, 0)];
        const t0 = base + 1 + dt;
        for (let t = t0; t < t0 + hold; t += dt) samples.push(face(t, 0.9));
        const release = t0 + hold;
        samples.push(face(release, 0), face(release + dt, 0));
        h.p.feedSamples(samples);
        const cancels = h.of('cancel').length;
        const selects = h.of('select').length;
        if (release - t0 >= 1000) expect([cancels, selects]).toEqual([1, 0]);
        else if (release - t0 >= 300) expect([cancels, selects]).toEqual([0, 1]);
        else expect([cancels, selects]).toEqual([0, 0]);
      }),
      { numRuns: 300 },
    );
  });
});

describe('a cancel target cancels once per stay (Task 10.1)', () => {
  it('resting on it for any time cancels once if the dwell time was reached, else not at all', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 400, max: 3000 }), // dwell time
        fc.integer({ min: 200, max: 15000 }), // time on the target
        fc.integer({ min: 10, max: 90 }), // sample spacing
        fc.boolean(), // autoRepeat requested
        (dwellTime, stay, dt, autoRepeat) => {
          const h = harness({ mode: 'head + dwell', dwellTime });
          h.p.registerTarget('c', FULL, { role: 'cancel', autoRepeat });
          h.settle();
          h.noFace(1); // the last settle samples were already on the target: start a fresh stay
          h.clear();
          const samples: TimestampedSample[] = [];
          for (let t = dt; t <= stay; t += dt) {
            samples.push({
              now: h.clock.camera + t,
              source: 'camera',
              faces: [{ bbox: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.3 }, rotation: { yaw: 0, pitch: 0 } }],
            });
          }
          h.p.feedSamples(samples);
          const cancels = h.of('cancel').length;
          // The on-target time counted is at most `stay`, so below the dwell time nothing fires,
          // and well above it (the first sample only starts the stay) exactly one cancel does.
          if (stay < dwellTime) expect(cancels).toBe(0);
          else if (stay > dwellTime + 2 * dt) expect(cancels).toBe(1);
          else expect(cancels).toBeLessThanOrEqual(1);
          expect(h.of('select')).toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
  });
});
