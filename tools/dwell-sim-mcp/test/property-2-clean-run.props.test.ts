import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { angularWidth } from "../src/geometry.js";
import { resolveUser } from "../src/resolve-user.js";
import { openTrial, runEntries, runStartOfSession, runWarmup } from "../src/run-trial.js";
import type { TrialConfig } from "../src/run-trial.js";
import type { Layout, RawEvent, ResolvedUser } from "../src/types.js";
import { buildCase, longestNonIntendedStay, moveEndMs, nonIntendedStays, trackStays, type Stay } from "./property-2-helpers.js";
import { customUserArb, layoutArb, taskArb } from "./arbitraries.js";

/**
 * Feature: dwell-sim-mcp, Property 2: clean run, no accidents, no misses.
 *
 * Everything the property requires is built in, nothing is filtered:
 * - tremor 0, tracking noise 0, reading-pause chance 0 are pinned; the layout has no autoRepeat target;
 * - the scatter cap is drawn first. The head gain, the dead zone and a lower bound of the head range
 *   are then chosen so that a target of 6 x cap degrees plus the 2 px margin fits into a grid cell;
 *   every target is made at least that wide and high in px (`minWidth`, `minHeight`), so SD = cap;
 * - the screen centre is outside every target (`centreClear`);
 * - the calibration ranges equal the head range and the gain is at least 1, so the whole screen is reachable;
 * - `dwellTime` is max(longest planned crossing of a non-intended target (start plan and entry plans), largest
 *   (move end of entry k - planned time the path enters target k)) + margin, with margin = L + F(fps) = 150 ms + 1000 / fps
 *   (design, Property 2, derivation). The second term makes every entry resolve during its planned holding phase, so
 *   the next entry starts at `aim` as the plans assume; the run asserts that premise. `smoothingStrength` is the default 0.5
 *   and is never varied. Cases where crossing + margin > 3000 ms (the dwell clamp) are discarded with `fc.pre`; the discard
 *   rate is printed. The smallest dwellTime - (longest actual pointer stay on a non-intended target) is printed and must be > 0;
 *   a stay is (last frame inside the rect) - (first frame inside the rect), the pointer held between `pointer-move` events.
 * - the analysis window is reaction + movement (slowest throughput) + dwell + post-selection pause + 1000 ms, at most 120 s.
 */

/** Most columns the generated grids have (see the screen and target limits below). */
const MARGIN_PX = 2;

interface Case {
  cfg: TrialConfig;
  cap: number;
  /** crossing + margin exceeds the dwell clamp: the case cannot be built, the property discards it. */
  overClamp: boolean;
  crossing: number;
  holdNeed: number;
  margin: number;
}

type Rect = Layout["targets"][number]["rect"];

/**
 * Layout built for the property, not filtered: three selectable targets in one row at the top of the screen
 * (columns left, middle, right; all with the same y and height, so any straight path between the left and the right
 * target crosses the middle one) and the rest area at the bottom. The ids t0..t2 are assigned to the columns by `perm`.
 * Every rect is at least minWidth x minHeight (6 x SDcap), the row ends above the screen centre, so no
 * selectable target and not the rest area contains it; the targets do not overlap.
 */
