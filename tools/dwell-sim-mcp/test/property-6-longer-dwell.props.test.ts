import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Rect, ScreenSize } from "@planchette/skeleton";
import { profileArb } from "./arbitraries.js";
import { runStays, type Stay } from "./p6-stream.js";

/**
 * Feature: dwell-sim-mcp, Property 6: longer dwell, fewer reading-pause accidents.
 *
 * Open-loop streams (fixed sample times) go through the real skeleton engine in 'head + dwell'
 * mode, with no autoRepeat target. A lost-face frame comes before each stay and after it, so the
 * pointer jumps onto the pose (see `p6-stream.ts`). Everything the property requires is built in,
 * nothing is discarded:
 * - part (a): every stay is shorter than `dwellTime`;
 * - part (b): the gap from the end of a stay to the start of the next is at least d_new +
 *   `postSelectionPause`, and d_new >= d_old. All stays are non-intended: any select is an accident.
 */

const SCREEN: ScreenSize = { width: 1280, height: 720 };
/** Six non-overlapping rectangles, 3 columns x 2 rows, each well inside the screen. */
const RECTS: Rect[] = Array.from({ length: 6 }, (_, i) => ({
  x: (i % 3) * 400 + 50,
  y: Math.floor(i / 3) * 350 + 50,
  width: 300,
  height: 250,
}));

const rectIdx = fc.integer({ min: 0, max: RECTS.length - 1 });
const stepArb = fc.integer({ min: 10, max: 100 });

/** Stays from lengths and gaps: stay i starts `gap_i` after the previous end (the first at `lead`). */
function layStays(rects: number[], lengths: number[], gaps: number[], lead: number): Stay[] {
  const stays: Stay[] = [];
  let t = lead;
  for (let i = 0; i < rects.length; i++) {
    const start = t + gaps[i];
    stays.push({ rect: RECTS[rects[i]], start, end: start + lengths[i] });
    t = start + lengths[i];
  }
  return stays;
}

describe("Property 6: longer dwell, fewer reading-pause accidents", () => {
  it("(example) a stay of exactly dwellTime selects, a stay one ms shorter does not", () => {
    const profile = { dwellTime: 800, postSelectionPause: 500, graceTime: 0 };
    const long = runStays({ screen: SCREEN, profile, stays: [{ rect: RECTS[0], start: 0, end: 800 }] });
    expect(long.selects).toEqual([{ targetId: "t0", now: 800 }]);
    expect(long.stayOfSelect).toEqual([0]);
    const short = runStays({ screen: SCREEN, profile, stays: [{ rect: RECTS[0], start: 0, end: 799 }] });
    expect(short.selects).toEqual([]);
  });

  it("part (a): a stay shorter than dwellTime never produces a select", () => {
    // **Validates: Requirements 6.1**
    const caseArb = fc.record({ profile: profileArb(), smoothingStrength: fc.double({ min: 0, max: 1, noNaN: true }) }).chain(
      ({ profile, smoothingStrength }) => {
        const dwell = profile.dwellTime as number;
        return fc.record({
          profile: fc.constant({ ...profile, smoothingStrength }),
          step: stepArb,
          lead: fc.integer({ min: 0, max: 2000 }),
          stays: fc.array(
            fc.record({
              rect: rectIdx,
              // Lengths near the dwell time are the dangerous ones: bias toward the last few ms.
              length: fc.oneof(fc.integer({ min: 0, max: dwell - 1 }), fc.integer({ min: Math.max(0, dwell - 40), max: dwell - 1 })),
              gap: fc.integer({ min: 3, max: 1500 }),
            }),
            { minLength: 1, maxLength: 8 },
          ),
        });
      },
    );
    fc.assert(
      fc.property(caseArb, ({ profile, step, lead, stays }) => {
        const laid = layStays(
          stays.map((s) => s.rect),
          stays.map((s) => s.length),
          stays.map((s) => s.gap),
          lead,
        );
        const run = runStays({ screen: SCREEN, profile, stays: laid, stepMs: step });
        expect(run.effectiveProfile.dwellTime).toBe(profile.dwellTime);
        expect(run.selects).toEqual([]);
        expect(run.cancels).toEqual([]);
      }),
      { numRuns: 150 },
    );
  });

  it("part (b): raising dwellTime never adds accidents, and the accident stays under d_new are a subset", () => {
    // **Validates: Requirements 6.1**
    const caseArb = fc
      .record({
        base: profileArb(),
        dOld: fc.integer({ min: 400, max: 3000 }),
        extra: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 2600 })),
        pause: fc.integer({ min: 200, max: 3000 }),
      })
      .chain(({ base, dOld, extra, pause }) => {
        const dNew = Math.min(3000, dOld + extra);
        const near = (d: number): fc.Arbitrary<number> => fc.integer({ min: Math.max(0, d - 60), max: d + 60 });
        return fc.record({
          base: fc.constant(base),
          dOld: fc.constant(dOld),
          dNew: fc.constant(dNew),
          pause: fc.constant(pause),
          step: stepArb,
          lead: fc.integer({ min: 0, max: 2000 }),
          stays: fc.array(
            fc.record({
              rect: rectIdx,
              length: fc.oneof(fc.integer({ min: 0, max: 4000 }), near(dOld), near(dNew)),
              // Built in: every gap is at least d_new + postSelectionPause.
              slack: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 1500 })),
            }),
            { minLength: 1, maxLength: 6 },
          ),
        });
      });
    let oldSelects = 0;
    let newSelects = 0;
    let runs = 0;
    fc.assert(
      fc.property(caseArb, ({ base, dOld, dNew, pause, step, lead, stays }) => {
        runs++;
        const laid = layStays(
          stays.map((s) => s.rect),
          stays.map((s) => s.length),
          stays.map((s) => dNew + pause + s.slack),
          lead,
        );
        const profileOld = { ...base, dwellTime: dOld, postSelectionPause: pause };
        const profileNew = { ...base, dwellTime: dNew, postSelectionPause: pause };
        const oldRun = runStays({ screen: SCREEN, profile: profileOld, stays: laid, stepMs: step });
        const newRun = runStays({ screen: SCREEN, profile: profileNew, stays: laid, stepMs: step });
        for (const r of [oldRun, newRun]) {
          expect(r.cancels).toEqual([]);
          // Every select belongs to a stay, and a stay selects at most once (no autoRepeat).
          expect(r.stayOfSelect.every((i) => i !== null)).toBe(true);
          expect(r.selectedStays).toHaveLength(r.selects.length);
        }
        expect(newRun.effectiveProfile.dwellTime).toBe(dNew);
        expect(oldRun.effectiveProfile.dwellTime).toBe(dOld);
        oldSelects += oldRun.selects.length;
        newSelects += newRun.selects.length;
        expect(newRun.selects.length).toBeLessThanOrEqual(oldRun.selects.length);
        const oldSet = new Set(oldRun.selectedStays);
        for (const i of newRun.selectedStays) expect(oldSet.has(i)).toBe(true);
      }),
      { numRuns: 150 },
    );
    // The streams are not vacuous: selects happen under both dwell times, and d_new loses some.
    expect(runs).toBeGreaterThanOrEqual(150);
    expect(newSelects).toBeGreaterThan(0);
    expect(oldSelects).toBeGreaterThan(newSelects);
  });
});
