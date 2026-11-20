import { describe, it, expect } from 'vitest';
import {
  cloneCalibrationState,
  createCalibrationState,
  stepCalibration,
  type CalibrationEvent,
  type CalibrationResult,
  type CalibrationState,
} from '../src/engine/calibration';
import type { FaceRotation, GestureScores } from '../src/engine/head-pointer';
import { defaultProfile, type Profile } from '../src/engine/profile';

// stillness threshold 2 deg, stillness time 1500 ms, step timeout 6000 ms,
// gesture threshold 0.5, release threshold 0.3, switch gesture 'jaw open'
const P: Profile = Object.freeze({ ...defaultProfile });
const DT = 16;

type PoseFn = FaceRotation | null | ((i: number) => FaceRotation | null);
type ScoreFn = GestureScores | null | ((i: number) => GestureScores | null);

interface Driver {
  s: CalibrationState;
  t: number;
  events: CalibrationEvent[];
  profile: Profile;
}

function driver(run: 'full' | 'centre' = 'full', profile: Profile = P): Driver {
  return { s: createCalibrationState(run), t: 0, events: [], profile };
}

const jaw = (v: number): GestureScores => ({ jawOpen: v, browRaise: 0.99 - v / 10 });

/** Feed one sample per 16 ms, starting one tick after the last, for `n` samples. */
function feedN(d: Driver, n: number, pose: PoseFn, scores: ScoreFn = null): CalibrationEvent[] {
  const out: CalibrationEvent[] = [];
  for (let i = 0; i < n; i++) {
    d.t += DT;
    const r = typeof pose === 'function' ? pose(i) : pose;
    const g = typeof scores === 'function' ? scores(i) : scores;
    const ev = stepCalibration(d.s, { rotation: r, gestureScores: g }, d.t, d.profile);
    out.push(...ev);
  }
  d.events.push(...out);
  return out;
}

/** Feed samples until the current step ends (at most 30 s). Returns the events of this call. */
function untilStepEnds(d: Driver, pose: PoseFn, scores: ScoreFn = null): CalibrationEvent[] {
  const from = d.s.step;
  const out: CalibrationEvent[] = [];
  let i = 0;
  while (d.s.step === from && i < 2000) {
    out.push(...feedN(d, 1, typeof pose === 'function' ? () => pose(i) : pose, typeof scores === 'function' ? () => scores(i) : scores));
    i++;
  }
  return out;
}

function endOf(events: CalibrationEvent[], step: string) {
  return events.find((e) => e.type === 'step' && e.step === step && e.completed) as
    | Extract<CalibrationEvent, { type: 'step' }>
    | undefined;
}

function doneOf(d: Driver): CalibrationResult {
  const e = d.events.find((x) => x.type === 'done');
  if (!e || e.type !== 'done') throw new Error('no done event');
  return e.result;
}

interface Plan {
  left?: FaceRotation;
  right?: FaceRotation;
  up?: FaceRotation;
  down?: FaceRotation;
  rest?: ScoreFn;
  gesture?: ScoreFn;
  noise?: number;
}

/** A full run on a still head with the given poses and gesture scores. */
function fullRun(plan: Plan = {}, profile: Profile = P): Driver {
  const d = driver('full', profile);
  const wob = plan.noise ?? 0;
  const at = (p: FaceRotation) => (i: number): FaceRotation => ({
    yaw: p.yaw + (i % 2 ? wob : -wob),
    pitch: p.pitch,
  });
  untilStepEnds(d, at({ yaw: 0, pitch: 0 }));
  untilStepEnds(d, at(plan.left ?? { yaw: -10, pitch: 0 }));
  untilStepEnds(d, at(plan.right ?? { yaw: 12, pitch: 0 }));
  untilStepEnds(d, at(plan.up ?? { yaw: 0, pitch: 8 }));
  untilStepEnds(d, at(plan.down ?? { yaw: 0, pitch: -6 }));
  untilStepEnds(d, { yaw: 0, pitch: 0 }, plan.rest ?? jaw(0.1));
  untilStepEnds(d, { yaw: 0, pitch: 0 }, plan.gesture ?? jaw(0.8));
  return d;
}