function rowLayoutArb(
  screen: { width: number; height: number },
  minWidth: number,
  minHeight: number,
): fc.Arbitrary<Layout> {
  const unit = fc.integer({ min: 0, max: 1000 });
  return fc
    .record({
      perm: fc.shuffledSubarray([0, 1, 2], { minLength: 3, maxLength: 3 }),
      hU: unit,
      wU: fc.tuple(unit, unit, unit),
      xU: fc.tuple(unit, unit, unit),
      restU: fc.tuple(unit, unit, unit),
    })
    .map(({ perm, hU, wU, xU, restU }): Layout => {
      const m = 4;
      const cw = screen.width / 3;
      const maxH = Math.max(minHeight, Math.floor(screen.height * 0.4));
      const height = minHeight + Math.floor((hU / 1000) * (maxH - minHeight));
      const column = (c: number, w01: number, x01: number): Rect => {
        const x0 = Math.round(c * cw) + m;
        const x1 = Math.round((c + 1) * cw) - m;
        const width = Math.min(x1 - x0, minWidth + Math.floor((w01 / 1000) * (x1 - x0 - minWidth)));
        return { x: x0 + Math.floor((x01 / 1000) * (x1 - x0 - width)), y: m, width, height };
      };
      const targets: Layout["targets"] = [0, 1, 2].map((i) => ({
        id: `t${perm[i]}`,
        rect: column(i, wU[i], xU[i]),
        autoRepeat: false,
        role: "default" as const,
      }));
      targets.sort((p, q) => p.id.localeCompare(q.id));
      const rw = Math.min(screen.width - 2 * m, minWidth + Math.floor((restU[0] / 1000) * minWidth));
      const rh = minHeight;
      targets.push({
        id: "rest",
        rect: {
          x: m + Math.floor((restU[1] / 1000) * (screen.width - 2 * m - rw)),
          y: screen.height - m - rh,
          width: rw,
          height: rh,
        },
        autoRepeat: false,
        role: "rest-area",
      });
      return { screen, targets };
    });
}

/**
 * A task of 2..6 entries whose first two entries are the left and the right target of the row (in either order),
 * so the pointer crosses the middle target on its way to the second entry. Later entries are any target
 * different from the previous one.
 */
function crossingTaskArb(layout: Layout): fc.Arbitrary<readonly string[]> {
  const sel = layout.targets.filter((t) => t.role !== "rest-area").sort((p, q) => p.rect.x - q.rect.x);
  const left = sel[0].id;
  const right = sel[2].id;
  const ids = sel.map((t) => t.id);
  return fc
    .tuple(fc.boolean(), fc.array(fc.nat(), { minLength: 0, maxLength: 4 }))
    .map(([flip, rest]) => {
      const out = flip ? [right, left] : [left, right];
      for (const raw of rest) {
        const options = ids.filter((id) => id !== out[out.length - 1]);
        out.push(options[raw % options.length]);
      }
      return out;
    });
}

type LayoutFor = (screen: { width: number; height: number }, minWidth: number, minHeight: number) => fc.Arbitrary<Layout>;
type TaskFor = (layout: Layout) => fc.Arbitrary<readonly string[]>;

/**
 * General layouts: `layoutArb` with three selectable targets, no cancel target, no autoRepeat, the screen centre clear,
 * 6 x SDcap sizing through `minWidth`/`minHeight`. In half of the runs `selectableBetweenCentreAndRest` puts a selectable
 * target between the screen centre and the rest area, so start-of-session crossings happen.
 */
const generalLayoutFor: LayoutFor = (screen, minWidth, minHeight) =>
  fc.boolean().chain((between) =>
    layoutArb({
      screen,
      minTargets: 3,
      maxTargets: 3,
      cancelTarget: false,
      includeAutoRepeat: false,
      centreClear: true,
      selectableBetweenCentreAndRest: between,
      minWidth,
      minHeight,
    }),
  );
const generalTaskFor: TaskFor = (layout) =>
  taskArb(layout, { form: "list", maxLength: 6 }).map((spec) => spec as readonly string[]);

const rowLayoutFor: LayoutFor = rowLayoutArb;
const rowTaskFor: TaskFor = crossingTaskArb;

