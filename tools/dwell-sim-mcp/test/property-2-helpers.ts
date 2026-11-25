/** Shared by the Property 2 test and its regression test (not a test file itself). */
import type { Profile } from "@planchette/skeleton";
import { toPx } from "../src/geometry.js";
import { poseOnSegment } from "../src/min-jerk.js";
import { planEntry, insideRect, type EntryPlan, type PlanContext, type Segment } from "../src/plan-entry.js";
import { planStart, type StartPlan } from "../src/plan-start.js";
import { openTrial, type TrialConfig, type TrialDriver } from "../src/run-trial.js";
import { MT_MIN } from "../src/fitts.js";
import type { Layout } from "../src/types.js";

export const SLOWEST_THROUGHPUT = 0.3;
export const MAX_WINDOW_MS = 120_000;
/** L: smoother arrival-lag limit (ms) of the default smoothing. */
export const LAG_LIMIT_MS = 150;
/** The dwell clamp of the profile (ms). */
export const DWELL_MAX_MS = 3000;

/** Longest time (ms, 1 ms resolution) any of `targets` is continuously under the pointer along the move segments of a plan. */
export function longestCrossing(
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

/** End of the last move segment of a plan (its `tMove0` when it has none, or `t0` of its first segment). */
export function moveEndMs(plan: Pick<EntryPlan, "segments" | "tMove0">): number {
  let end = plan.tMove0;
  for (const s of plan.segments) if (s.kind === "move") end = Math.max(end, s.t1);
  return end;
}

/**
 * Planned time (1 ms resolution) at which the path first lies inside `rect`: the plan's first segment time when the
 * path starts inside, the end of the moves when the 1 ms sampling never sees it inside.
 */
export function enterMs(
  plan: Pick<EntryPlan, "segments" | "tMove0">,
  rect: Layout["targets"][number]["rect"],
  geometry: Parameters<typeof toPx>[0],
): number {
  const first = plan.segments[0];
  if (first === undefined) return plan.tMove0;
  const p0 = toPx(geometry, first.kind === "hold" ? first.pose : first.from);
  if (insideRect(rect, p0)) return first.t0;
  for (const seg of plan.segments) {
    if (seg.kind !== "move") continue;
    for (let t = seg.t0; ; t += 1) {
      const tt = Math.min(t, seg.t1);
      if (insideRect(rect, toPx(geometry, poseOnSegment(seg, tt)))) return tt;
      if (tt >= seg.t1) break;
    }
  }
  return moveEndMs(plan);
}

export interface BuiltCase {
  cfg: TrialConfig;
  overClamp: boolean;
  /** Longest planned crossing of a non-intended selectable target (start plan and entry plans). */
  crossing: number;
  /** Largest (move end - planned entry time into the intended target) over the entries. */
  holdNeed: number;
  margin: number;
}

/**
 * The dwell time is the larger of two lower bounds, each plus margin = L + F(fps):
 * - the longest planned crossing of a non-intended target;
 * - the largest (move end of entry k) - (planned time the path enters target k), so that the selection of every
 *   entry cannot come before its planned move ends. Then the next entry starts from `aim` (the holding phase),
 *   which is the start pose both plans here assume (p0 of entry k = aim of entry k-1).
 */
export function buildCase(
  base: Omit<TrialConfig, "profile" | "analysisWindowMs"> & { profile: Partial<Profile> },
): BuiltCase {
  const { layout, user, task } = base;
  const provisional: TrialConfig = { ...base, analysisWindowMs: 10_000 };
  const d = openTrial(provisional);
  let crossing = 0;
  let holdNeed = 0;
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
      const rect = layout.targets.find((t) => t.id === plan.targetId)!.rect;
      holdNeed = Math.max(holdNeed, moveEndMs(plan) - enterMs(plan, rect, d.geometry));
      p0 = plan.aim;
    }
  } finally {
    d.pl.destroy();
  }
  const margin = LAG_LIMIT_MS + 1000 / base.fps;
  const needed = Math.ceil(Math.max(crossing, holdNeed) + margin);
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
  return {
    cfg: { ...base, profile: { ...base.profile, dwellTime }, analysisWindowMs },
    overClamp,
    crossing,
    holdNeed,
    margin,
  };
}

export interface Stay {
  targetId: string;
  /** First frame time with the shown pointer inside the rect. */
  startMs: number;
  /** Last frame time with the shown pointer inside the rect. Stay = endMs - startMs. */
  endMs: number;
  /** Task index in force when the stay began and when it ended (-1 before the first entry). */
  entryAtStart: number;
  entryAtEnd: number;
}

/**
 * Records the stays of the shown pointer on selectable targets. `pointer-move` fires only on change, so the pointer
 * is held between events (sample and hold, as in p7-helpers): a stay runs from the first frame whose pointer is
 * inside the rect to the last such frame, i.e. the frame before the event that moves it outside. Frame time is
 * `k * frameMs` of the frame being fed.
 */
export function trackStays(d: TrialDriver): Stay[] {
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
        stays.push({
          targetId: t.id,
          startMs: o.startMs,
          endMs: now - d.frameMs,
          entryAtStart: o.entry,
          entryAtEnd: entry,
        });
        open.delete(t.id);
      }
    }
  });
  return stays;
}

/** Every closed stay on a target that is not the intended one at its start or at its end. */
export function nonIntendedStays(stays: readonly Stay[], task: readonly string[]): Stay[] {
  return stays.filter((s) => task[s.entryAtStart] !== s.targetId && task[s.entryAtEnd] !== s.targetId);
}

/** Longest closed stay on a target that is not the intended one at its start or at its end. */
export function longestNonIntendedStay(stays: readonly Stay[], task: readonly string[]): Stay | null {
  let best: Stay | null = null;
  for (const s of stays) {
    if (task[s.entryAtStart] === s.targetId || task[s.entryAtEnd] === s.targetId) continue;
    if (best === null || s.endMs - s.startMs > best.endMs - best.startMs) best = s;
  }
  return best;
}
