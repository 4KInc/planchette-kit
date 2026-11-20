import { describe, it, expect } from 'vitest';
import {
  cloneGestureState,
  createGestureState,
  stepGesture,
  switchGestureScore,
  type GestureEvent,
  type GestureState,
} from '../src/engine/gesture';
import type { GestureScores } from '../src/engine/head-pointer';
import { defaultProfile, type Profile } from '../src/engine/profile';

// gesture threshold 0.5, release 0.3, gesture acceptance 300 ms, switch acceptance 0,
// cancel hold 2000 ms, input timeout 2000 ms
const HOLD_OFF: Profile = { ...defaultProfile, mode: 'gesture scan', cancelByHold: false };
const HOLD_ON: Profile = { ...defaultProfile, mode: 'gesture scan', cancelByHold: true };

const jaw = (v: number): GestureScores => ({ jawOpen: v, browRaise: 0 });
const brow = (v: number): GestureScores => ({ jawOpen: 0, browRaise: v });

type Timed = GestureEvent & { at: number };

/** Feed [now, scores | null] samples; return events with their sample times. */
function feed(s: GestureState, samples: Array<[number, GestureScores | null]>, p: Profile): Timed[] {
  const out: Timed[] = [];
  for (const [t, g] of samples) for (const e of stepGesture(s, { gestureScores: g }, t, p)) out.push({ ...e, at: t });
  return out;
}

/** The same scores every 16 ms from t0 to t1 inclusive. */
function hold(t0: number, t1: number, g: GestureScores | null): Array<[number, GestureScores | null]> {
  const out: Array<[number, GestureScores | null]> = [];
  for (let t = t0; t <= t1; t += 16) out.push([t, g]);
  return out;
}

describe('activation at the threshold', () => {
  it('jaw open activates at the gesture threshold and presses at the gesture acceptance time', () => {
    const s = createGestureState();
    const ev = feed(s, [...hold(0, 288, jaw(0.5)), ...hold(304, 400, jaw(0.5))], HOLD_OFF);
    // activation at 0; the first sample at or after 300 ms is 304
    expect(ev).toEqual([{ type: 'press', at: 304 }]);
  });

  it('brow raise activates at the threshold when the switch gesture is brow raise', () => {
    const p: Profile = { ...HOLD_OFF, switchGesture: 'brow raise' };
    const s = createGestureState();
    expect(feed(s, hold(0, 400, brow(0.5)), p)).toEqual([{ type: 'press', at: 304 }]);
  });

  it('the other gesture does nothing', () => {
    const s1 = createGestureState();
    expect(feed(s1, hold(0, 1000, brow(1)), HOLD_OFF)).toEqual([]);
    const s2 = createGestureState();
    expect(feed(s2, hold(0, 1000, jaw(1)), { ...HOLD_OFF, switchGesture: 'brow raise' })).toEqual([]);
  });

  it('just below the threshold never activates', () => {
    const s = createGestureState();
    expect(feed(s, hold(0, 2000, jaw(0.4999)), HOLD_OFF)).toEqual([]);
    expect(s.signal).toBe(false);
  });

  it('uses the gesture acceptance time, not the switch acceptance time', () => {
    const p: Profile = { ...HOLD_OFF, switchAcceptanceTime: 0, gestureAcceptanceTime: 800 };
    const s = createGestureState();
    const ev = feed(s, hold(0, 1000, jaw(0.9)), p);
    expect(ev).toEqual([{ type: 'press', at: 800 }]);
  });

  it('a gesture shorter than the acceptance time is ignored', () => {
    const s = createGestureState();
    expect(feed(s, [...hold(0, 288, jaw(0.9)), ...hold(304, 1000, jaw(0))], HOLD_OFF)).toEqual([]);
  });
});