const makeCaseArb = (layoutFor: LayoutFor, taskFor: TaskFor): fc.Arbitrary<Case> => fc
  .record({
    cap: fc.double({ min: 0.1, max: 3, noNaN: true }),
    width: fc.integer({ min: 640, max: 1600 }),
    heightU: fc.double({ min: 0, max: 1, noNaN: true }),
    gainU: fc.double({ min: 0, max: 1, noNaN: true }),
    deadU: fc.double({ min: 0, max: 1, noNaN: true }),
    graceTime: fc.integer({ min: 0, max: 500 }),
    postSelectionPause: fc.integer({ min: 200, max: 3000 }),
  })
  .chain(({ cap, width, heightU, gainU, deadU, graceTime, postSelectionPause }) => {
    // Screen at most 1.8 : 1, so the grid has at most 4 columns (with 1..3 targets and no cancel target).
    const hMin = Math.max(480, Math.ceil(width / 1.8));
    const height = hMin + Math.floor(heightU * (1080 - hMin));
    const screen = { width, height };
    const headGain = 1 + gainU * (Math.min(2, 3.7 / cap) - 1);
    const headDeadZone = deadU * 1.5;
    // A target of 6 cap degrees takes 6 cap G / (2 (R - D)) of the screen; R - D >= 15 cap G keeps that at 0.2 of it.
    const rMin = Math.min(60, Math.max(3, Math.ceil(headDeadZone + 15 * cap * headGain) + 1));
    const range = fc.double({ min: rMin, max: 60, noNaN: true });
    const pxFor = (n: number, deg: number): number =>
      Math.ceil((deg * headGain * (n - 1)) / (2 * (rMin - headDeadZone))) + MARGIN_PX;
    return fc
      .record({
        user: fc
          .tuple(range, range, range, range)
          .chain(([left, right, up, down]) =>
            customUserArb({
              fixed: {
                tremorPeakToPeakDeg: 0,
                trackingNoiseDeg: 0,
                readingPauseChancePct: 0,
                scatterCapDeg: cap,
                headRangeDeg: { left, right, up, down },
              },
            }),
          )
          .map((input): ResolvedUser => {
            const r = resolveUser(input);
            if (!r.ok) throw new Error(`arbitrary produced an invalid user: ${r.error.message}`);
            return r.user;
          }),
        layout: layoutFor(screen, pxFor(width, 6 * cap), pxFor(height, 6 * cap)),
        fps: fc.constantFrom<15 | 30 | 60>(15, 30, 60),
        requestSeed: fc.integer({ min: 0, max: 0xffffffff }),
        trialIndex: fc.integer({ min: 0, max: 20 }),
      })
      .chain(({ user, layout, fps, requestSeed, trialIndex }) =>
        taskFor(layout).map((task): Case => {
          const built = buildCase({
            layout,
            profile: { headGain, headDeadZone, graceTime, postSelectionPause },
            user,
            mode: "head + dwell",
            task,
            fps,
            requestSeed,
            trialIndex,
          });
          return { cfg: built.cfg, cap, overClamp: built.overClamp, crossing: built.crossing, holdNeed: built.holdNeed, margin: built.margin };
        }),
      );
  });

