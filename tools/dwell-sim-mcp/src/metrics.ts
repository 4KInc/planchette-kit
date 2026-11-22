/**
 * Results and metrics (design section 7). The trial result types moved here from
 * `run-trial.ts`, which re-exports them. `aggregateUser` keeps full precision; `round1` is
 * applied by `simulate` to the output only.
 */
import type { Profile } from "@planchette/skeleton";
import type { AccidentalCause, Activity, Layout } from "./types.js";

/** Result of one task entry. */
export interface TrialEntryResult {
  entry: number;
  targetId: string;
  outcome: "selected" | "miss";
  /** eventNow - tMove0; null for a miss. */
  timeToSelectMs: number | null;
  missCause: "unreachable" | "tremor-at-edge" | "other" | null;
}

export interface AccidentalRecord {
  /** null for a cancel without a target. */
  targetId: string | null;
  timeMs: number;
  activity: Activity;
  cause: AccidentalCause;
  entry: number;
}

/** A start-of-session event: activity is always 'waiting' and cause always 'start'. */
export interface StartEventRecord {
  /** null for a cancel without a target. */
  targetId: string | null;
  timeMs: number;
}

export interface TrialResult {
  userName: string;
  trialIndex: number;
  entries: TrialEntryResult[];
  accidental: AccidentalRecord[];
  startEvents: StartEventRecord[];
  warnings: string[];
  effectiveProfile: Profile;
}

export interface TargetMetrics {
  targetId: string | null;
  intended: number;
  /** Excludes start-of-session events. */
  accidental: number;
  /** Start-of-session events on this target, separate from `accidental`. */
  startCount: number;
  /** accidental / intended x 100 at full precision; null when intended is 0. */
  accidentalPer100Intended: number | null;
  misses: number;
  timeToSelectMs: { median: number | null; p90: number | null };
  /** Accidental selections only. */
  causes: Record<AccidentalCause, number>;
  activities: Record<Activity, number>;
}

export interface UserMetrics extends Omit<TargetMetrics, "targetId"> {
  userName: string;
  trials: number;
  perTarget: TargetMetrics[];
  startOfSession: { count: number; byTarget: { targetId: string | null; count: number }[] };
}

export const ACCIDENTAL_CAUSES: readonly AccidentalCause[] = [
  "reading-pause",
  "pass-over",
  "tremor-at-edge",
  "repeat",
  "waiting",
  "early-on-intended-target",
  "other",
];

export const ACTIVITIES: readonly Activity[] = ["waiting", "moving", "reading pause", "holding on the aim point"];

/**
 * Nearest-rank percentile: `sorted[ceil(p * n) - 1]`, null when there are no samples.
 * `p` is taken in whole percent (0.5 -> 50, 0.9 -> 90) so the rank is computed in integers
 * and a product such as 0.9 * 30 cannot land just above an integer.
 */
export function percentile(samples: readonly number[], p: number): number | null {
  const n = samples.length;
  if (n === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const pct = Math.round(p * 100);
  const rank = Math.min(n, Math.max(1, Math.floor((pct * n + 99) / 100)));
  return sorted[rank - 1];
}

/** One decimal; null stays null. */
export function round1(x: number | null): number | null {
  if (x === null) return null;
  return Math.round(x * 10) / 10;
}

interface Bucket {
  intended: number;
  misses: number;
  accidental: number;
  startCount: number;
  times: number[];
  causes: Record<AccidentalCause, number>;
  activities: Record<Activity, number>;
}

function newBucket(): Bucket {
  const causes = {} as Record<AccidentalCause, number>;
  for (const c of ACCIDENTAL_CAUSES) causes[c] = 0;
  const activities = {} as Record<Activity, number>;
  for (const a of ACTIVITIES) activities[a] = 0;
  return { intended: 0, misses: 0, accidental: 0, startCount: 0, times: [], causes, activities };
}

function bucketFor(map: Map<string | null, Bucket>, id: string | null): Bucket {
  let b = map.get(id);
  if (b === undefined) {
    b = newBucket();
    map.set(id, b);
  }
  return b;
}

function rate(accidental: number, intended: number): number | null {
  return intended === 0 ? null : (accidental / intended) * 100;
}

function toMetrics(b: Bucket): Omit<TargetMetrics, "targetId"> {
  return {
    intended: b.intended,
    accidental: b.accidental,
    startCount: b.startCount,
    accidentalPer100Intended: rate(b.accidental, b.intended),
    misses: b.misses,
    timeToSelectMs: { median: percentile(b.times, 0.5), p90: percentile(b.times, 0.9) },
    causes: { ...b.causes },
    activities: { ...b.activities },
  };
}

/** UTF-16 code unit order, null last. */
function compareIds(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/**
 * Per-user metrics over all trials of a user (design section 7). `layout` supplies the
 * selectable targets that always get a `perTarget` row.
 */
export function aggregateUser(userName: string, trials: readonly TrialResult[], layout: Layout): UserMetrics {
  const byTarget = new Map<string | null, Bucket>();
  const total = newBucket();

  for (const trial of trials) {
    for (const e of trial.entries) {
      const b = bucketFor(byTarget, e.targetId);
      if (e.outcome === "selected") {
        b.intended++;
        total.intended++;
      } else {
        b.misses++;
        total.misses++;
      }
      if (e.timeToSelectMs !== null) {
        b.times.push(e.timeToSelectMs);
        total.times.push(e.timeToSelectMs);
      }
    }
    for (const a of trial.accidental) {
      for (const x of [bucketFor(byTarget, a.targetId), total]) {
        x.accidental++;
        x.causes[a.cause]++;
        x.activities[a.activity]++;
      }
    }
    for (const s of trial.startEvents) {
      bucketFor(byTarget, s.targetId).startCount++;
      total.startCount++;
    }
  }

  // A row for every selectable layout target; any other target only when it has events
  // (a bucket exists only once some count in it was incremented).
  const ids = new Set<string | null>(byTarget.keys());
  for (const t of layout.targets) {
    if (t.role !== "rest-area") ids.add(t.id);
  }
  const perTarget: TargetMetrics[] = [...ids]
    .sort(compareIds)
    .map((id) => ({ targetId: id, ...toMetrics(byTarget.get(id) ?? newBucket()) }));

  const startIds = [...byTarget.entries()].filter(([, b]) => b.startCount > 0).map(([id]) => id);
  startIds.sort(compareIds);

  return {
    userName,
    trials: trials.length,
    ...toMetrics(total),
    perTarget,
    startOfSession: {
      count: total.startCount,
      byTarget: startIds.map((id) => ({ targetId: id, count: byTarget.get(id)?.startCount ?? 0 })),
    },
  };
}
