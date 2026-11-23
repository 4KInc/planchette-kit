/** Shared by the Property 7 test and its regression test (not a test file itself). */
import type { Profile, ScreenSize } from "@planchette/skeleton";
import { expect } from "vitest";
import type { Rect } from "@planchette/skeleton";
import { toPx } from "../src/geometry.js";
import { insideRect, type EntryPlan } from "../src/plan-entry.js";
import {
  openTrial,
  runEntries,
  runStartOfSession,
  runWarmup,
  type TrialConfig,
  type TrialEntryResult,
} from "../src/run-trial.js";
import type { ResolvedUser } from "../src/types.js";

export const ANALYSIS_WINDOW_MS = 60_000;

/**
 * B2 (D4): the scatter cap in px, the largest over the four directions (+yaw, -yaw, +pitch, -pitch).
 * Each direction is measured twice: from the head-centre pose, and from the dead-zone edge
 * (`+-headDeadZone`) outward by the cap. The dead zone eats the first `headDeadZone` degrees, so a
 * shift of the cap that starts outside it moves the pointer by `slope * cap`, more than the same
 * shift from the centre pose (`slope * (cap - D)`); the edge measurement is the larger one.
 *
 * Centre: (0, 0), the placeholder `openTrial` starts with. It is safe here because tremor and noise
 * are pinned to 0, so the warm-up holds the head still at the centre pose and the engine captures
 * (0, 0). `traced` asserts `d.centre` is (0, 0) on every run, so a violation fails loudly instead
 * of silently under-sizing the targets. (Reading the real captured centre needs a whole warm-up
 * per generated case, which is not cheap.)
 */
export function sdCapPx(screen: ScreenSize, profile: Partial<Profile>, user: ResolvedUser): number {
  const d = openTrial({
    layout: { screen, targets: [] },
    profile,
    user,
    mode: "head + dwell",
    task: [],
    fps: 60,
    analysisWindowMs: ANALYSIS_WINDOW_MS,
    requestSeed: 0,
    trialIndex: 0,
  });
  try {
    const cap = user.params.scatterCapDeg;
    const dz = d.geometry.profile.headDeadZone;
    let best = 0;
    for (const start of [0, dz]) {
      for (const [sy, sp] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const a = toPx(d.geometry, { yaw: sy * start, pitch: sp * start });
        const b = toPx(d.geometry, { yaw: sy * (start + cap), pitch: sp * (start + cap) });
        best = Math.max(best, Math.hypot(b.x - a.x, b.y - a.y));
      }
    }
    return best;
  } finally {
    d.pl.destroy();
  }
}

export interface MoveSample {
  t: number;
  x: number;
  y: number;
}

export interface StayAnalysis {
  /** First frame of the earliest in-target run chained to the selecting run, or null if the last run does not end at the select. */
  chainStart: number | null;
  /** `max(chainStart, pauseFrame)`, or null. */
  arrival: number | null;
  /** Time the engine does not count inside the chain after `arrival`: for each gap, (first in-target sample after) - (last in-target sample before). */
  gaps: number;
  /** Every gap between two in-target runs of the intended target in the history (chained or not). */
  allGaps: number[];
}

/**
 * The stay the engine (`stepDwell`) built on the intended target `rect`, read from the sampled pointer
 * path. History = samples with `lowerT < t <= select` (`lowerT` = the previous select, or -Infinity for
 * entry 0, which includes the start of session). Runs are maximal stretches of consecutive in-target
 * samples. The engine keeps a stay alive across an off-target gap while `now - lastOnTime <= graceTime`,
 * where `lastOnTime` is the last in-target sample, so two runs chain when
 * `firstSample(next) - lastSample(prev) <= graceTime`. A sample inside another selectable target (`others`)
 * breaks the chain (a different target starts a new stay).
 */
export function analyseStay(
  moves: readonly MoveSample[],
  rect: Rect,
  others: readonly Rect[],
  graceTime: number,
  select: number,
  lowerT: number,
  pauseFrame: number | null,
  frameMs: number,
): StayAnalysis {
  interface Run {
    first: number;
    last: number;
    /** An other-target sample lies between the previous run and this one. */
    blockedBefore: boolean;
  }
  const runs: Run[] = [];
  let cur: Run | null = null;
  let blocked = false;
  // `pointer-move` is emitted when the pointer changes, not on every frame, so a pointer that rests is
  // sampled on every frame at its last reported position: rebuild one sample per frame (sample and hold).
  const samples: MoveSample[] = [];
  if (moves.length > 0) {
    let mi = 0;
    for (let k = Math.round(moves[0].t / frameMs); k * frameMs <= select + 1e-9; k++) {
      const t = k * frameMs;
      while (mi + 1 < moves.length && moves[mi + 1].t <= t + 1e-9) mi++;
      samples.push({ t, x: moves[mi].x, y: moves[mi].y });
    }
  }
  for (const m of samples) {
    if (!(m.t > lowerT) || m.t > select + 1e-9) continue;
    if (insideRect(rect, m)) {
      if (cur) cur.last = m.t;
      else {
        cur = { first: m.t, last: m.t, blockedBefore: blocked };
        runs.push(cur);
      }
      blocked = false;
    } else {
      cur = null;
      if (others.some((o) => insideRect(o, m))) blocked = true;
    }
  }
  const allGaps: number[] = [];
  for (let i = 1; i < runs.length; i++) allGaps.push(runs[i].first - runs[i - 1].last);
  const lastRun = runs[runs.length - 1];
  if (!lastRun || Math.abs(lastRun.last - select) > 1e-9) return { chainStart: null, arrival: null, gaps: 0, allGaps };
  let i = runs.length - 1;
  while (i > 0 && !runs[i].blockedBefore && runs[i].first - runs[i - 1].last <= graceTime) i--;
  const chainStart = runs[i].first;
  const arrival = pauseFrame === null ? chainStart : Math.max(chainStart, pauseFrame);
  let gaps = 0;
  for (let j = i + 1; j < runs.length; j++) {
    if (runs[j - 1].last >= arrival - 1e-9) gaps += runs[j].first - runs[j - 1].last;
  }
  return { chainStart, arrival, gaps, allGaps };
}