describe('stillness and timeout on head steps', () => {
  it('a still head ends the step after the stillness time, not before', () => {
    const d = driver();
    const early = feedN(d, 93, { yaw: 1, pitch: 1 }); // last sample 1488 ms, window 1472 ms long
    expect(endOf(early, 'centre')).toBeUndefined();
    const ev = feedN(d, 2, { yaw: 1, pitch: 1 }); // window reaches 1504 ms
    expect(endOf(ev, 'centre')).toMatchObject({ completed: true, timeout: false });
    expect(d.s.step).toBe('left');
  });

  it('movement beyond the stillness threshold restarts the window', () => {
    const d = driver();
    feedN(d, 80, { yaw: 0, pitch: 0 }); // 1280 ms still
    feedN(d, 1, { yaw: 3, pitch: 0 }); // a 3 deg jump (threshold 2) restarts the window
    const ev = feedN(d, 90, { yaw: 3, pitch: 0 }); // 1440 ms in the new window
    expect(endOf(ev, 'centre')).toBeUndefined();
    expect(endOf(feedN(d, 5, { yaw: 3, pitch: 0 }), 'centre')).toMatchObject({ timeout: false });
  });

  it('a head that never settles advances at the step timeout, with timeout true', () => {
    const d = driver();
    const wobble = (i: number) => ({ yaw: i % 2 ? 4 : -4, pitch: 0 });
    const ev = feedN(d, 400, wobble); // 6400 ms
    const end = endOf(ev, 'centre');
    expect(end).toMatchObject({ completed: true, timeout: true });
    expect(d.s.step).toBe('left');
    // the timeout is 6000 ms after the first sample (t = 16): the 376th sample
    expect(d.events.filter((e) => e.type === 'step' && e.completed).length).toBe(1);
    expect(d.t).toBe(400 * DT);
  });

  it('timeout is measured from the step start, which is when the previous step ended', () => {
    const d = driver();
    untilStepEnds(d, { yaw: 0, pitch: 0 });
    const endedAt = d.t;
    const wobble = (i: number) => ({ yaw: i % 2 ? 4 : -4, pitch: 0 });
    feedN(d, Math.floor(5900 / DT), wobble);
    expect(d.s.step).toBe('left');
    expect(d.t - endedAt).toBeLessThan(6000);
    feedN(d, 10, wobble);
    expect(d.s.step).toBe('right');
  });

  it('no face empties the window, so stillness has to start again', () => {
    const d = driver();
    feedN(d, 80, { yaw: 0, pitch: 0 });
    feedN(d, 1, null);
    expect(endOf(feedN(d, 60, { yaw: 0, pitch: 0 }), 'centre')).toBeUndefined();
    expect(endOf(feedN(d, 40, { yaw: 0, pitch: 0 }), 'centre')).toBeDefined();
  });

  it('with no face for the whole step it times out with no measurement', () => {
    const d = driver();
    const ev = feedN(d, 400, null);
    expect(endOf(ev, 'centre')).toMatchObject({ timeout: true });
    expect(d.s.centre).toBeNull();
  });

  it('ignores a sample whose time is not finite', () => {
    const d = driver();
    expect(stepCalibration(d.s, { rotation: { yaw: 0, pitch: 0 } }, NaN, P)).toHaveLength(0);
    expect(d.s.started).toBe(false);
  });

  it('measures the centre as the mean over the stillness window', () => {
    const d = driver();
    untilStepEnds(d, (i) => ({ yaw: 1 + (i % 2 ? 0.5 : -0.5), pitch: -2 }));
    expect(d.s.centre!.yaw).toBeCloseTo(1, 1);
    expect(d.s.centre!.pitch).toBeCloseTo(-2, 5);
  });
});

