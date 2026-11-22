import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Profile } from "@planchette/skeleton";
import { angularWidth, toPx } from "../src/geometry.js";
import { poseOnSegment } from "../src/min-jerk.js";
import { planEntry, insideRect, type EntryPlan, type PlanContext, type Segment } from "../src/plan-entry.js";
import { planStart, type StartPlan } from "../src/plan-start.js";
import { resolveUser } from "../src/resolve-user.js";
import {
  openTrial,
  runEntries,
  runStartOfSession,
  runWarmup,
  type TrialConfig,
  type TrialDriver,
} from "../src/run-trial.js";
import { MT_MIN } from "../src/fitts.js";
import type { Layout, RawEvent, ResolvedUser } from "../src/types.js";
import { customUserArb } from "./arbitraries.js";

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
 * - `dwellTime` is the longest planned crossing of a non-intended target (start plan and entry plans) + margin,
 *   with margin = L + F(fps) = 150 ms + 1000 / fps (design, Property 2, derivation). `smoothingStrength` is the default 0.5
 *   and is never varied. Cases where crossing + margin > 3000 ms (the dwell clamp) are discarded with `fc.pre`; the discard
 *   rate is printed. The smallest dwellTime - (longest actual pointer stay on a non-intended target) is printed and must be > 0;
 *   the stays are intervals between consecutive `pointer-move` events whose positions lie inside the rect.
 * - the analysis window is reaction + movement (slowest throughput) + dwell + post-selection pause + 1000 ms, at most 120 s.
 */

const SLOWEST_THROUGHPUT = 0.3;
const MAX_WINDOW_MS = 120_000;
/** Most columns the generated grids have (see the screen and target limits below). */
const MARGIN_PX = 2;

/** L: smoother arrival-lag limit (ms) of the default smoothing. */
const LAG_LIMIT_MS = 150;
/** The dwell clamp of the profile (ms). */
const DWELL_MAX_MS = 3000;

interface Case {
  cfg: TrialConfig;
  cap: number;
  /** crossing + margin exceeds the dwell clamp: the case cannot be built, the property discards it. */
  overClamp: boolean;
  crossing: number;
  margin: number;
}