function checkProperty2(arb: fc.Arbitrary<Case>, label: string, requireShare: boolean): void {
    // **Validates: Requirements 4.2, 4.9, 4.10, 4.12, 11.3, 11.4**
    let calls = 0;
    let discarded = 0;
    let runs = 0;
    let smallestMargin = Number.POSITIVE_INFINITY;
    let runsWithStay = 0;
    let totalStays = 0;
    let longestSeen = 0;
    let smallestStartMargin = Number.POSITIVE_INFINITY;
    let startStays = 0;
    fc.assert(
      fc.property(arb, ({ cfg, overClamp, crossing, holdNeed, margin }) => {
        calls++;
        if (overClamp) discarded++;
        fc.pre(!overClamp);
        runs++;
        const seen: RawEvent[] = [];
        const d = openTrial({ ...cfg, observers: { onEvent: (e) => seen.push({ ...e }) } });
        const stays = trackStays(d);
        let result;
        let tEntry = 0;
        try {
          runWarmup(d);
          const s = runStartOfSession(d);
          tEntry = s.tEntry;
          runEntries(d, s);
          result = { entries: d.entries, accidental: d.accidental, startEvents: d.startEvents, eff: d.eff, plans: d.plans };
        } finally {
          d.pl.destroy();
        }
        const n = cfg.task.length;
        // The profile was not clamped: the dwell time and the window are the constructed ones.
        expect(result.eff.dwellTime).toBe(cfg.profile.dwellTime);
        expect(result.eff.smoothingStrength).toBe(0.5);
        const nonIntended = nonIntendedStays(stays, cfg.task);
        const entryStays = nonIntended.filter((x) => x.startMs >= tEntry);
        const startOnly = nonIntended.filter((x) => x.startMs < tEntry);
        totalStays += entryStays.length;
        startStays += startOnly.length;
        const check = (group: Stay[], isEntry: boolean): void => {
          const longest = longestNonIntendedStay(group, cfg.task);
          if (longest === null) return;
          const stayMs = longest.endMs - longest.startMs;
          const observed = (cfg.profile.dwellTime as number) - stayMs;
          if (isEntry) {
            runsWithStay++;
            longestSeen = Math.max(longestSeen, stayMs);
            smallestMargin = Math.min(smallestMargin, observed);
          } else {
            smallestStartMargin = Math.min(smallestStartMargin, observed);
          }
          if (observed <= 0) {
            throw new Error(
              `dwellTime ${cfg.profile.dwellTime} <= actual stay ${stayMs} ms on ${longest.targetId} (${isEntry ? "entry" : "start"}); ` +
                `planned crossing ${crossing}, hold need ${holdNeed}, margin ${margin}, fps ${cfg.fps}, stay ${JSON.stringify(longest)}, ` +
                `accidental ${JSON.stringify(result.accidental)}`,
            );
          }
        };
        check(entryStays, true);
        check(startOnly, false);
        // Premise of the dwell rule: every entry resolves at or after its planned move end (holding phase).
        result.entries.forEach((e, i) => {
          const plan = result.plans[i];
          expect(e.outcome).toBe("selected");
          expect(plan.tMove0 + (e.timeToSelectMs as number)).toBeGreaterThanOrEqual(moveEndMs(plan) - 1e-6);
        });
        expect(result.entries.map((e) => e.targetId)).toEqual([...cfg.task]);
        expect(result.entries.filter((e) => e.outcome === "selected")).toHaveLength(n);
        expect(result.entries.filter((e) => e.outcome === "miss")).toHaveLength(0);
        expect(result.accidental).toEqual([]);
        // Independent count: every event is either a start-of-session event or one intended selection.
        expect(seen.length).toBe(result.startEvents.length + n);
      }),
      { numRuns: 100, maxSkipsPerRun: 1000 },
    );
    console.log(
      `Property 2 [${label}]: runs ${runs}, calls ${calls}, discarded ${discarded} (rate ${(discarded / calls).toFixed(4)}), ` +
        `runs with an entry stay ${runsWithStay} (share ${(runsWithStay / runs).toFixed(4)}), ` +
        `entry stays in total ${totalStays}, longest entry stay ${longestSeen} ms, ` +
        `smallest margin over entry stays ${smallestMargin} ms; ` +
        `start-of-session stays ${startStays}, smallest start-of-session margin ${smallestStartMargin} ms`,
    );
    if (requireShare) expect(runsWithStay / runs).toBeGreaterThanOrEqual(0.5);
    expect(smallestMargin).toBeGreaterThan(0);
}

const caseArb = makeCaseArb(rowLayoutFor, rowTaskFor);
const generalCaseArb = makeCaseArb(generalLayoutFor, generalTaskFor);

describe("Property 2: clean run, no accidents, no misses", () => {
  it("builds targets of at least 6 SD on both axes, so SD equals the cap", () => {
    fc.assert(
      fc.property(caseArb, ({ cfg, cap }) => {
        const d = openTrial(cfg);
        try {
          for (const t of cfg.layout.targets) {
            expect(angularWidth(d.geometry, t.rect, "x")).toBeGreaterThanOrEqual(6 * cap);
            expect(angularWidth(d.geometry, t.rect, "y")).toBeGreaterThanOrEqual(6 * cap);
          }
        } finally {
          d.pl.destroy();
        }
      }),
      { numRuns: 100 },
    );
  });

  it("selects each intended target exactly once, with no accidental selection and no miss (row layout)", () => {
    checkProperty2(caseArb, "row", true);
  });

  it("selects each intended target exactly once, with no accidental selection and no miss (general layouts)", () => {
    checkProperty2(generalCaseArb, "general", false);
  });
});
