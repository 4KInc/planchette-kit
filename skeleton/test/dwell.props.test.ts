/**
 * Dwell engine properties:
 *  P1  no quick-pass selection (with the sample-gap cap)
 *  P2  one selection per stay (no auto-repeat)
 *  P8  pause respected between consecutive selects
 *  P14 moving targets keep progress
 *  P19 auto-repeat respects the larger of interval and pause
 *  plus: no dwell time counts during the pause, and every stay is cleared when it ends
 *
 * The properties compare the engine against a small independent model of "stays"
 * built from the sample list (see `modelStays`).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  MAX_SAMPLE_GAP_MS,
  createDwellState,
  stepDwell,
  type DwellEvent,
} from '../src/engine/dwell';
import type { DwellTarget } from '../src/engine/targets';
import { clampProfile, type Profile } from '../src/engine/profile';

type Label = 'A' | 'B' | 'off';

const POS: Record<Label, { x: number; y: number }> = {
  A: { x: 50, y: 50 },
  B: { x: 250, y: 50 },
  off: { x: 500, y: 500 },
};

function targets(autoRepeat: boolean): DwellTarget[] {
  return [
    { id: 'A', rect: { x: 0, y: 0, width: 100, height: 100 }, autoRepeat, role: 'default' },
    { id: 'B', rect: { x: 200, y: 0, width: 100, height: 100 }, autoRepeat, role: 'default' },
  ];
}

const profileArb: fc.Arbitrary<Profile> = fc
  .record({
    dwellTime: fc.integer({ min: 400, max: 3000 }),
    graceTime: fc.integer({ min: 0, max: 500 }),
    postSelectionPause: fc.integer({ min: 200, max: 3000 }),
    autoRepeatInterval: fc.integer({ min: 500, max: 3000 }),
    inputTimeout: fc.integer({ min: 500, max: 10000 }),
  })
  .map((r) => clampProfile(r));

/**
 * A path: runs of one label. Each run has its own sample spacing: usually a normal frame
 * gap, sometimes a stall. Spacing stays below 500 ms, the smallest input timeout, so the
 * input timeout never fires here.
 */
const pathArb = fc.record({
  runs: fc.array(
    fc.record({
      label: fc.constantFrom<Label>('A', 'B', 'off'),
      n: fc.integer({ min: 1, max: 120 }),
      dt: fc.oneof(
        { weight: 8, arbitrary: fc.integer({ min: 5, max: 100 }) },
        { weight: 2, arbitrary: fc.integer({ min: 101, max: 450 }) },
      ),
    }),
    { minLength: 1, maxLength: 8 },
  ),
});

interface Sample {
  t: number;
  label: Label;
}

function toSamples(path: { runs: Array<{ label: Label; n: number; dt: number }> }): Sample[] {
  const out: Sample[] = [];
  let t = 0;
  for (const run of path.runs) {
    for (let i = 0; i < run.n; i++) {
      out.push({ t, label: run.label });
      t += run.dt;
    }
  }
  return out;
}

interface Modelled {
  /** Stay number for an on-target sample, or -1 for an off sample. */
  stay: number;
  /** Capped on-target time of the stay up to and including this sample: the sum of the
   *  intervals between consecutive on-target samples, each capped at MAX_SAMPLE_GAP_MS.
   *  A gap off the target adds nothing. The pause is not considered here. */
  onTime: number;
  /** True when the previous sample was on the same target. */
  continuous: boolean;
}

/**
 * Independent model of stays. A stay on X continues while the previous sample was on X,
 * or while only off-target samples came since the last X sample and that gap is no longer
 * than the grace time. Any other sample on another target ends the stay.
 */