describe('events', () => {
  it('announces each step when it starts and when it ends, in order', () => {
    const d = fullRun();
    const steps = d.events.filter((e) => e.type === 'step').map((e) => (e.type === 'step' ? `${e.step}:${e.completed ? 'end' : 'start'}` : ''));
    expect(steps).toEqual([
      'centre:start', 'centre:end',
      'left:start', 'left:end',
      'right:start', 'right:end',
      'up:start', 'up:end',
      'down:start', 'down:end',
      'rest:start', 'rest:end',
      'gesture:start', 'gesture:end',
    ]);
    expect(d.events[d.events.length - 1].type).toBe('done');
    expect(d.events.filter((e) => e.type === 'done')).toHaveLength(1);
    expect(d.s.step).toBe('done');
  });

  it('produces nothing after done', () => {
    const d = fullRun();
    expect(feedN(d, 50, { yaw: 0, pitch: 0 }, jaw(0.9))).toHaveLength(0);
  });
});

describe('ranges', () => {
  it('stores symmetric ranges', () => {
    const d = fullRun({ left: { yaw: -10, pitch: 0 }, right: { yaw: 10, pitch: 0 }, up: { yaw: 0, pitch: 7 }, down: { yaw: 0, pitch: -7 } });
    const r = doneOf(d);
    expect(r.rejected).toBeNull();
    expect(r.ranges).toEqual({ left: 10, right: 10, up: 7, down: 7 });
    expect(r.profile).toMatchObject({ calibrationRangeLeft: 10, calibrationRangeRight: 10, calibrationRangeUp: 7, calibrationRangeDown: 7 });
  });

  it('stores asymmetric ranges, each in its own direction', () => {
    const r = doneOf(fullRun());
    expect(r.ranges).toEqual({ left: 10, right: 12, up: 8, down: 6 });
    expect(r.profile.calibrationRangeLeft).toBe(10);
    expect(r.profile.calibrationRangeRight).toBe(12);
    expect(r.profile.calibrationRangeUp).toBe(8);
    expect(r.profile.calibrationRangeDown).toBe(6);
  });

  it('measures ranges from the centre of this run, not from zero', () => {
    const d = driver();
    untilStepEnds(d, { yaw: 5, pitch: -3 });
    untilStepEnds(d, { yaw: -5, pitch: -3 }); // left: 10 from centre
    untilStepEnds(d, { yaw: 14, pitch: -3 }); // right: 9
    untilStepEnds(d, { yaw: 5, pitch: 6 }); // up: 9
    untilStepEnds(d, { yaw: 5, pitch: -9 }); // down: 6
    untilStepEnds(d, { yaw: 5, pitch: -3 }, jaw(0.1));
    untilStepEnds(d, { yaw: 5, pitch: -3 }, jaw(0.8));
    expect(doneOf(d).ranges).toEqual({ left: 10, right: 9, up: 9, down: 6 });
  });

  it('rejects the head ranges when any range is below the minimum, and keeps the old ones', () => {
    const d = fullRun({ left: { yaw: -2.5, pitch: 0 } });
    const r = doneOf(d);
    expect(r.rejected).toBe('range-too-small');
    expect(r.ranges).toBeNull();
    expect(r.profile.calibrationRangeLeft).toBeUndefined();
    expect(r.profile.calibrationRangeRight).toBeUndefined();
  });

  it('accepts a range of exactly the minimum', () => {
    const d = fullRun({ down: { yaw: 0, pitch: -3 } });
    expect(doneOf(d).rejected).toBeNull();
  });

  it('rejects a head that moved the wrong way', () => {
    const d = fullRun({ right: { yaw: -4, pitch: 0 } });
    expect(doneOf(d).rejected).toBe('range-too-small');
  });

  it('rejects when no face was seen in a head step', () => {
    const d = driver();
    untilStepEnds(d, { yaw: 0, pitch: 0 });
    untilStepEnds(d, { yaw: -10, pitch: 0 });
    untilStepEnds(d, null);
    untilStepEnds(d, { yaw: 0, pitch: 8 });
    untilStepEnds(d, { yaw: 0, pitch: -6 });
    untilStepEnds(d, { yaw: 0, pitch: 0 }, jaw(0.1));
    untilStepEnds(d, { yaw: 0, pitch: 0 }, jaw(0.8));
    expect(doneOf(d).rejected).toBe('range-too-small');
  });

  it('rejects with no-centre when the centre step saw no face', () => {
    const d = driver();
    untilStepEnds(d, null);
    untilStepEnds(d, { yaw: -10, pitch: 0 });
    untilStepEnds(d, { yaw: 12, pitch: 0 });
    untilStepEnds(d, { yaw: 0, pitch: 8 });
    untilStepEnds(d, { yaw: 0, pitch: -6 });
    untilStepEnds(d, { yaw: 0, pitch: 0 }, jaw(0.1));
    untilStepEnds(d, { yaw: 0, pitch: 0 }, jaw(0.8));
    expect(doneOf(d).rejected).toBe('no-centre');
  });

  it('still sets the gesture thresholds when the head ranges are rejected', () => {
    const r = doneOf(fullRun({ left: { yaw: -2.5, pitch: 0 } }));
    expect(r.rejected).toBe('range-too-small');
    expect(r.gesture!.applied).toBe(true);
    expect(r.profile.gestureThreshold).toBeCloseTo(0.52, 5);
  });
});

