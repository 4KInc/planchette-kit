/**
 * P15 — frame-rate independence, through createPlanchette + feedSamples (Req 9 AC 5).
 *
 * The same pointer path, generated once per fast-check case, is sampled at 15 fps and at
 * 60 fps and fed to two fresh instances in head + dwell mode. The two runs must produce
 * the same `select` events (same targets, same order), each within 67 ms (one 15 fps
 * frame) of its counterpart.
 *
 * BOUNDARY CONDITIONS (the generator only makes paths that meet all of them):
 *  B1  Every stay on a target is either short, lasting less than dwellTime − 67 ms, or
 *      long, lasting more than dwellTime + postSelectionPause + 134 ms. No stay is within
 *      67 ms of the dwell time (excluded edge case, see frame-rate.test.ts).
 *  B2  While the pointer rests, it is more than 20 px from every target edge: inside a
 *      target at least 20 px from its edges, or in blank space at least 20 px from every
 *      target. (Excluded edge case, see frame-rate.test.ts.)
 *  B3  The pointer path is the same at both frame rates. The engine smooths head angles,
 *      and the smoother's lag is not the same at 15 and 60 fps (design §2, "Known limit:
 *      below 30 fps"), so a moving head gives two different pointer paths. Each move
 *      therefore goes through one 15 fps frame (66.7 ms) with no face detected: a face
 *      loss resets the filter (design §2, §4), so the pointer jumps straight to the new
 *      position in both runs. Moves start on 15 fps frame times, which are also 60 fps
 *      frame times.
 *  B4  A stay never begins inside the post-selection pause of a select (B1 makes the
 *      selecting stay outlast its pause). A stay that begins during the pause can differ
 *      by up to two 15 fps frames (see frame-rate.test.ts).
 *  B5  No auto-repeat targets (repeats are timed from the previous select, so the one-frame
 *      difference can add up).
 *  The start-up centre step (design §4) is measured at the screen centre, which is blank.
 *
 * A second property drops B3: the head moves continuously, so the smoother's lag
 * difference is included. It checks the same targets are selected in the same order, and
 * that the time from the pointer reaching a target to its select differs by at most 67 ms
 * between the two frame rates; the arrival difference itself is the smoother's (§2).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createPlanchette } from '../src/index';
import { CENTRE, SCREEN, cameraSamples, rotationFor, type PointerPath } from './pointer-path';
import type { TimestampedSample } from '../src/api-types';

const FRAME_15 = 1000 / 15;
const TOLERANCE = 67;
const PAUSE = 500; // default postSelectionPause
const START = 2000; // the start-up centre step is over by then at both frame rates

/** A 3 x 3 grid of cells; the centre cell is blank. Each target is its cell inset by `inset` px. */
interface Layout {
  insets: number[]; // 8 values, one per outer cell
}
const CW = SCREEN.width / 3;
const CH = SCREEN.height / 3;
const OUTER = [0, 1, 2, 3, 5, 6, 7, 8];

function targetRect(cell: number, inset: number) {
  return { x: CW * (cell % 3) + inset, y: CH * Math.floor(cell / 3) + inset, width: CW - 2 * inset, height: CH - 2 * inset };
}

/** A resting place: on target `cell` at relative position (rx, ry) within its 20 px safe area, or blank (cell 4). */
interface Rest {
  cell: number; // 4 = the blank centre cell
  rx: number;
  ry: number;
  long: boolean;
  r: number; // 0–1, picks the duration inside the allowed band
}

const restArb = fc.record({
  cell: fc.constantFrom(...OUTER, 4),
  rx: fc.double({ min: 0, max: 1, noNaN: true }),
  ry: fc.double({ min: 0, max: 1, noNaN: true }),
  long: fc.boolean(),
  r: fc.double({ min: 0, max: 1, noNaN: true }),
});