function modelStays(samples: Sample[], grace: number): Modelled[] {
  const out: Modelled[] = [];
  let stay = -1;
  let onTime = 0;
  let lastOnLabel: Label | null = null; // last non-off label seen
  let lastOnT = -Infinity;
  let prev: Sample | null = null;
  let nextStay = 0;
  for (const s of samples) {
    if (s.label === 'off') {
      out.push({ stay: -1, onTime: 0, continuous: false });
    } else {
      const continuous = prev !== null && prev.label === s.label;
      const resumed = lastOnLabel === s.label && s.t - lastOnT <= grace;
      if (continuous) {
        onTime += Math.min(s.t - (prev as Sample).t, MAX_SAMPLE_GAP_MS);
      } else if (resumed) {
        // adds nothing for the gap
      } else {
        stay = nextStay++;
        onTime = 0;
      }
      lastOnLabel = s.label;
      lastOnT = s.t;
      out.push({ stay, onTime, continuous });
    }
    prev = s;
  }
  return out;
}

interface Run {
  events: Array<{ index: number; event: DwellEvent }>;
}

function run(samples: Sample[], profile: Profile, autoRepeat: boolean): Run {
  const state = createDwellState();
  const ts = targets(autoRepeat);
  const events: Run['events'] = [];
  samples.forEach((s, index) => {
    for (const event of stepDwell(state, { pointer: POS[s.label], targets: ts }, s.t, profile)) {
      events.push({ index, event });
    }
  });
  return { events };
}

const selectsOf = (r: Run) =>
  r.events.filter((e) => e.event.type === 'select') as Array<{
    index: number;
    event: Extract<DwellEvent, { type: 'select' }>;
  }>;