describe('tremor', () => {
  it('a std-dev above 0.5 deg on any head step sets suggestHighTremor', () => {
    expect(doneOf(fullRun({ noise: 0.7 })).suggestHighTremor).toBe(true);
  });

  it('a std-dev of 0.4 deg does not', () => {
    expect(doneOf(fullRun({ noise: 0.4 })).suggestHighTremor).toBe(false);
  });

  it('pitch tremor counts as well as yaw tremor', () => {
    const d = driver();
    untilStepEnds(d, (i) => ({ yaw: 0, pitch: i % 2 ? 0.8 : -0.8 }));
    untilStepEnds(d, { yaw: -10, pitch: 0 });
    untilStepEnds(d, { yaw: 12, pitch: 0 });
    untilStepEnds(d, { yaw: 0, pitch: 8 });
    untilStepEnds(d, { yaw: 0, pitch: -6 });
    untilStepEnds(d, { yaw: 0, pitch: 0 }, jaw(0.1));
    untilStepEnds(d, { yaw: 0, pitch: 0 }, jaw(0.8));
    expect(doneOf(d).suggestHighTremor).toBe(true);
  });

  it('head movement while making the gesture does not count as tremor', () => {
    const d = driver();
    untilStepEnds(d, { yaw: 0, pitch: 0 });
    untilStepEnds(d, { yaw: -10, pitch: 0 });
    untilStepEnds(d, { yaw: 12, pitch: 0 });
    untilStepEnds(d, { yaw: 0, pitch: 8 });
    untilStepEnds(d, { yaw: 0, pitch: -6 });
    untilStepEnds(d, (i) => ({ yaw: i % 2 ? 0.9 : -0.9, pitch: 0 }), jaw(0.1));
    untilStepEnds(d, (i) => ({ yaw: i % 2 ? 0.9 : -0.9, pitch: 0 }), jaw(0.8));
    expect(doneOf(d).suggestHighTremor).toBe(false);
  });
});

