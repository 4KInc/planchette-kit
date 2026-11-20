/**
 * Scan engine properties:
 *  P6  scan coverage
 *  P9  resume does not select
 *  P8  pause respected (scan path)
 * plus: a robustness property for layouts that change while scanning.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  SCAN_CANCEL_ID,
  SCAN_BACK_ID,
  createScanState,
  stepScan,
  type ScanEvent,
} from '../src/engine/scan';
import type { DwellTarget } from '../src/engine/targets';
import { clampProfile, type Profile } from '../src/engine/profile';

const profileArb: fc.Arbitrary<Profile> = fc
  .record({
    scanInterval: fc.integer({ min: 500, max: 5000 }),
    scanLoopsBeforePause: fc.integer({ min: 1, max: 10 }),
    postSelectionPause: fc.integer({ min: 200, max: 3000 }),
    inputTimeout: fc.integer({ min: 500, max: 10000 }),
  })
  .map((r) => clampProfile(r));

function target(id: string, x: number, y: number, role: DwellTarget['role'] = 'default'): DwellTarget {
  return { id, rect: { x, y, width: 100, height: 100 }, autoRepeat: false, role };
}

/** A vertical list of 1 to 20 items, registered in a random order. Reading order is by y. */
const columnArb = fc
  .integer({ min: 1, max: 20 })
  .chain((n) =>
    fc.shuffledSubarray(
      Array.from({ length: n }, (_, i) => i),
      { minLength: n, maxLength: n },
    ),
  )
  .map((perm) => ({
    targets: perm.map((i) => target(`t${i}`, 0, i * 120)),
    // ids in reading order
    expected: perm.map((_, k) => `t${k}`),
  }));

/** A grid of 2 to 5 rows and 2 to 5 columns, registered in a random order. Scanned row first. */
const gridArb = fc
  .record({ rows: fc.integer({ min: 2, max: 5 }), cols: fc.integer({ min: 2, max: 5 }) })
  .chain(({ rows, cols }) =>
    fc
      .shuffledSubarray(
        Array.from({ length: rows * cols }, (_, i) => i),
        { minLength: rows * cols, maxLength: rows * cols },
      )
      .map((perm) => ({
        rows,
        cols,
        targets: perm.map((i) => target(`g${i}`, (i % cols) * 120, Math.floor(i / cols) * 120)),
      })),
  );

const kindOrId = (e: ScanEvent): string =>
  e.type !== 'highlight'
    ? e.type
    : e.kind === 'item'
      ? e.targetId
      : e.kind === 'row'
        ? `row:${e.targetIds.join('+')}`
        : e.kind;