describe('P1 no quick-pass selection', () => {
  it('a stay whose time on target never reaches the dwell time is never selected', () => {
    fc.assert(
      fc.property(profileArb, pathArb, fc.boolean(), (profile, path, autoRepeat) => {
        const samples = toSamples(path);
        const model = modelStays(samples, profile.graceTime);
        const sel = selectsOf(run(samples, profile, autoRepeat));
        // Every select needs its stay to have reached the dwell time in capped on-target time.
        for (const { index } of sel) {
          expect(model[index].stay).toBeGreaterThanOrEqual(0);
          expect(model[index].onTime).toBeGreaterThanOrEqual(profile.dwellTime);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('paths with brief visits (always under the dwell time) never select', () => {
    fc.assert(
      fc.property(
        profileArb,
        fc.integer({ min: 5, max: 60 }),
        fc.array(fc.record({ n: fc.integer({ min: 1, max: 6 }), gap: fc.integer({ min: 1, max: 40 }) }), {
          minLength: 1,
          maxLength: 30,
        }),
        (profile, dt, visits) => {
          // Visits of at most 6 samples (< 360 ms < 400 ms minimum dwell time) separated by
          // gaps of more than the grace time, so no stay accumulates across visits.
          const samples: Sample[] = [];
          let t = 0;
          for (const v of visits) {
            for (let i = 0; i < v.n; i++, t += dt) samples.push({ t, label: 'A' });
            const offCount = Math.ceil((profile.graceTime + 1) / dt) + v.gap;
            for (let i = 0; i < offCount; i++, t += dt) samples.push({ t, label: 'off' });
          }
          expect(selectsOf(run(samples, profile, false))).toHaveLength(0);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('P2 one selection per stay (no auto-repeat)', () => {
  it('each stay produces at most one select', () => {
    fc.assert(
      fc.property(profileArb, pathArb, (profile, path) => {
        const samples = toSamples(path);
        const model = modelStays(samples, profile.graceTime);
        const counts = new Map<number, number>();
        for (const { index } of selectsOf(run(samples, profile, false))) {
          const stay = model[index].stay;
          counts.set(stay, (counts.get(stay) ?? 0) + 1);
        }
        for (const c of counts.values()) expect(c).toBeLessThanOrEqual(1);
      }),
      { numRuns: 500 },
    );
  });
});

describe('P8 pause respected', () => {
  it('no two selects are closer than the post-selection pause', () => {
    fc.assert(
      fc.property(profileArb, pathArb, fc.boolean(), (profile, path, autoRepeat) => {
        const samples = toSamples(path);
        const times = selectsOf(run(samples, profile, autoRepeat)).map((e) => samples[e.index].t);
        for (let i = 1; i < times.length; i++) {
          expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(profile.postSelectionPause);
        }
      }),
      { numRuns: 500 },
    );
  });
});

describe('P19 auto-repeat respects the pause', () => {
  it('repeated selects in one stay are at least max(autoRepeatInterval, pause) apart', () => {
    fc.assert(
      fc.property(profileArb, pathArb, (profile, path) => {
        const samples = toSamples(path);
        const model = modelStays(samples, profile.graceTime);
        const minGap = Math.max(profile.autoRepeatInterval, profile.postSelectionPause);
        const lastByStay = new Map<number, number>();
        for (const { index } of selectsOf(run(samples, profile, true))) {
          const stay = model[index].stay;
          const t = samples[index].t;
          const prev = lastByStay.get(stay);
          if (prev !== undefined) expect(t - prev).toBeGreaterThanOrEqual(minGap);
          lastByStay.set(stay, t);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('an auto-repeat target held for a long time does repeat', () => {
    fc.assert(
      fc.property(profileArb, (profile) => {
        const minGap = Math.max(profile.autoRepeatInterval, profile.postSelectionPause);
        const total = profile.dwellTime + 3 * minGap + 50;
        const samples: Sample[] = [];
        for (let t = 0; t <= total; t += 10) samples.push({ t, label: 'A' });
        const n = selectsOf(run(samples, profile, true)).length;
        expect(n).toBeGreaterThanOrEqual(3);
      }),
      { numRuns: 100 },
    );
  });
});

describe('P14 moving targets keep progress', () => {
  it('updating the rectangle to one that still contains the pointer changes nothing', () => {
    fc.assert(
      fc.property(
        profileArb,
        fc.integer({ min: 5, max: 60 }),
        fc.integer({ min: 5, max: 200 }),
        fc.array(
          fc.record({
            left: fc.integer({ min: 0, max: 80 }),
            top: fc.integer({ min: 0, max: 80 }),
            right: fc.integer({ min: 1, max: 80 }),
            bottom: fc.integer({ min: 1, max: 80 }),
          }),
          { minLength: 1, maxLength: 200 },
        ),
        (profile, dt, count, rects) => {
          const pointer = { x: 100, y: 100 };
          const base: DwellTarget = {
            id: 'T',
            rect: { x: 50, y: 50, width: 100, height: 100 },
            autoRepeat: false,
            role: 'default',
          };
          const a = createDwellState();
          const b = createDwellState();
          const progressB: number[] = [];
          let selected = false;
          for (let i = 0; i < count; i++) {
            const t = i * dt;
            const r = rects[i % rects.length];
            // a rectangle that contains (100, 100)
            const moved: DwellTarget = {
              ...base,
              rect: {
                x: 100 - r.left,
                y: 100 - r.top,
                width: r.left + r.right,
                height: r.top + r.bottom,
              },
            };
            const evA = stepDwell(a, { pointer, targets: [base] }, t, profile);
            const evB = stepDwell(b, { pointer, targets: [moved] }, t, profile);
            expect(evB).toEqual(evA);
            // Progress only rises until the select; after it the stay is complete and shows 0.
            if (evB.some((e) => e.type === 'select')) selected = true;
            if (!selected) for (const e of evB) if (e.type === 'dwell-progress') progressB.push(e.progress);
          }
          for (let i = 1; i < progressB.length; i++) {
            expect(progressB[i]).toBeGreaterThanOrEqual(progressB[i - 1]);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('no dwell time counts during the pause', () => {
  /**
   * Reference model for targets without auto-repeat. A stay counts the capped interval
   * between consecutive on-target samples, but only the part after the pause end. It
   * selects at the first sample where it has counted the dwell time and the pause is over.
   */
  function referenceSelectIndices(samples: Sample[], profile: Profile): number[] {
    const model = modelStays(samples, profile.graceTime);
    const counted = new Map<number, number>();
    const done = new Set<number>();
    let pauseEnd = -Infinity;
    const out: number[] = [];
    for (let i = 0; i < samples.length; i++) {
      const { stay, continuous } = model[i];
      if (stay < 0) continue;
      if (continuous && !done.has(stay) && samples[i].t >= pauseEnd) {
        const from = Math.max(samples[i - 1].t, pauseEnd);
        counted.set(stay, (counted.get(stay) ?? 0) + Math.min(samples[i].t - from, MAX_SAMPLE_GAP_MS));
      }
      if (!done.has(stay) && (counted.get(stay) ?? 0) >= profile.dwellTime && samples[i].t >= pauseEnd) {
        done.add(stay);
        out.push(i);
        pauseEnd = samples[i].t + profile.postSelectionPause;
      }
    }
    return out;
  }

  it('the engine selects exactly where the reference model says', () => {
    fc.assert(
      fc.property(profileArb, pathArb, (profile, path) => {
        const samples = toSamples(path);
        const got = selectsOf(run(samples, profile, false)).map((e) => e.index);
        expect(got).toEqual(referenceSelectIndices(samples, profile));
      }),
      { numRuns: 500 },
    );
  });

  it('progress is 0 on every sample inside a pause', () => {
    fc.assert(
      fc.property(profileArb, pathArb, (profile, path) => {
        const samples = toSamples(path);
        const r = run(samples, profile, false);
        let pauseEnd = -Infinity;
        const selectIdx = new Set(selectsOf(r).map((e) => e.index));
        for (let i = 0; i < samples.length; i++) {
          const inPause = samples[i].t < pauseEnd;
          for (const e of r.events.filter((x) => x.index === i)) {
            if (inPause && e.event.type === 'dwell-progress') expect(e.event.progress).toBe(0);
          }
          if (selectIdx.has(i)) pauseEnd = samples[i].t + profile.postSelectionPause;
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('every stay is cleared when it ends', () => {
  it('emits exactly one clearing event per stay, for that stay\'s target', () => {
    fc.assert(
      fc.property(profileArb, pathArb, fc.boolean(), (profile, path, autoRepeat) => {
        const samples = toSamples(path);
        // Finish with enough off-target samples to end the last stay.
        let t = samples[samples.length - 1].t;
        for (let i = 0; i < 4; i++) {
          t += profile.graceTime + 1;
          samples.push({ t, label: 'off' });
        }
        const model = modelStays(samples, profile.graceTime);
        const stayCount = new Set(model.filter((m) => m.stay >= 0).map((m) => m.stay)).size;

        const state = createDwellState();
        const ts = targets(autoRepeat);
        let endings = 0;
        let lastLabel: Label | null = null; // target label of the most recent on-target sample
        samples.forEach((s, i) => {
          const ev = stepDwell(state, { pointer: POS[s.label], targets: ts }, s.t, profile);
          if (s.label === 'off') {
            // Only a clearing event is possible off target: at most one, for the last target.
            expect(ev.length).toBeLessThanOrEqual(1);
            for (const e of ev) {
              expect(e).toEqual({ type: 'dwell-progress', targetId: lastLabel, progress: 0 });
              endings++;
            }
          } else {
            // On target: [clear, progress] when a stay ended at this sample, else 1 or 2 events.
            const hasSelect = ev.some((e) => e.type === 'select');
            const progressCount = ev.filter((e) => e.type === 'dwell-progress').length;
            const expectedProgress = hasSelect ? 2 : 1;
            if (progressCount > expectedProgress) {
              expect(ev[0]).toEqual({ type: 'dwell-progress', targetId: lastLabel, progress: 0 });
              endings++;
            }
            lastLabel = s.label;
          }
          void i;
        });
        expect(endings).toBe(stayCount);
        expect(state.targetId).toBeNull();
      }),
      { numRuns: 500 },
    );
  });
});