describe('gesture step', () => {
  it('runs after the five head steps, rest first, then gesture', () => {
    const d = fullRun();
    const order = d.events.filter((e) => e.type === 'step' && e.completed).map((e) => (e.type === 'step' ? e.step : ''));
    expect(order).toEqual(['centre', 'left', 'right', 'up', 'down', 'rest', 'gesture']);
  });

  it('sets the thresholds from the rest and deliberate scores', () => {
    const r = doneOf(fullRun({ rest: jaw(0.1), gesture: jaw(0.8) }));
    // range 0.7: threshold 0.1 + 0.6 × 0.7 = 0.52, release 0.1 + 0.3 × 0.7 = 0.31
    expect(r.gesture).toMatchObject({ rest: expect.closeTo(0.1, 5), deliberate: expect.closeTo(0.8, 5), applied: true, kept: null });
    expect(r.profile.gestureThreshold).toBeCloseTo(0.52, 5);
    expect(r.profile.gestureReleaseThreshold).toBeCloseTo(0.31, 5);
  });

  it('uses a different rest score to get a different threshold (not a fixed fraction of the deliberate score)', () => {
    const r = doneOf(fullRun({ rest: jaw(0.3), gesture: jaw(0.9) }));
    expect(r.profile.gestureThreshold).toBeCloseTo(0.3 + 0.6 * 0.6, 5); // 0.66
    expect(r.profile.gestureReleaseThreshold).toBeCloseTo(0.3 + 0.3 * 0.6, 5); // 0.48
  });

  it('measures the mean resting score over the window', () => {
    const r = doneOf(fullRun({ rest: (i) => jaw(i % 2 ? 0.2 : 0.4), gesture: jaw(0.9) }));
    expect(r.gesture!.rest).toBeCloseTo(0.3, 2);
  });

  it('reads the score of profile.switchGesture, not the other one', () => {
    const brow = (v: number): GestureScores => ({ browRaise: v, jawOpen: 0.5 });
    const profile: Profile = { ...P, switchGesture: 'brow raise' };
    const r = doneOf(fullRun({ rest: brow(0.1), gesture: brow(0.7) }, profile));
    expect(r.gesture!.rest).toBeCloseTo(0.1, 5);
    expect(r.gesture!.deliberate).toBeCloseTo(0.7, 5);
    expect(r.profile.gestureThreshold).toBeCloseTo(0.46, 5);
  });

  it('takes the deliberate score from the part of the window where the gesture is held', () => {
    // 60 % of the samples at rest level, then the gesture held: a mean would be diluted
    const g = (i: number) => jaw(i < 55 ? 0.1 : 0.8);
    const r = doneOf(fullRun({ rest: jaw(0.1), gesture: g }));
    expect(r.gesture!.deliberate).toBeCloseTo(0.8, 5);
  });

  it('one noisy frame does not set the deliberate score', () => {
    const g = (i: number) => jaw(i === 40 ? 1 : 0.6);
    const r = doneOf(fullRun({ rest: jaw(0.1), gesture: g }));
    expect(r.gesture!.deliberate).toBeCloseTo(0.6, 5);
  });

  it('clamps the thresholds to the profile limits and keeps release below threshold', () => {
    // range 0.15 from rest 0: threshold 0.09 → 0.1; release 0.045 → 0.05
    const low = doneOf(fullRun({ rest: jaw(0), gesture: jaw(0.15) }));
    expect(low.gesture!.applied).toBe(true);
    expect(low.profile.gestureThreshold).toBeCloseTo(0.1, 5);
    expect(low.profile.gestureReleaseThreshold).toBeCloseTo(0.05, 5);
    // a high gesture: threshold capped at 0.95, release at most threshold − 0.05
    const high = doneOf(fullRun({ rest: jaw(0.9), gesture: jaw(1.3) }));
    expect(high.profile.gestureThreshold).toBeCloseTo(0.95, 5);
    expect(high.profile.gestureReleaseThreshold!).toBeLessThanOrEqual(0.9 + 1e-9);
    for (const r of [low, high]) {
      expect(r.profile.gestureReleaseThreshold!).toBeLessThan(r.profile.gestureThreshold!);
    }
  });

  it('applies a range of 0.16 and keeps the old thresholds at 0.14', () => {
    const ok = doneOf(fullRun({ rest: jaw(0.3), gesture: jaw(0.46) }));
    expect(ok.gesture!.applied).toBe(true);
    const small = doneOf(fullRun({ rest: jaw(0.3), gesture: jaw(0.44) }));
    expect(small.gesture!.applied).toBe(false);
  });

  it('keeps the old thresholds when the gesture range is too small, and says so', () => {
    const profile: Profile = { ...P, gestureThreshold: 0.42, gestureReleaseThreshold: 0.21 };
    const d = fullRun({ rest: jaw(0.3), gesture: jaw(0.35) }, profile);
    const r = doneOf(d);
    expect(r.gesture).toMatchObject({ applied: false, kept: 'range-too-small' });
    expect(r.gesture!.range).toBeCloseTo(0.05, 5);
    expect(r.profile.gestureThreshold).toBeUndefined();
    expect(r.profile.gestureReleaseThreshold).toBeUndefined();
    // the calibration as a whole is not rejected: the head ranges are still there
    expect(r.rejected).toBeNull();
    expect(r.profile.calibrationRangeLeft).toBe(10);
  });

  it('keeps the old thresholds when the deliberate score is below the rest score', () => {
    const r = doneOf(fullRun({ rest: jaw(0.5), gesture: jaw(0.2) }));
    expect(r.gesture).toMatchObject({ applied: false, kept: 'range-too-small' });
    expect(r.profile.gestureThreshold).toBeUndefined();
  });

  it('keeps the old thresholds when a phase saw no face', () => {
    const d = driver();
    untilStepEnds(d, { yaw: 0, pitch: 0 });
    untilStepEnds(d, { yaw: -10, pitch: 0 });
    untilStepEnds(d, { yaw: 12, pitch: 0 });
    untilStepEnds(d, { yaw: 0, pitch: 8 });
    untilStepEnds(d, { yaw: 0, pitch: -6 });
    untilStepEnds(d, null);
    untilStepEnds(d, { yaw: 0, pitch: 0 }, jaw(0.8));
    const r = doneOf(d);
    expect(r.gesture).toMatchObject({ rest: null, applied: false, kept: 'no-measurement' });
    expect(r.profile.gestureThreshold).toBeUndefined();
  });

  it('does not change the profile it was given', () => {
    const frozen: Profile = Object.freeze({ ...P });
    expect(() => fullRun({}, frozen)).not.toThrow();
    expect(frozen.gestureThreshold).toBe(0.5);
  });

  describe.each(['rest', 'gesture'] as const)('the %s phase follows the stillness and timeout rules', (phase) => {
    /** A driver at the start of the given phase. */
    function atPhase(): Driver {
      const d = driver();
      untilStepEnds(d, { yaw: 0, pitch: 0 });
      untilStepEnds(d, { yaw: -10, pitch: 0 });
      untilStepEnds(d, { yaw: 12, pitch: 0 });
      untilStepEnds(d, { yaw: 0, pitch: 8 });
      untilStepEnds(d, { yaw: 0, pitch: -6 });
      if (phase === 'gesture') untilStepEnds(d, { yaw: 0, pitch: 0 }, jaw(0.1));
      expect(d.s.step).toBe(phase);
      return d;
    }

    it('ends after the stillness time and not before', () => {
      const d = atPhase();
      expect(endOf(feedN(d, 93, { yaw: 0, pitch: 0 }, jaw(0.5)), phase)).toBeUndefined();
      expect(endOf(feedN(d, 2, { yaw: 0, pitch: 0 }, jaw(0.5)), phase)).toMatchObject({ completed: true, timeout: false });
    });

    it('restarts the window when the head moves', () => {
      const d = atPhase();
      feedN(d, 80, { yaw: 0, pitch: 0 }, jaw(0.5));
      feedN(d, 1, { yaw: 3, pitch: 0 }, jaw(0.5));
      expect(endOf(feedN(d, 90, { yaw: 3, pitch: 0 }, jaw(0.5)), phase)).toBeUndefined();
      expect(endOf(feedN(d, 5, { yaw: 3, pitch: 0 }, jaw(0.5)), phase)).toBeDefined();
    });

    it('restarts the window when the face is lost', () => {
      const d = atPhase();
      feedN(d, 80, { yaw: 0, pitch: 0 }, jaw(0.5));
      feedN(d, 1, null, null);
      expect(endOf(feedN(d, 60, { yaw: 0, pitch: 0 }, jaw(0.5)), phase)).toBeUndefined();
      expect(endOf(feedN(d, 40, { yaw: 0, pitch: 0 }, jaw(0.5)), phase)).toBeDefined();
    });

    it('ends at the step timeout when the head never settles, measuring every sample', () => {
      const d = atPhase();
      const startedAt = d.t;
      const wobble = (i: number) => ({ yaw: i % 2 ? 4 : -4, pitch: 0 });
      // scores alternate 0.2 / 0.6 so the mean over every sample is 0.4
      const ev = feedN(d, 400, wobble, (i) => jaw(i % 2 ? 0.6 : 0.2));
      const end = endOf(ev, phase);
      expect(end).toMatchObject({ completed: true, timeout: true });
      expect(d.s.step).toBe(phase === 'rest' ? 'gesture' : 'done');
      if (phase === 'rest') {
        // 6000 ms after the step started: the step ended on the first sample at or past it
        expect(d.s.rest).toBeCloseTo(0.4, 1);
        expect(d.t).toBeGreaterThan(startedAt + 6000);
      } else {
        expect(d.s.deliberate).toBeCloseTo(0.6, 5); // 90th percentile of {0.2, 0.6}
      }
    });

    it('does not end before the step timeout when the head keeps moving', () => {
      const d = atPhase();
      const wobble = (i: number) => ({ yaw: i % 2 ? 4 : -4, pitch: 0 });
      feedN(d, Math.floor(5900 / DT), wobble, jaw(0.5));
      expect(d.s.step).toBe(phase);
    });
  });
});