/** Longest time (ms, 1 ms resolution) any of `targets` is continuously under the pointer along the move segments of a plan. */
function longestCrossing(
  segments: readonly Segment[],
  targets: Layout["targets"],
  geometry: Parameters<typeof toPx>[0],
): number {
  let longest = 0;
  const first = segments[0];
  if (first === undefined) return 0;
  const p0 = toPx(geometry, first.kind === "hold" ? first.pose : first.from);
  for (const target of targets) {
    // A target the pointer starts in is not crossed: its first run is the pointer leaving it.
    let ignoreFirst = insideRect(target.rect, p0);
    let runStart: number | null = null;
    for (const seg of segments) {
      if (seg.kind !== "move") continue;
      for (let t = seg.t0; ; t += 1) {
        const tt = Math.min(t, seg.t1);
        const inside = insideRect(target.rect, toPx(geometry, poseOnSegment(seg, tt)));
        if (inside && runStart === null) runStart = tt;
        if (!inside && runStart !== null) {
          if (ignoreFirst) ignoreFirst = false;
          else longest = Math.max(longest, tt - runStart);
          runStart = null;
        }
        if (tt >= seg.t1) break;
      }
    }
    // A run that is still open when the plan's last move ends belongs to the target the pointer stops in.
  }
  return longest;
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

function buildCase(
  base: Omit<TrialConfig, "profile" | "analysisWindowMs"> & { profile: Partial<Profile> },
): { cfg: TrialConfig; overClamp: boolean; crossing: number; margin: number } {
  const { layout, user, task } = base;
  const provisional: TrialConfig = { ...base, analysisWindowMs: 10_000 };
  const d = openTrial(provisional);
  let crossing = 0;
  try {
    const ctx: PlanContext = {
      geometry: d.geometry,
      layout,
      task,
      user: user.params,
      analysisWindowMs: provisional.analysisWindowMs,
      streams: d.streams,
    };
    const start: StartPlan = planStart(ctx, 0);
    const selectable = (exceptId: string | null): Layout["targets"] =>
      layout.targets.filter((t) => t.role !== "rest-area" && t.id !== exceptId);
    crossing = longestCrossing(start.segments, selectable(null), d.geometry);
    let p0 = start.endPose;
    for (let k = 0; k < task.length; k++) {
      const plan: EntryPlan = planEntry(ctx, k, 0, p0);
      crossing = Math.max(crossing, longestCrossing(plan.segments, selectable(plan.targetId), d.geometry));
      p0 = plan.aim;
    }
  } finally {
    d.pl.destroy();
  }
  const margin = LAG_LIMIT_MS + 1000 / base.fps;
  const needed = Math.ceil(crossing + margin);
  const overClamp = needed > DWELL_MAX_MS;
  const dwellTime = Math.min(DWELL_MAX_MS, Math.max(400, needed));

  // Movement: the longest possible move (screen diagonal) onto the smallest target side, at the slowest throughput.
  const A = Math.hypot(layout.screen.width, layout.screen.height);
  const W = Math.min(...layout.targets.map((t) => Math.min(t.rect.width, t.rect.height)));
  const movement = Math.max(MT_MIN, (1000 * Math.log2(A / W + 1)) / SLOWEST_THROUGHPUT);
  const pause = base.profile.postSelectionPause ?? 0;
  const analysisWindowMs = Math.min(
    MAX_WINDOW_MS,
    Math.ceil(user.params.reactionTimeMs + movement + dwellTime + pause + 1000),
  );
  return { cfg: { ...base, profile: { ...base.profile, dwellTime }, analysisWindowMs }, overClamp, crossing, margin };
}

interface Stay {
  targetId: string;
  startMs: number;
  endMs: number;
  /** Task index in force when the stay began and when it ended (-1 before the first entry). */
  entryAtStart: number;
  entryAtEnd: number;
}

/**
 * Records the stays of the shown pointer on selectable targets from the `pointer-move` events:
 * a stay runs from the first event with the position inside the rect to the next event outside it.
 * Time is the frame time of the event (`k * frameMs` while the frame is fed).
 */
function trackStays(d: TrialDriver): Stay[] {
  const stays: Stay[] = [];
  const open = new Map<string, { startMs: number; entry: number }>();
  const targets = d.cfg.layout.targets.filter((t) => t.role !== "rest-area");
  d.pl.addEventListener("pointer-move", (e) => {
    const now = d.k * d.frameMs;
    const entry = d.plans.length - 1;
    for (const t of targets) {
      const inside = insideRect(t.rect, { x: e.detail.x, y: e.detail.y });
      const o = open.get(t.id);
      if (inside && o === undefined) open.set(t.id, { startMs: now, entry });
      else if (!inside && o !== undefined) {
        stays.push({ targetId: t.id, startMs: o.startMs, endMs: now, entryAtStart: o.entry, entryAtEnd: entry });
        open.delete(t.id);
      }
    }
  });
  return stays;
}

/** Every closed stay on a target that is not the intended one at its start or at its end. */
function nonIntendedStays(stays: readonly Stay[], task: readonly string[]): Stay[] {
  return stays.filter((s) => task[s.entryAtStart] !== s.targetId && task[s.entryAtEnd] !== s.targetId);
}

/** Longest closed stay on a target that is not the intended one at its start or at its end. */
function longestNonIntendedStay(stays: readonly Stay[], task: readonly string[]): Stay | null {
  let best: Stay | null = null;
  for (const s of stays) {
    if (task[s.entryAtStart] === s.targetId || task[s.entryAtEnd] === s.targetId) continue;
    if (best === null || s.endMs - s.startMs > best.endMs - best.startMs) best = s;
  }
  return best;
}

const caseArb: fc.Arbitrary<Case> = fc
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
        layout: rowLayoutArb(screen, pxFor(width, 6 * cap), pxFor(height, 6 * cap)),
        fps: fc.constantFrom<15 | 30 | 60>(15, 30, 60),
        requestSeed: fc.integer({ min: 0, max: 0xffffffff }),
        trialIndex: fc.integer({ min: 0, max: 20 }),
      })
      .chain(({ user, layout, fps, requestSeed, trialIndex }) =>
        crossingTaskArb(layout).map((task): Case => {
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
          return { cfg: built.cfg, cap, overClamp: built.overClamp, crossing: built.crossing, margin: built.margin };
        }),
      );
  });

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

  it("selects each intended target exactly once, with no accidental selection and no miss", () => {
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
      fc.property(caseArb, ({ cfg, overClamp, crossing, margin }) => {
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
          result = { entries: d.entries, accidental: d.accidental, startEvents: d.startEvents, eff: d.eff };
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
                `planned crossing ${crossing}, margin ${margin}, fps ${cfg.fps}, stay ${JSON.stringify(longest)}, ` +
                `accidental ${JSON.stringify(result.accidental)}`,
            );
          }
        };
        check(entryStays, true);
        check(startOnly, false);
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
      `Property 2: runs ${runs}, calls ${calls}, discarded ${discarded} (rate ${(discarded / calls).toFixed(4)}), ` +
        `runs with an entry stay ${runsWithStay} (share ${(runsWithStay / runs).toFixed(4)}), ` +
        `entry stays in total ${totalStays}, longest entry stay ${longestSeen} ms, ` +
        `smallest margin over entry stays ${smallestMargin} ms; ` +
        `start-of-session stays ${startStays}, smallest start-of-session margin ${smallestStartMargin} ms`,
    );
    expect(runsWithStay / runs).toBeGreaterThanOrEqual(0.5);
    expect(smallestMargin).toBeGreaterThan(0);
  });
});
