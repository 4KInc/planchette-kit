/**
 * Dwell engine properties:
 *  P1  no quick-pass selection
 *  P2  one selection per stay (no auto-repeat)
 *  P8  pause respected between consecutive selects
 *  P14 moving targets keep progress
 *  P19 auto-repeat respects the larger of interval and pause
 *
 * The properties compare the engine against a small independent model of "stays"
 * built from the sample list (see `modelStays`).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  createDwellState,
  stepDwell,
  type DwellEvent,
  type DwellTarget,
} from '../src/engine/dwell';
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

/** A path: runs of one label, sampled every `dt` ms. dt stays below the minimum input timeout. */
const pathArb = fc.record({
  dt: fc.integer({ min: 5, max: 60 }),
  runs: fc.array(
    fc.record({
      label: fc.constantFrom<Label>('A', 'B', 'off'),
      n: fc.integer({ min: 1, max: 120 }),
    }),
    { minLength: 1, maxLength: 8 },
  ),
});

interface Sample {
  t: number;
  label: Label;
}

function toSamples(path: { dt: number; runs: Array<{ label: Label; n: number }> }): Sample[] {
  const out: Sample[] = [];
  let t = 0;
  for (const run of path.runs) {
    for (let i = 0; i < run.n; i++) {
      out.push({ t, label: run.label });
      t += path.dt;
    }
  }
  return out;
}

interface Modelled {
  /** Stay number for an on-target sample, or -1 for an off sample. */
  stay: number;
  /** Time accumulated in the stay up to and including this sample: the sum of the
   *  intervals between consecutive on-target samples. A gap off the target adds nothing. */
  onTime: number;
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
      out.push({ stay: -1, onTime: 0 });
    } else {
      const continuous = prev !== null && prev.label === s.label;
      const resumed = lastOnLabel === s.label && s.t - lastOnT <= grace;
      if (continuous) {
        onTime += s.t - (prev as Sample).t;
      } else if (resumed) {
        // adds nothing for the gap
      } else {
        stay = nextStay++;
        onTime = 0;
      }
      lastOnLabel = s.label;
      lastOnT = s.t;
      out.push({ stay, onTime });
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
        // Every select needs its stay to have accumulated the dwell time by then.
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
            for (const e of evB) if (e.type === 'dwell-progress') progressB.push(e.progress);
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