/** B6: every sampled off-target gap on the intended target differs from `graceTime` by more than one 15 fps frame. */
export const B6_MARGIN_MS = 1000 / 15;
export function b6Holds(allGaps: readonly number[], graceTime: number): boolean {
  return allGaps.every((g) => Math.abs(g - graceTime) > B6_MARGIN_MS);
}

/** D4: the planned aim of every entry lies inside its intended target (half-open rectangle). */
export function aimsInside(cfg: Pick<TrialConfig, "layout">, plans: readonly EntryPlan[]): boolean {
  return plans.every((p) => {
    const rect = cfg.layout.targets.find((t) => t.id === p.targetId)!.rect;
    return insideRect(rect, p.aimPx);
  });
}


const IDENTITY_TOL_MS = 1e-6;

export type CaseCfg = Omit<TrialConfig, "fps">;

export interface Traced {
  entries: TrialEntryResult[];
  /** The plans the run used, in entry order. */
  plans: EntryPlan[];
  /** One record per selected entry. `holdT0` is the start of the plan's final `holding` segment. */
  checks: {
    entry: number;
    targetId: string;
    tEntry: number;
    tMove0: number;
    select: number;
    arrival: number | null;
    /** Sum of the sampled gap time inside the chain (time the engine does not count). */
    gaps: number;
    /** Every sampled off-target gap on the intended target in the entry's history (B6). */
    allGaps: number[];
    holdT0: number;
  }[];
}

/** Runs the trial like `runTrial`, also recording the pointer-move events (frame time = `d.k * frameMs`). */
export function traced(cfg: TrialConfig): Traced {
  const d = openTrial(cfg);
  try {
    const moves: { t: number; x: number; y: number }[] = [];
    d.pl.addEventListener("pointer-move", (e) => {
      moves.push({ t: d.k * d.frameMs, x: e.detail.x, y: e.detail.y });
    });
    runWarmup(d);
    expect(d.centre, "the captured centre is (0, 0), as sdCapPx assumes").toEqual({ yaw: 0, pitch: 0 });
    const s = runStartOfSession(d);
    runEntries(d, s);
    const checks: Traced["checks"] = [];
    d.entries.forEach((res, i) => {
      if (res.outcome !== "selected") return;
      const plan = d.plans[i];
      const rect = cfg.layout.targets.find((t) => t.id === plan.targetId)!.rect;
      const select = plan.tMove0 + (res.timeToSelectMs as number);
      // arrival = max(first frame of the earliest in-target run chained to the selecting run through
      // sampled off-target gaps of at most graceTime, first frame at or after the end of the preceding
      // post-selection pause). The previous select time is this plan's tEntry; entry 0 also sees the
      // start of session.
      const F = d.frameMs;
      const pauseFrame =
        plan.entry > 0 ? Math.ceil((plan.tEntry + (cfg.profile.postSelectionPause as number)) / F - 1e-9) * F : null;
      const others = cfg.layout.targets.filter((t) => t.id !== plan.targetId && t.role !== "rest-area").map((t) => t.rect);
      const stay = analyseStay(
        moves,
        rect,
        others,
        d.eff.graceTime,
        select,
        plan.entry > 0 ? plan.tEntry : Number.NEGATIVE_INFINITY,
        pauseFrame,
        F,
      );
      const arrival = stay.arrival;
      const hold = plan.segments.find((sg) => sg.kind === "hold" && sg.phase === "holding");
      checks.push({
        entry: res.entry,
        targetId: res.targetId,
        tEntry: plan.tEntry,
        tMove0: plan.tMove0,
        select,
        arrival,
        gaps: stay.gaps,
        allGaps: stay.allGaps,
        holdT0: hold ? hold.t0 : Number.POSITIVE_INFINITY,
      });
    });
    return { entries: d.entries, plans: d.plans, checks };
  } finally {
    d.pl.destroy();
  }
}


/** Second assertion: select - arrival - gaps = ceil(dwellTime / F) * F, per selected entry and fps. */
export function expectIdentity(cfg: CaseCfg, t15: Traced, t60: Traced): void {
  const dwell = cfg.profile.dwellTime as number;
  for (const [fps, t] of [[15, t15], [60, t60]] as const) {
    const F = 1000 / fps;
    for (const c of t.checks) {
      const where = `fps ${fps} entry ${c.entry} ${c.targetId}: select=${c.select} arrival=${c.arrival} gaps=${c.gaps} tEntry=${c.tEntry} dwell=${dwell} pause=${cfg.profile.postSelectionPause}`;
      expect(c.arrival, `no arrival frame found; ${where}`).not.toBeNull();
      expect(Math.abs(c.select - (c.arrival as number) - c.gaps - Math.ceil(dwell / F) * F), where).toBeLessThanOrEqual(
        IDENTITY_TOL_MS,
      );
    }
  }
}

