import fc from "fast-check";
import { createPlanchette } from "@planchette/skeleton";
import { describe, expect, it } from "vitest";
import { percentile, type TrialEntryResult, type TrialResult } from "../src/metrics.js";
import { pairTrials, summarizePairs, verdictFor, type ComparePair, type PairSide } from "../src/pairing.js";

const pl = createPlanchette({ screen: { width: 800, height: 600 }, inputs: false, trackingIndicator: false });
const PROFILE = pl.getProfile();
pl.destroy();

const entryArb = (k: number): fc.Arbitrary<TrialEntryResult> =>
  fc.oneof(
    fc.integer({ min: 0, max: 20 }).map((ms): TrialEntryResult => ({
      entry: k,
      targetId: "t",
      outcome: "selected",
      timeToSelectMs: ms * 50,
      missCause: null,
    })),
    fc.constant<TrialEntryResult>({ entry: k, targetId: "t", outcome: "miss", timeToSelectMs: null, missCause: "other" }),
  );

const accArb = fc.array(
  fc.record({
    targetId: fc.constant<string | null>("t"),
    timeMs: fc.nat(1000),
    activity: fc.constant("moving" as const),
    cause: fc.constant("other" as const),
    entry: fc.nat(5),
  }),
  { maxLength: 4 },
);
const startArb = fc.array(fc.record({ targetId: fc.constant<string | null>("t"), timeMs: fc.nat(1000) }), { maxLength: 3 });

/** Two trials with the same entry count. */
const trialPairArb = (index: number): fc.Arbitrary<[TrialResult, TrialResult]> =>
  fc.integer({ min: 0, max: 8 }).chain((n) => {
    const entries = fc.tuple(...Array.from({ length: n }, (_, k) => entryArb(k)));
    const one = fc
      .tuple(entries, accArb, startArb)
      .map(([e, a, s]): TrialResult => ({
        userName: "u",
        trialIndex: index,
        entries: e,
        accidental: a,
        startEvents: s,
        warnings: [],
        effectiveProfile: PROFILE,
      }));
    return fc.tuple(one, one);
  });

/** users x trials of paired results. */
const runsArb = fc
  .array(fc.integer({ min: 0, max: 4 }), { minLength: 0, maxLength: 4 })
  .chain((counts) =>
    fc.tuple(
      ...counts.map((c) => fc.tuple(...Array.from({ length: c }, (_, j) => trialPairArb(j)))),
    ),
  );

function split(runs: [TrialResult, TrialResult][][]): {
  names: string[];
  a: TrialResult[][];
  b: TrialResult[][];
} {
  return {
    names: runs.map((_, i) => "user" + i),
    a: runs.map((u) => u.map((p) => p[0])),
    b: runs.map((u) => u.map((p) => p[1])),
  };
}

describe("pairing properties", () => {
  it("verdict follows the win counts for any counts", () => {
    fc.assert(
      fc.property(fc.nat(1000), fc.nat(1000), (a, b) => {
        const v = verdictFor(a, b);
        expect(v).toBe(a > b ? "a did better" : b > a ? "b did better" : "tie");
      }),
    );
  });

  it("wins + losses + ties equal the pair count (accidental, misses) and pairedTrials (time)", () => {
    fc.assert(
      fc.property(runsArb, (runs) => {
        const { names, a, b } = split(runs as [TrialResult, TrialResult][][]);
        const pairs = pairTrials(names, a, b);
        const m = summarizePairs(pairs);
        const total = (v: { aWins: number; bWins: number; ties: number }) => v.aWins + v.bWins + v.ties;
        expect(total(m.accidental)).toBe(pairs.length);
        expect(total(m.misses)).toBe(pairs.length);
        expect(total(m.timeToSelect)).toBe(m.timeToSelect.pairedTrials);
        expect(m.timeToSelect.pairedTrials).toBe(pairs.filter((p) => p.a.medianTimeMs !== null).length);
        for (const v of [m.accidental, m.misses, m.timeToSelect]) expect(v.verdict).toBe(verdictFor(v.aWins, v.bWins));
      }),
    );
  });

  it("time is paired only over entries selected in both; null on both sides or neither", () => {
    fc.assert(
      fc.property(runsArb, (runs) => {
        const { names, a, b } = split(runs as [TrialResult, TrialResult][][]);
        const pairs = pairTrials(names, a, b);
        let i = 0;
        for (let u = 0; u < a.length; u++) {
          for (let j = 0; j < a[u].length; j++) {
            const ta: number[] = [];
            const tb: number[] = [];
            a[u][j].entries.forEach((ea, k) => {
              const eb = b[u][j].entries[k];
              if (ea.outcome === "selected" && eb.outcome === "selected") {
                ta.push(ea.timeToSelectMs as number);
                tb.push(eb.timeToSelectMs as number);
              }
            });
            const p = pairs[i++];
            expect(p.user).toBe(names[u]);
            expect(p.trial).toBe(j);
            expect(p.a.medianTimeMs).toBe(percentile(ta, 0.5));
            expect(p.b.medianTimeMs).toBe(percentile(tb, 0.5));
            expect(p.a.medianTimeMs === null).toBe(ta.length === 0);
            expect(p.b.medianTimeMs === null).toBe(ta.length === 0);
          }
        }
        expect(i).toBe(pairs.length);
      }),
    );
  });

  it("start-of-session events never change the accidental count", () => {
    fc.assert(
      fc.property(runsArb, startArb, (runs, extra) => {
        const base = split(runs as [TrialResult, TrialResult][][]);
        const more = {
          names: base.names,
          a: base.a.map((u) => u.map((t) => ({ ...t, startEvents: [...t.startEvents, ...extra] }))),
          b: base.b,
        };
        expect(pairTrials(more.names, more.a, more.b)).toEqual(pairTrials(base.names, base.a, base.b));
      }),
    );
  });

  it("summary depends only on the pair list: swapping sides swaps wins and losses", () => {
    const sideArb: fc.Arbitrary<PairSide> = fc.record({
      accidental: fc.nat(5),
      misses: fc.nat(5),
      medianTimeMs: fc.option(fc.nat(5), { nil: null }),
    });
    fc.assert(
      fc.property(fc.array(fc.tuple(sideArb, sideArb), { maxLength: 20 }), (ps) => {
        const pairs: ComparePair[] = ps.map(([a, b]) => ({ user: "u", trial: 0, a, b }));
        const swapped: ComparePair[] = ps.map(([a, b]) => ({ user: "u", trial: 0, a: b, b: a }));
        const x = summarizePairs(pairs);
        const y = summarizePairs(swapped);
        expect(y.accidental.aWins).toBe(x.accidental.bWins);
        expect(y.misses.bWins).toBe(x.misses.aWins);
        expect(y.timeToSelect.ties).toBe(x.timeToSelect.ties);
      }),
    );
  });
});