const caseArb = fc.record({
  dwellTime: fc.integer({ min: 400, max: 3000 }),
  insets: fc.array(fc.integer({ min: 0, max: 60 }), { minLength: 8, maxLength: 8 }),
  rests: fc.array(restArb, { minLength: 1, maxLength: 8 }),
});
type Case = typeof caseArb extends fc.Arbitrary<infer T> ? T : never;

/** A point at least 20 px (B2) inside the rect, or the blank centre cell's middle. */
function restPoint(rest: Rest, layout: Layout): { x: number; y: number } {
  if (rest.cell === 4) return { x: CW * 1.5, y: CH * 1.5 }; // ≥ 20 px from every target: each target is inside its own cell
  const r = targetRect(rest.cell, layout.insets[OUTER.indexOf(rest.cell)]);
  return {
    x: r.x + 20 + 1 + rest.rx * (r.width - 42),
    y: r.y + 20 + 1 + rest.ry * (r.height - 42),
  };
}

/** Number of 15 fps frames a rest lasts (B1), so every move starts on a 15 fps frame (B3). */
function restFrames(rest: Rest, dwell: number): number {
  if (rest.cell === 4) return 3 + Math.floor(rest.r * 30); // blank: any length
  if (rest.long) {
    const min = Math.ceil((dwell + PAUSE + 134 + 1) / FRAME_15);
    return min + Math.floor(rest.r * 20);
  }
  const max = Math.floor((dwell - TOLERANCE - 1) / FRAME_15);
  return Math.max(1, Math.floor(rest.r * max));
}

/** The pointer path of a case: centre, then for each rest a one-frame face loss and the rest (B3). */
function buildPath(c: Case): { path: PointerPath; end: number } {
  const layout: Layout = { insets: c.insets };
  const pieces: Array<{ from: number; to: number; at: { x: number; y: number } | null }> = [
    { from: 0, to: START, at: CENTRE },
  ];
  let frame = Math.round(START / FRAME_15);
  for (const rest of c.rests) {
    pieces.push({ from: (frame * 1000) / 15, to: ((frame + 1) * 1000) / 15, at: null });
    frame += 1;
    const n = restFrames(rest, c.dwellTime);
    pieces.push({ from: (frame * 1000) / 15, to: ((frame + n) * 1000) / 15, at: restPoint(rest, layout) });
    frame += n;
  }
  const end = (frame * 1000) / 15;
  pieces.push({ from: end, to: Infinity, at: null });
  const path: PointerPath = (t) => {
    for (const p of pieces) if (t >= p.from && t < p.to) return p.at;
    return null;
  };
  return { path, end: end + 200 };
}

function runAt(c: Case, samples: TimestampedSample[]) {
  const p = createPlanchette({ screen: SCREEN, profile: { mode: 'head + dwell', dwellTime: c.dwellTime } });
  OUTER.forEach((cell, i) => p.registerTarget(`t${cell}`, targetRect(cell, c.insets[i])));
  const selects: Array<{ id: string; now: number }> = [];
  const moves: Array<{ now: number; x: number; y: number }> = [];
  let now = 0;
  p.addEventListener('select', (e) => selects.push({ id: e.detail.targetId, now: e.detail.now }));
  p.addEventListener('pointer-move', (e) => moves.push({ now, x: e.detail.x, y: e.detail.y }));
  for (const s of samples) {
    now = s.now;
    p.feedSamples([s]);
  }
  return { selects, moves };
}

describe('P15: frame-rate independence (15 fps and 60 fps)', () => {
  it('the same pointer path gives the same selects, each within 67 ms', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { path, end } = buildPath(c);
        const a = runAt(c, cameraSamples(path, 15, end)).selects;
        const b = runAt(c, cameraSamples(path, 60, end)).selects;
        expect(a.map((s) => s.id)).toEqual(b.map((s) => s.id));
        for (let i = 0; i < a.length; i++) expect(Math.abs(a[i].now - b[i].now)).toBeLessThanOrEqual(TOLERANCE);
        // Every long stay on a target selects once (so the property is not passing vacuously).
        const longStays = c.rests.filter((r) => r.cell !== 4 && r.long).length;
        expect(b.length).toBe(longStays);
      }),
      { numRuns: 300 },
    );
  });
});

