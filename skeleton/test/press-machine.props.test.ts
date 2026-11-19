/**
 * Press machine properties:
 *  P7  short presses ignored
 *  P18 cancel hold never selects
 *  P5  (partial) no stuck state after silence
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  PressState,
  createPressMachineState,
  stepPress,
  type PressEvent,
} from '../src/engine/press-machine';
import { clampProfile, type Profile } from '../src/engine/profile';

/** Valid profile with the fields the press machine reads, built through clampProfile. */
const profileArb: fc.Arbitrary<Profile> = fc
  .record({
    cancelByHold: fc.boolean(),
    cancelHoldTime: fc.integer({ min: 1000, max: 5000 }),
    inputTimeout: fc.integer({ min: 500, max: 10000 }),
    switchAcceptanceTime: fc.integer({ min: 0, max: 2000 }),
    gestureAcceptanceTime: fc.integer({ min: 100, max: 2000 }),
  })
  .map((r) => clampProfile(r));

describe('P7 short presses ignored', () => {
  it('a hold shorter than the acceptance time never counts, with cancel-by-hold on or off', () => {
    fc.assert(
      fc.property(
        profileArb,
        fc.constantFrom('switch', 'gesture'),
        fc.array(fc.integer({ min: 1, max: 400 }), { minLength: 0, maxLength: 20 }),
        fc.nat(),
        (profile, kind, gaps, pick) => {
          const acceptance =
            kind === 'switch' ? profile.switchAcceptanceTime : profile.gestureAcceptanceTime;
          fc.pre(acceptance >= 2); // hold must fit in [1, acceptance - 1]
          const hold = 1 + (pick % (acceptance - 1)); // in [1, acceptance - 1]

          // Active samples at t = 0 and at increasing times strictly below `hold`,
          // then a release at `hold`.
          const times = [0];
          for (const g of gaps) {
            const next = times[times.length - 1] + g;
            if (next >= hold) break;
            times.push(next);
          }

          const s = createPressMachineState();
          const events: PressEvent[] = [];
          for (const t of times) events.push(...stepPress(s, true, t, profile, acceptance));
          events.push(...stepPress(s, false, hold, profile, acceptance));

          expect(events).toEqual([]);
          expect(s.state).toBe(PressState.IDLE);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('P18 cancel hold never selects', () => {
  it('a hold that reaches cancelHoldTime gives one cancel and no press, however it ends', () => {
    fc.assert(
      fc.property(
        profileArb,
        fc.constantFrom('switch', 'gesture'),
        // gaps stay below inputTimeout (min 500) so the stream is continuous
        fc.array(fc.integer({ min: 1, max: 499 }), { minLength: 1, maxLength: 200 }),
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 1, max: 499 }),
        (profile, kind, gaps, extraSamples, releaseGap) => {
          fc.pre(profile.cancelByHold);
          const acceptance =
            kind === 'switch' ? profile.switchAcceptanceTime : profile.gestureAcceptanceTime;

          const s = createPressMachineState();
          const events: PressEvent[] = [];
          let t = 0;
          events.push(...stepPress(s, true, t, profile, acceptance));

          // Keep holding until the hold has reached cancelHoldTime.
          let i = 0;
          while (t < profile.cancelHoldTime) {
            t += gaps[i % gaps.length];
            i++;
            events.push(...stepPress(s, true, t, profile, acceptance));
          }
          // Hold some more, then release.
          for (let k = 0; k < extraSamples; k++) {
            t += gaps[i % gaps.length];
            i++;
            events.push(...stepPress(s, true, t, profile, acceptance));
          }
          t += releaseGap;
          events.push(...stepPress(s, false, t, profile, acceptance));

          expect(events.filter((e) => e.type === 'press')).toHaveLength(0);
          expect(events.filter((e) => e.type === 'cancel')).toHaveLength(1);
          expect(s.state).toBe(PressState.IDLE);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('a release arriving after a gap that spans the cancel hold time never presses', () => {
    fc.assert(
      fc.property(profileArb, fc.integer({ min: 0, max: 499 }), (profile, lastGapBelowTimeout) => {
        fc.pre(profile.cancelByHold);
        const s = createPressMachineState();
        const events: PressEvent[] = [];
        // Active at 0, then one active sample just before the cancel hold time,
        // then a release that lands at or after it, with gaps below inputTimeout.
        events.push(...stepPress(s, true, 0, profile, 0));
        const mid = profile.cancelHoldTime - 1 - lastGapBelowTimeout;
        let t = 0;
        while (t + 499 < mid) {
          t += 499;
          events.push(...stepPress(s, true, t, profile, 0));
        }
        events.push(...stepPress(s, true, mid > t ? mid : t + 1, profile, 0));
        events.push(...stepPress(s, false, profile.cancelHoldTime + 5, profile, 0));
        expect(events.filter((e) => e.type === 'press')).toHaveLength(0);
      }),
      { numRuns: 300 },
    );
  });
});

describe('P5 (partial) no stuck state', () => {
  it('after silence of at least inputTimeout the machine is IDLE and emits nothing', () => {
    fc.assert(
      fc.property(
        profileArb,
        fc.array(
          fc.record({ gap: fc.integer({ min: 1, max: 3000 }), signal: fc.boolean() }),
          { maxLength: 60 },
        ),
        fc.integer({ min: 0, max: 5000 }),
        fc.constantFrom('switch', 'gesture'),
        (profile, steps, extraSilence, kind) => {
          const acceptance =
            kind === 'switch' ? profile.switchAcceptanceTime : profile.gestureAcceptanceTime;
          const s = createPressMachineState();
          let t = 0;
          for (const { gap, signal } of steps) {
            t += gap;
            stepPress(s, signal, t, profile, acceptance);
          }
          // Input stops. The next sample arrives after the input timeout.
          t += profile.inputTimeout + extraSilence;
          const events = stepPress(s, false, t, profile, acceptance);
          expect(events).toEqual([]);
          expect(s.state).toBe(PressState.IDLE);
        },
      ),
      { numRuns: 500 },
    );
  });
});
