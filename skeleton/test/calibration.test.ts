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

// ---------------------------------------------------------------------------
// Stillness only ends a step once the person has done what the step asks
// ---------------------------------------------------------------------------
const POSES: Record<'left' | 'right' | 'up' | 'down', FaceRotation> = {
  left: { yaw: -10, pitch: 0 },
  right: { yaw: 12, pitch: 0 },
  up: { yaw: 0, pitch: 8 },
  down: { yaw: 0, pitch: -6 },
};
const CENTRE: FaceRotation = { yaw: 0, pitch: 0 };
const LEAD = Math.ceil(2000 / DT); // 2 s of samples

/** A driver at the start of `target`, with the centre measured at (0, 0). */
function toStep(target: 'left' | 'right' | 'up' | 'down' | 'rest' | 'gesture'): Driver {
  const d = driver();
  untilStepEnds(d, CENTRE);
  for (const st of ['left', 'right', 'up', 'down'] as const) {
    if (st === target) break;
    untilStepEnds(d, POSES[st]);
  }
  if (target === 'gesture') untilStepEnds(d, CENTRE, jaw(0.1));
  expect(d.s.step).toBe(target);
  return d;
}

describe('a person who is slow to start', () => {
  it.each(['left', 'right', 'up', 'down'] as const)(
    '%s: still at the centre for 2 s, then turning, still gets the right range',
    (dir) => {
      const d = toStep(dir);
      const first = feedN(d, LEAD, CENTRE);
      expect(endOf(first, dir)).toBeUndefined();
      expect(d.s.step).toBe(dir);
      const ev = untilStepEnds(d, POSES[dir]);
      expect(endOf(ev, dir)).toMatchObject({ completed: true, timeout: false });
    },
  );

  it('a full run with 2 s of stillness before every turn measures all four ranges', () => {
    const d = driver();
    untilStepEnds(d, CENTRE);
    for (const st of ['left', 'right', 'up', 'down'] as const) {
      feedN(d, LEAD, CENTRE);
      untilStepEnds(d, POSES[st]);
    }
    untilStepEnds(d, CENTRE, jaw(0.1));
    feedN(d, LEAD, CENTRE, jaw(0.1));
    untilStepEnds(d, CENTRE, jaw(0.8));
    const r = doneOf(d);
    expect(r.rejected).toBeNull();
    expect(r.ranges).toEqual({ left: 10, right: 12, up: 8, down: 6 });
  });

  it('a slow turn is measured where the head settles', () => {
    const d = toStep('left');
    feedN(d, LEAD, CENTRE);
    feedN(d, 94, (i) => ({ yaw: -10 * Math.min(1, i / 94), pitch: 0 })); // ramp over 1.5 s
    untilStepEnds(d, POSES.left);
    const range = -d.s.means.left!.yaw;
    expect(range).toBeGreaterThan(10 - 2); // within the stillness threshold of the target
    expect(range).toBeLessThanOrEqual(10);
  });

  it('the stillness time counts from when the head reaches the edge, not from the step start', () => {
    const d = toStep('left');
    feedN(d, LEAD, CENTRE);
    expect(endOf(feedN(d, 93, POSES.left), 'left')).toBeUndefined(); // 1488 ms at the edge
    expect(endOf(feedN(d, 2, POSES.left), 'left')).toMatchObject({ timeout: false });
  });

  it('going back toward the centre empties the window', () => {
    const d = toStep('left');
    feedN(d, 60, POSES.left); // 960 ms at the edge
    feedN(d, 10, { yaw: -1, pitch: 0 }); // back inside the minimum range
    expect(endOf(feedN(d, 93, POSES.left), 'left')).toBeUndefined();
    expect(endOf(feedN(d, 2, POSES.left), 'left')).toBeDefined();
  });

  it('a head that stays still at the centre waits for the step timeout, with timeout true', () => {
    const d = toStep('right');
    const ev = feedN(d, 380, CENTRE); // 6080 ms
    expect(endOf(ev, 'right')).toMatchObject({ completed: true, timeout: true });
    expect(d.s.step).toBe('up');
  });

  it('a turn smaller than the minimum range waits for the timeout and is then rejected', () => {
    const d = toStep('left');
    expect(endOf(feedN(d, 300, { yaw: -2.5, pitch: 0 }), 'left')).toBeUndefined(); // 4.8 s
    expect(endOf(feedN(d, 100, { yaw: -2.5, pitch: 0 }), 'left')).toMatchObject({ timeout: true });
    // on timeout every sample is measured, so the 2.5 deg is what was seen
    expect(d.s.means.left!.yaw).toBeCloseTo(-2.5, 5);
  });

  it.each([
    ['left', { yaw: -2.5, pitch: 0 }],
    ['right', { yaw: 2.5, pitch: 0 }],
    ['up', { yaw: 0, pitch: 2.5 }],
    ['down', { yaw: 0, pitch: -2.5 }],
  ] as const)('%s: a 2.5 deg turn, held still, does not end the step before the timeout', (dir, pose) => {
    const d = toStep(dir);
    expect(endOf(feedN(d, 300, pose), dir)).toBeUndefined();
    expect(endOf(feedN(d, 100, pose), dir)).toMatchObject({ timeout: true });
  });

  it('a turn in the wrong direction does not end the step', () => {
    const d = toStep('left');
    const ev = feedN(d, 200, POSES.right); // 3.2 s, still, but to the right
    expect(endOf(ev, 'left')).toBeUndefined();
    expect(d.s.step).toBe('left');
  });

  it('on timeout it measures every sample of the step, including the wait at the centre', () => {
    const d = toStep('left');
    feedN(d, 200, CENTRE);
    feedN(d, 200, { yaw: -2.5, pitch: 0 }); // still below the minimum range
    expect(d.s.step).toBe('right');
    // 200 samples at 0 and about 175 at -2.5: the mean is in between
    expect(d.s.means.left!.yaw).toBeLessThan(-0.5);
    expect(d.s.means.left!.yaw).toBeGreaterThan(-2.5);
  });

  it('waits for the timeout when the centre step saw no face', () => {
    const d = driver();
    untilStepEnds(d, null);
    expect(d.s.step).toBe('left');
    expect(endOf(feedN(d, 200, POSES.left), 'left')).toBeUndefined();
    expect(endOf(feedN(d, 200, POSES.left), 'left')).toMatchObject({ timeout: true });
  });

  it('the centre step and the rest phase are unchanged: they end on stillness alone', () => {
    const c = driver();
    expect(endOf(feedN(c, 95, { yaw: 25, pitch: -30 }), 'centre')).toMatchObject({ timeout: false });
    const d = toStep('rest');
    expect(endOf(feedN(d, 95, CENTRE, jaw(0.02)), 'rest')).toMatchObject({ timeout: false });
    expect(d.s.rest).toBeCloseTo(0.02, 5);
  });

  describe('the deliberate gesture', () => {
    it('a person who is still for 2 s before making the gesture still gets thresholds', () => {
      const d = toStep('gesture');
      expect(endOf(feedN(d, LEAD, CENTRE, jaw(0.1)), 'gesture')).toBeUndefined();
      const ev = untilStepEnds(d, CENTRE, jaw(0.8));
      expect(endOf(ev, 'gesture')).toMatchObject({ completed: true, timeout: false });
      const r = doneOf(d);
      expect(r.gesture).toMatchObject({ applied: true, kept: null });
      expect(r.gesture!.deliberate).toBeCloseTo(0.8, 5);
      expect(r.profile.gestureThreshold).toBeCloseTo(0.52, 5);
    });

    it('a slow gesture (the score rising over 1.5 s) is measured where it is held', () => {
      const d = toStep('gesture');
      feedN(d, LEAD, CENTRE, jaw(0.1));
      feedN(d, 90, CENTRE, (i) => jaw(0.1 + 0.7 * (i / 90)));
      untilStepEnds(d, CENTRE, jaw(0.8));
      const r = doneOf(d);
      expect(r.gesture!.applied).toBe(true);
      expect(r.gesture!.deliberate!).toBeGreaterThan(0.6);
    });

    it('the stillness time counts from when the score reaches rest + 0.15', () => {
      const d = toStep('gesture');
      feedN(d, LEAD, CENTRE, jaw(0.1));
      expect(endOf(feedN(d, 93, CENTRE, jaw(0.8)), 'gesture')).toBeUndefined();
      expect(endOf(feedN(d, 2, CENTRE, jaw(0.8)), 'gesture')).toMatchObject({ timeout: false });
    });

    it('a score that drops back to rest empties the window', () => {
      const d = toStep('gesture');
      feedN(d, 60, CENTRE, jaw(0.8));
      feedN(d, 5, CENTRE, jaw(0.1));
      expect(endOf(feedN(d, 93, CENTRE, jaw(0.8)), 'gesture')).toBeUndefined();
      expect(endOf(feedN(d, 2, CENTRE, jaw(0.8)), 'gesture')).toBeDefined();
    });

    it('a score less than 0.15 above rest waits for the timeout and keeps the old thresholds', () => {
      const d = toStep('gesture');
      expect(endOf(feedN(d, 300, CENTRE, jaw(0.2)), 'gesture')).toBeUndefined();
      expect(endOf(feedN(d, 100, CENTRE, jaw(0.2)), 'gesture')).toMatchObject({ timeout: true });
      const r = doneOf(d);
      expect(r.gesture).toMatchObject({ applied: false, kept: 'range-too-small' });
      expect(r.profile.gestureThreshold).toBeUndefined();
    });

    it('a person who never makes the gesture waits for the timeout', () => {
      const d = toStep('gesture');
      const ev = feedN(d, 380, CENTRE, jaw(0.1));
      expect(endOf(ev, 'gesture')).toMatchObject({ timeout: true });
      expect(doneOf(d).gesture!.applied).toBe(false);
    });

    it('on timeout it measures every sample, so a gesture made late still counts', () => {
      const d = toStep('gesture');
      // moving head keeps the window from ever completing; the gesture is made after 3 s
      const wobble = (i: number) => ({ yaw: i % 2 ? 4 : -4, pitch: 0 });
      feedN(d, 400, wobble, (i) => jaw(i < 190 ? 0.1 : 0.8));
      expect(doneOf(d).gesture!.deliberate).toBeCloseTo(0.8, 5);
    });

    it('with no rest score (no face in the rest phase) it waits for the timeout', () => {
      const d = driver();
      for (const st of ['centre', 'left', 'right', 'up', 'down'] as const) {
        untilStepEnds(d, st === 'centre' ? CENTRE : POSES[st]);
      }
      untilStepEnds(d, null);
      expect(endOf(feedN(d, 200, CENTRE, jaw(0.8)), 'gesture')).toBeUndefined();
      expect(endOf(feedN(d, 200, CENTRE, jaw(0.8)), 'gesture')).toMatchObject({ timeout: true });
    });
  });
});