describe('centre-only run', () => {
  it('has only the centre step and then done', () => {
    const d = driver('centre');
    untilStepEnds(d, { yaw: 3, pitch: -1 }, jaw(0.9));
    const steps = d.events.filter((e) => e.type === 'step').map((e) => (e.type === 'step' ? `${e.step}:${e.completed ? 'end' : 'start'}` : ''));
    expect(steps).toEqual(['centre:start', 'centre:end']);
    expect(d.s.step).toBe('done');
    expect(d.events.filter((e) => e.type === 'done')).toHaveLength(1);
    expect(feedN(d, 200, { yaw: 3, pitch: -1 }, jaw(0.9))).toHaveLength(0);
  });

  it('skips the gesture step: no rest or gesture events, no gesture result, no thresholds', () => {
    const d = driver('centre');
    untilStepEnds(d, { yaw: 3, pitch: -1 }, jaw(0.9));
    const r = doneOf(d);
    expect(d.events.some((e) => e.type === 'step' && (e.step === 'rest' || e.step === 'gesture'))).toBe(false);
    expect(r.gesture).toBeNull();
    expect(r.profile).toEqual({});
    expect(r.run).toBe('centre');
  });

  it('reports the centre only: no ranges, no rejection, no tremor flag', () => {
    const d = driver('centre');
    untilStepEnds(d, (i) => ({ yaw: 3 + (i % 2 ? 0.9 : -0.9), pitch: -1 }));
    const r = doneOf(d);
    expect(r.centre!.yaw).toBeCloseTo(3, 1);
    expect(r.centre!.pitch).toBeCloseTo(-1, 5);
    expect(r.ranges).toBeNull();
    expect(r.rejected).toBeNull();
    expect(r.suggestHighTremor).toBe(false);
  });

  it('uses the stillness time', () => {
    const d = driver('centre');
    expect(endOf(feedN(d, 93, { yaw: 0, pitch: 0 }), 'centre')).toBeUndefined();
    expect(endOf(feedN(d, 2, { yaw: 0, pitch: 0 }), 'centre')).toMatchObject({ timeout: false });
  });

  it('on timeout the centre is the mean of the samples seen', () => {
    const d = driver('centre');
    const ev = feedN(d, 400, (i) => ({ yaw: 10 + (i % 2 ? 4 : -4), pitch: 0 }));
    expect(endOf(ev, 'centre')).toMatchObject({ timeout: true });
    expect(doneOf(d).centre!.yaw).toBeCloseTo(10, 0);
  });

  it('with no face seen the centre is null', () => {
    const d = driver('centre');
    feedN(d, 400, null);
    expect(doneOf(d).centre).toBeNull();
  });
});

describe('cloneCalibrationState', () => {
  it('copies the state: the clone and the original then evolve independently', () => {
    const d = driver();
    feedN(d, 40, { yaw: 1, pitch: 1 });
    const c = cloneCalibrationState(d.s);
    feedN(d, 80, { yaw: 1, pitch: 1 }); // original ends the centre step
    expect(d.s.step).toBe('left');
    expect(c.step).toBe('centre');
    expect(c.samples.length).toBe(40);
    const ev = stepCalibration(c, { rotation: { yaw: 1, pitch: 1 } }, 40 * DT + 1500, P);
    expect(endOf(ev, 'centre')).toBeDefined();
  });
});