describe('P15 with a moving head (B3 dropped: the smoother is in the path)', () => {
  const contArb = fc.record({
    dwellTime: fc.integer({ min: 700, max: 3000 }),
    insets: fc.array(fc.integer({ min: 30, max: 60 }), { minLength: 8, maxLength: 8 }),
    rests: fc.array(
      fc.record({ cell: fc.constantFrom(...OUTER), long: fc.boolean(), r: fc.double({ min: 0, max: 1, noNaN: true }) }),
      { minLength: 1, maxLength: 6 },
    ),
  });

  it('the same targets are selected in order; select time after arrival differs by at most 67 ms', () => {
    fc.assert(
      fc.property(contArb, (c) => {
        // The head jumps from cell centre to cell centre, on 15 fps frame times. The pointer
        // follows through the smoother. Short stays leave 300 ms margin for the smoother lag
        // difference and long ones 400 ms, on top of B1.
        const pieces: Array<{ from: number; at: { x: number; y: number } }> = [{ from: 0, at: CENTRE }];
        let t = START;
        let prev = 4;
        for (const r of c.rests) {
          const cell = r.cell === prev ? OUTER[(OUTER.indexOf(r.cell) + 1) % 8] : r.cell;
          prev = cell;
          const ms = r.long ? c.dwellTime + PAUSE + 400 + r.r * 1000 : 150 + r.r * (c.dwellTime - 450);
          pieces.push({ from: t, at: { x: CW * (cell % 3) + CW / 2, y: CH * Math.floor(cell / 3) + CH / 2 } });
          t += Math.ceil(ms / FRAME_15) * FRAME_15;
        }
        const end = t;
        const path: PointerPath = (now) => {
          let at = pieces[0].at;
          for (const p of pieces) if (now >= p.from) at = p.at;
          return now < end ? at : null;
        };
        const a = runAt({ dwellTime: c.dwellTime, insets: c.insets, rests: [] }, cameraSamples(path, 15, end + 200));
        const b = runAt({ dwellTime: c.dwellTime, insets: c.insets, rests: [] }, cameraSamples(path, 60, end + 200));
        expect(a.selects.map((s) => s.id)).toEqual(b.selects.map((s) => s.id));
        const arrival = (run: typeof a, sel: { id: string; now: number }): number => {
          const cell = Number(sel.id.slice(1));
          const rect = targetRect(cell, c.insets[OUTER.indexOf(cell)]);
          let entered = NaN;
          let inside = false;
          for (const m of run.moves) {
            if (m.now > sel.now) break;
            const now = m.x >= rect.x && m.x < rect.x + rect.width && m.y >= rect.y && m.y < rect.y + rect.height;
            if (now && !inside) entered = m.now;
            inside = now;
          }
          return entered;
        };
        for (let i = 0; i < a.selects.length; i++) {
          const da = a.selects[i].now - arrival(a, a.selects[i]);
          const db = b.selects[i].now - arrival(b, b.selects[i]);
          expect(Math.abs(da - db)).toBeLessThanOrEqual(TOLERANCE);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('rotationFor is the inverse of the default mapping (helper check)', () => {
    const p = createPlanchette({ screen: SCREEN });
    const seen: Array<{ x: number; y: number }> = [];
    p.addEventListener('pointer-move', (e) => seen.push(e.detail));
    const r = rotationFor(123, 654);
    p.feedSamples([{ now: 1, source: 'camera', faces: [{ bbox: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.3 }, rotation: r }] }]);
    expect(seen.at(-1)).toEqual({ x: 123, y: 654 });
  });
});