describe('release threshold and hysteresis', () => {
  it('a score below the release threshold makes the signal inactive', () => {
    const s = createGestureState();
    feed(s, hold(0, 400, jaw(0.9)), HOLD_OFF);
    expect(s.signal).toBe(true);
    feed(s, [[416, jaw(0.29)]], HOLD_OFF);
    expect(s.signal).toBe(false);
  });

  it('a score between the two thresholds keeps the signal as it was', () => {
    const s = createGestureState();
    feed(s, hold(0, 100, jaw(0.4)), HOLD_OFF);
    expect(s.signal).toBe(false);
    feed(s, [[116, jaw(0.6)], [132, jaw(0.4)]], HOLD_OFF);
    expect(s.signal).toBe(true);
    feed(s, [[148, jaw(0.3)]], HOLD_OFF);
    expect(s.signal).toBe(true); // 0.3 is not below the release threshold
  });

  it('one long gesture counts as one press, even when it dips to between the thresholds', () => {
    const s = createGestureState();
    const ev = feed(
      s,
      [...hold(0, 1000, jaw(0.9)), ...hold(1016, 1500, jaw(0.35)), ...hold(1516, 3000, jaw(0.9))],
      HOLD_OFF,
    );
    expect(ev.filter((e) => e.type === 'press')).toHaveLength(1);
  });

  it('a new press needs the score to fall below the release threshold first', () => {
    const s = createGestureState();
    const ev = feed(s, [...hold(0, 500, jaw(0.9)), ...hold(516, 600, jaw(0.2)), ...hold(616, 1100, jaw(0.9))], HOLD_OFF);
    expect(ev.map((e) => e.at)).toEqual([304, 920]); // second activation at 616; first sample at or after 916
  });
});

describe('cancel-by-hold', () => {
  it('on: the press counts on release, after the acceptance time', () => {
    const s = createGestureState();
    const ev = feed(s, [...hold(0, 1000, jaw(0.9)), [1016, jaw(0.1)]], HOLD_ON);
    expect(ev).toEqual([{ type: 'press', at: 1016 }]);
  });

  it('on: holding the gesture to the cancel hold time cancels, with no press', () => {
    const s = createGestureState();
    const ev = feed(s, [...hold(0, 3000, jaw(0.9)), [3016, jaw(0.1)]], HOLD_ON);
    expect(ev).toEqual([{ type: 'cancel', at: 2000 }]);
  });

  it('on: dropping to between the thresholds does not release the gesture', () => {
    const s = createGestureState();
    const ev = feed(s, [...hold(0, 1000, jaw(0.9)), ...hold(1016, 1500, jaw(0.4))], HOLD_ON);
    expect(ev).toEqual([]);
  });
});

describe('face not detected', () => {
  it('no face, no press', () => {
    const s = createGestureState();
    expect(feed(s, hold(0, 3000, null), HOLD_OFF)).toEqual([]);
    expect(feed(s, hold(3016, 6000, null), HOLD_ON)).toEqual([]);
  });

  it('losing the face mid-gesture drops it silently: no press on the lost frame or after', () => {
    // cancel-by-hold on: the press would come on release, so a loss must not count as one
    const s = createGestureState();
    const ev = feed(s, [...hold(0, 800, jaw(0.9)), ...hold(816, 1200, null)], HOLD_ON);
    expect(ev).toEqual([]);
  });

  it('after a loss the gesture must be released before a new one counts', () => {
    const s = createGestureState();
    const ev = feed(
      s,
      [
        ...hold(0, 200, jaw(0.9)),
        ...hold(216, 400, null),
        ...hold(416, 1500, jaw(0.9)), // still open when the face returns: ignored
        ...hold(1516, 1600, jaw(0.1)),
        ...hold(1616, 2000, jaw(0.9)),
      ],
      HOLD_OFF,
    );
    expect(ev).toEqual([{ type: 'press', at: 1920 }]);
  });

  it('a face that returns with the gesture released can press straight away', () => {
    const s = createGestureState();
    const ev = feed(s, [...hold(0, 200, jaw(0.9)), ...hold(216, 400, null), ...hold(416, 800, jaw(0.9))], HOLD_OFF);
    expect(ev).toEqual([]);
    const s2 = createGestureState();
    const ev2 = feed(
      s2,
      [...hold(0, 200, jaw(0.9)), ...hold(216, 400, null), [416, jaw(0)], ...hold(432, 800, jaw(0.9))],
      HOLD_OFF,
    );
    expect(ev2).toEqual([{ type: 'press', at: 736 }]);
  });
});