describe('P6 scan coverage', () => {
  function scanWithoutPresses(
    targets: DwellTarget[],
    profile: Profile,
    dt: number,
    cycles: number,
    slots: number,
  ) {
    const s = createScanState();
    const out: Array<{ at: number; e: ScanEvent }> = [];
    const end = profile.scanInterval * (slots * cycles + 1);
    for (let t = 0; t <= end; t += dt) {
      for (const e of stepScan(s, { press: false, targets }, t, profile)) out.push({ at: t, e });
    }
    return out;
  }

  it('a list: every item once per loop, in reading order, then cancel, for each loop, then a pause', () => {
    fc.assert(
      fc.property(profileArb, columnArb, fc.integer({ min: 10, max: 200 }), (profile, col, dt) => {
        const slots = col.targets.length + 1;
        const out = scanWithoutPresses(col.targets, profile, dt, profile.scanLoopsBeforePause, slots);
        const expected: string[] = [];
        for (let l = 0; l < profile.scanLoopsBeforePause; l++) expected.push(...col.expected, 'cancel');
        expected.push('none');
        expect(out.map((o) => kindOrId(o.e))).toEqual(expected);
        // one slot per interval, no drift, at most one frame late
        out.forEach((o, i) => {
          expect(o.at).toBeGreaterThanOrEqual(i * profile.scanInterval);
          expect(o.at).toBeLessThan(i * profile.scanInterval + dt);
        });
      }),
      { numRuns: 200 },
    );
  });

  it('a grid: every row once per loop in order, then cancel, for each loop, then a pause', () => {
    fc.assert(
      fc.property(profileArb, gridArb, fc.integer({ min: 10, max: 200 }), (profile, grid, dt) => {
        const slots = grid.rows + 1;
        const out = scanWithoutPresses(grid.targets, profile, dt, profile.scanLoopsBeforePause, slots);
        const rowLabels: string[] = [];
        for (let r = 0; r < grid.rows; r++) {
          rowLabels.push(
            `row:${Array.from({ length: grid.cols }, (_, c) => `g${r * grid.cols + c}`).join('+')}`,
          );
        }
        const expected: string[] = [];
        for (let l = 0; l < profile.scanLoopsBeforePause; l++) expected.push(...rowLabels, 'cancel');
        expected.push('none');
        expect(out.map((o) => kindOrId(o.e))).toEqual(expected);
      }),
      { numRuns: 100 },
    );
  });

  it('a custom order is followed exactly, then unlisted targets in reading order', () => {
    fc.assert(
      fc.property(
        profileArb,
        columnArb,
        fc.array(fc.nat(), { maxLength: 25 }),
        (profile, col, picks) => {
          const n = col.targets.length;
          const order = picks.map((p) => `t${p % (n + 3)}`); // some ids do not exist
          const listed: string[] = [];
          for (const id of order) {
            if (Number(id.slice(1)) < n && !listed.includes(id)) listed.push(id);
          }
          const rest = col.expected.filter((id) => !listed.includes(id));
          const s = createScanState();
          const out: string[] = [];
          for (let t = 0; t <= profile.scanInterval * (n + 1); t += 100) {
            for (const e of stepScan(s, { press: false, targets: col.targets, order }, t, profile)) {
              out.push(kindOrId(e));
            }
          }
          expect(out.slice(0, n + 1)).toEqual([...listed, ...rest, 'cancel']);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('P9 resume does not select', () => {
  it('the first press after a scan pause highlights the start and selects nothing', () => {
    fc.assert(
      fc.property(
        profileArb,
        fc.oneof(
          columnArb.map((c) => c.targets),
          gridArb.map((g) => g.targets),
        ),
        fc.integer({ min: 10, max: 200 }),
        fc.integer({ min: 0, max: 40 }),
        (profile, targets, dt, extraSteps) => {
          const s = createScanState();
          let t = 0;
          // Scan with no presses until the engine pauses.
          while (!s.paused) {
            stepScan(s, { press: false, targets }, t, profile);
            t += dt;
          }
          // Stay paused for a while, silent.
          for (let k = 0; k < extraSteps; k++, t += dt) {
            expect(stepScan(s, { press: false, targets }, t, profile)).toEqual([]);
          }
          const ev = stepScan(s, { press: true, targets }, t, profile);
          expect(ev.length).toBe(1);
          expect(ev[0].type).toBe('highlight');
          expect(ev.some((e) => e.type === 'select' || e.type === 'cancel')).toBe(false);
          expect(s.paused).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('P8 pause respected (scan path)', () => {
  it('no two selects are closer than the post-selection pause, and ignored presses do nothing', () => {
    fc.assert(
      fc.property(
        profileArb,
        fc.oneof(
          columnArb.map((c) => c.targets),
          gridArb.map((g) => g.targets),
        ),
        fc.integer({ min: 10, max: 300 }),
        fc.array(fc.boolean(), { minLength: 20, maxLength: 400 }),
        (profile, targets, dt, presses) => {
          const s = createScanState();
          const selectTimes: number[] = [];
          presses.forEach((press, i) => {
            const t = i * dt;
            const pauseEndBefore = s.pauseEnd;
            const ev = stepScan(s, { press, targets }, t, profile);
            if (press && t < pauseEndBefore) {
              // A press inside the pause is ignored: no select, no cancel, no state change.
              expect(ev.some((e) => e.type === 'select' || e.type === 'cancel')).toBe(false);
              expect(s.pauseEnd).toBe(pauseEndBefore);
            }
            for (const e of ev) if (e.type === 'select') selectTimes.push(t);
          });
          for (let i = 1; i < selectTimes.length; i++) {
            expect(selectTimes[i] - selectTimes[i - 1]).toBeGreaterThanOrEqual(profile.postSelectionPause);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('layouts that change while scanning', () => {
  it('highlights and selects only refer to targets that exist (or the virtual items)', () => {
    fc.assert(
      fc.property(
        profileArb,
        fc.array(
          fc.record({
            press: fc.boolean(),
            dt: fc.integer({ min: 10, max: 400 }),
            // which of 8 grid cells exist at this step
            present: fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
          }),
          { minLength: 1, maxLength: 150 },
        ),
        (profile, steps) => {
          const s = createScanState();
          let t = 0;
          for (const step of steps) {
            t += step.dt;
            const targets: DwellTarget[] = [];
            step.present.forEach((p, i) => {
              if (p) targets.push(target(`c${i}`, (i % 4) * 120, Math.floor(i / 4) * 120));
            });
            const ids = new Set(targets.map((x) => x.id));
            for (const e of stepScan(s, { press: step.press, targets }, t, profile)) {
              if (e.type === 'highlight') {
                for (const id of e.targetIds) expect(ids.has(id)).toBe(true);
                if (e.kind === 'item') expect(ids.has(e.targetId)).toBe(true);
                if (e.kind === 'cancel') expect(e.targetId).toBe(SCAN_CANCEL_ID);
                if (e.kind === 'back') expect(e.targetId).toBe(SCAN_BACK_ID);
              } else if (e.type === 'select') {
                expect(ids.has(e.targetId)).toBe(true);
              }
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
