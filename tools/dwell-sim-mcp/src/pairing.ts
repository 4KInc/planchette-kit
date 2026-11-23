/**
 * Paired metrics and verdicts for `compare` (design section 9). Pure functions from the
 * per-user trial results of two configurations to `pairs` and one pooled verdict per metric.
 * Lower is better for all three metrics; equal is a tie, compared exactly.
 */
import { percentile, type TrialResult } from "./metrics.js";

export interface PairSide {
  accidental: number;
  misses: number;
  medianTimeMs: number | null;
}

export interface ComparePair {
  user: string;
  trial: number;
  a: PairSide;
  b: PairSide;
}

export type VerdictText = "a did better" | "b did better" | "tie";

export interface MetricVerdict {
  aWins: number;
  bWins: number;
  ties: number;
  verdict: VerdictText;
}

export type TimeToSelectVerdict = MetricVerdict & { pairedTrials: number };

export interface PairMetrics {
  accidental: MetricVerdict;
  misses: MetricVerdict;
  timeToSelect: TimeToSelectVerdict;
}

/** More wins did better; equal wins is a tie. The three strings are fixed. */
export function verdictFor(aWins: number, bWins: number): VerdictText {
  if (aWins > bWins) return "a did better";
  if (bWins > aWins) return "b did better";
  return "tie";
}

function countMisses(t: TrialResult): number {
  let n = 0;
  for (const e of t.entries) if (e.outcome === "miss") n++;
  return n;
}

/**
 * Median time-to-select of both sides over the entries selected in both trials (entry k of
 * a with entry k of b). Both are null when no entry is selected in both.
 */
function sharedMedians(a: TrialResult, b: TrialResult): { a: number | null; b: number | null } {
  const ta: number[] = [];
  const tb: number[] = [];
  const n = Math.min(a.entries.length, b.entries.length);
  for (let k = 0; k < n; k++) {
    const ea = a.entries[k];
    const eb = b.entries[k];
    if (ea.outcome !== "selected" || eb.outcome !== "selected") continue;
    if (ea.timeToSelectMs === null || eb.timeToSelectMs === null) continue;
    ta.push(ea.timeToSelectMs);
    tb.push(eb.timeToSelectMs);
  }
  return { a: percentile(ta, 0.5), b: percentile(tb, 0.5) };
}

/**
 * One pair per user and trial: users in request order, then trial order. `userNames`,
 * `a` and `b` are parallel (one `TrialResult[]` per user); trial j of a pairs with trial j
 * of b. `trial` is the trial index of side a. Throws a RangeError when the shapes differ.
 */
export function pairTrials(
  userNames: readonly string[],
  a: readonly (readonly TrialResult[])[],
  b: readonly (readonly TrialResult[])[],
): ComparePair[] {
  if (a.length !== userNames.length || b.length !== userNames.length) {
    throw new RangeError("pairTrials: users and result lists differ in length");
  }
  const pairs: ComparePair[] = [];
  for (let u = 0; u < userNames.length; u++) {
    const ua = a[u];
    const ub = b[u];
    if (ua.length !== ub.length) throw new RangeError("pairTrials: trial counts differ for user " + userNames[u]);
    for (let j = 0; j < ua.length; j++) {
      const m = sharedMedians(ua[j], ub[j]);
      pairs.push({
        user: userNames[u],
        trial: ua[j].trialIndex,
        a: { accidental: ua[j].accidental.length, misses: countMisses(ua[j]), medianTimeMs: m.a },
        b: { accidental: ub[j].accidental.length, misses: countMisses(ub[j]), medianTimeMs: m.b },
      });
    }
  }
  return pairs;
}

function tally(pairs: readonly ComparePair[], pick: (s: PairSide) => number | null): MetricVerdict & { counted: number } {
  let aWins = 0;
  let bWins = 0;
  let ties = 0;
  for (const p of pairs) {
    const x = pick(p.a);
    const y = pick(p.b);
    if (x === null || y === null) continue; // no paired time: neither a tie nor counted
    if (x < y) aWins++;
    else if (y < x) bWins++;
    else ties++;
  }
  return { aWins, bWins, ties, verdict: verdictFor(aWins, bWins), counted: aWins + bWins + ties };
}

function plain(v: MetricVerdict): MetricVerdict {
  return { aWins: v.aWins, bWins: v.bWins, ties: v.ties, verdict: v.verdict };
}

/** One pooled verdict per metric over all pairs. */
export function summarizePairs(pairs: readonly ComparePair[]): PairMetrics {
  const time = tally(pairs, (s) => s.medianTimeMs);
  return {
    accidental: plain(tally(pairs, (s) => s.accidental)),
    misses: plain(tally(pairs, (s) => s.misses)),
    timeToSelect: { ...plain(time), pairedTrials: time.counted },
  };
}