describe('head + gesture: an expired freeze gives no press', () => {
  // freeze window = gestureAcceptanceTime (300) + 300 = 600 ms after the release-threshold crossing
  const G: Profile = { ...HOLD_OFF, mode: 'head + gesture' };

  it('a slow gesture that reaches the threshold after the window never presses', () => {
    const s = createGestureState();
    const ev = feed(s, [...hold(0, 592, jaw(0.4)), ...hold(608, 2000, jaw(0.9))], G);
    expect(ev).toEqual([]);
  });

  it('reaching the threshold exactly at the end of the window still counts', () => {
    const s = createGestureState();
    const ev = feed(s, [[0, jaw(0.4)], [600, jaw(0.9)], ...hold(616, 1000, jaw(0.9))], G);
    expect(ev).toEqual([{ type: 'press', at: 904 }]);
  });

  it('after the release, the next gesture counts normally', () => {
    const s = createGestureState();
    const ev = feed(
      s,
      [...hold(0, 800, jaw(0.4)), ...hold(816, 1000, jaw(0.1)), ...hold(1016, 1500, jaw(0.9))],
      G,
    );
    expect(ev.map((e) => e.at)).toEqual([1320]);
  });

  it('the same slow gesture does press in gesture scan mode, where there is no freeze', () => {
    const s = createGestureState();
    const ev = feed(s, [...hold(0, 592, jaw(0.4)), ...hold(608, 2000, jaw(0.9))], HOLD_OFF);
    expect(ev).toEqual([{ type: 'press', at: 912 }]);
  });
});

describe('scores, timestamps and cloning', () => {
  it('a non-finite score counts as 0', () => {
    expect(switchGestureScore({ jawOpen: NaN, browRaise: 1 }, HOLD_OFF)).toBe(0);
    const s = createGestureState();
    expect(feed(s, hold(0, 1000, jaw(Infinity)), HOLD_OFF)).toEqual([]);
  });

  it('ignores duplicate, backwards and non-finite timestamps', () => {
    const s = createGestureState();
    feed(s, hold(0, 200, jaw(0.9)), HOLD_OFF);
    const snap = cloneGestureState(s);
    for (const t of [192, 100, NaN, Infinity]) expect(stepGesture(s, { gestureScores: jaw(0) }, t, HOLD_OFF)).toEqual([]);
    expect(s).toEqual(snap);
  });

  it('silence for the input timeout resets a gesture in progress without a press', () => {
    const s = createGestureState();
    feed(s, hold(0, 200, jaw(0.9)), HOLD_ON);
    const ev = feed(s, [[200 + HOLD_ON.inputTimeout, jaw(0)]], HOLD_ON);
    expect(ev).toEqual([]);
  });

  it('a clone evolves identically and independently', () => {
    const s = createGestureState();
    feed(s, hold(0, 200, jaw(0.9)), HOLD_ON);
    const c = cloneGestureState(s);
    expect(c.press).not.toBe(s.press);
    const a = feed(s, [...hold(216, 900, jaw(0.9)), [916, jaw(0)]], HOLD_ON);
    const b = feed(c, [...hold(216, 900, jaw(0.9)), [916, jaw(0)]], HOLD_ON);
    expect(a).toEqual(b);
    expect(a).toEqual([{ type: 'press', at: 916 }]);
  });
});
