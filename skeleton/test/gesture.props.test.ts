/**
 * Gesture engine properties:
 *  P12 one gesture, one press
 *  P3  (partial) face lost means no press
 * plus: the gesture acceptance time is the one used, and short gestures never count (P7).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { createGestureState, stepGesture, type GestureEvent } from '../src/engine/gesture';
import type { GestureScores } from '../src/engine/head-pointer';
import { clampProfile, type Profile } from '../src/engine/profile';

const profileArb: fc.Arbitrary<Profile> = fc
  .record({
    mode: fc.constantFrom('head + gesture' as const, 'gesture scan' as const),
    switchGesture: fc.constantFrom('jaw open' as const, 'brow raise' as const),
    gestureThreshold: fc.double({ min: 0.1, max: 0.95, noNaN: true }),
    gestureReleaseThreshold: fc.double({ min: 0.05, max: 0.9, noNaN: true }),
    gestureAcceptanceTime: fc.integer({ min: 100, max: 2000 }),
    switchAcceptanceTime: fc.integer({ min: 0, max: 2000 }),
    cancelByHold: fc.boolean(),
    cancelHoldTime: fc.integer({ min: 1000, max: 5000 }),
    inputTimeout: fc.integer({ min: 500, max: 10000 }),
  })
  .map((r) => clampProfile(r));

function scoresFor(p: Profile, v: number, other: number): GestureScores {
  return p.switchGesture === 'jaw open' ? { jawOpen: v, browRaise: other } : { jawOpen: other, browRaise: v };
}

describe('P12 one gesture, one press', () => {
  it('a gesture that crosses the threshold once and stays above the release threshold presses at most once', () => {
    fc.assert(
      fc.property(
        profileArb,
        fc.array(fc.record({ gap: fc.integer({ min: 5, max: 60 }), frac: fc.double({ min: 0, max: 1, noNaN: true }) }), {
          minLength: 1,
          maxLength: 300,
        }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (p, trace, other) => {
          const s = createGestureState();
          const rel = p.gestureReleaseThreshold;
          const thr = p.gestureThreshold;
          // Rest below the release threshold, then cross the threshold once, then wander
          // anywhere at or above the release threshold (including between the thresholds),
          // for any duration (gaps stay below the smallest input timeout).
          stepGesture(s, { gestureScores: scoresFor(p, 0, other) }, 0, p);
          let t = 16;
          const events: GestureEvent[] = [];
          events.push(...stepGesture(s, { gestureScores: scoresFor(p, thr, other) }, t, p));
          for (const { gap, frac } of trace) {
            t += gap;
            const v = rel + (1 - rel) * frac; // ≥ rel
            events.push(...stepGesture(s, { gestureScores: scoresFor(p, v, other) }, t, p));
          }
          expect(events.filter((e) => e.type === 'press').length).toBeLessThanOrEqual(1);
          // cancel-by-hold off and long enough: exactly one press
          if (!p.cancelByHold && t - 16 >= p.gestureAcceptanceTime) {
            expect(events.filter((e) => e.type === 'press')).toHaveLength(1);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it('presses never outnumber the release-threshold drops plus one, for any score trace', () => {
    fc.assert(
      fc.property(
        profileArb,
        fc.array(fc.record({ gap: fc.integer({ min: 5, max: 400 }), v: fc.double({ min: 0, max: 1, noNaN: true }) }), {
          minLength: 1,
          maxLength: 300,
        }),
        (p, trace) => {
          const s = createGestureState();
          let t = 0;
          let presses = 0;
          let gestures = 0; // activations: the score reaching the threshold after being below release
          let armed = true;
          for (const { gap, v } of trace) {
            t += gap;
            if (v < p.gestureReleaseThreshold) armed = true;
            if (armed && v >= p.gestureThreshold) {
              gestures++;
              armed = false;
            }
            presses += stepGesture(s, { gestureScores: scoresFor(p, v, 0) }, t, p).filter((e) => e.type === 'press').length;
          }
          expect(presses).toBeLessThanOrEqual(gestures);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('P3 (partial) face lost means no press', () => {
  it('no press or cancel is emitted on any sample where the face is not detected', () => {
    fc.assert(
      fc.property(
        profileArb,
        fc.array(
          fc.record({
            lost: fc.boolean(),
            n: fc.integer({ min: 1, max: 60 }),
            gap: fc.integer({ min: 5, max: 60 }),
            v: fc.double({ min: 0, max: 1, noNaN: true }),
            wobble: fc.double({ min: 0, max: 0.3, noNaN: true }),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (p, periods) => {
          const s = createGestureState();
          let t = 0;
          for (const per of periods) {
            for (let i = 0; i < per.n; i++) {
              t += per.gap;
              const v = Math.min(1, per.v + (i % 2 === 0 ? per.wobble : -per.wobble));
              const ev = stepGesture(s, { gestureScores: per.lost ? null : scoresFor(p, v, 0) }, t, p);
              if (per.lost) expect(ev).toEqual([]);
            }
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it('a gesture interrupted by a loss gives no press when the face returns still mid-gesture', () => {
    fc.assert(
      fc.property(profileArb, fc.integer({ min: 1, max: 30 }), fc.integer({ min: 1, max: 100 }), (p, before, after) => {
        const s = createGestureState();
        let t = 0;
        const events: GestureEvent[] = [];
        const high = scoresFor(p, 1, 0);
        for (let i = 0; i < before; i++) events.push(...stepGesture(s, { gestureScores: high }, (t += 16), p));
        events.push(...stepGesture(s, { gestureScores: null }, (t += 16), p));
        const pressesBefore = events.filter((e) => e.type === 'press').length;
        for (let i = 0; i < after; i++) events.push(...stepGesture(s, { gestureScores: high }, (t += 16), p));
        // The face returned with the gesture still held: nothing more counts until it is released.
        expect(events.filter((e) => e.type === 'press').length).toBe(pressesBefore);
      }),
      { numRuns: 300 },
    );
  });
});

describe('P7 for gestures: short gestures never count, timed with the gesture acceptance time', () => {
  it('a gesture held for less than gestureAcceptanceTime never presses, whatever the switch acceptance time', () => {
    fc.assert(
      fc.property(profileArb, fc.nat(), fc.integer({ min: 5, max: 50 }), (p, pick, dt) => {
        const hold = 1 + (pick % (p.gestureAcceptanceTime - 1)); // in [1, acceptance − 1]
        const s = createGestureState();
        const events: GestureEvent[] = [];
        stepGesture(s, { gestureScores: scoresFor(p, 0, 0) }, 0, p);
        for (let t = 1; t < 1 + hold; t += dt) events.push(...stepGesture(s, { gestureScores: scoresFor(p, 1, 0) }, t, p));
        events.push(...stepGesture(s, { gestureScores: scoresFor(p, 0, 0) }, 1 + hold, p));
        expect(events).toEqual([]);
      }),
      { numRuns: 500 },
    );
  });
});
