import { createPlanchette } from "@planchette/skeleton";
import { describe, expect, it } from "vitest";
import type { TrialEntryResult, TrialResult } from "../src/metrics.js";
import { pairTrials, summarizePairs, verdictFor, type ComparePair } from "../src/pairing.js";

const pl = createPlanchette({ screen: { width: 800, height: 600 }, inputs: false, trackingIndicator: false });
const PROFILE = pl.getProfile();
pl.destroy();

function sel(entry: number, ms: number): TrialEntryResult {
  return { entry, targetId: "t", outcome: "selected", timeToSelectMs: ms, missCause: null };
}
function miss(entry: number): TrialEntryResult {
  return { entry, targetId: "t", outcome: "miss", timeToSelectMs: null, missCause: "other" };
}
function trial(p: Partial<TrialResult> = {}): TrialResult {
  return {
    userName: "u",
    trialIndex: 0,
    entries: [],
    accidental: [],
    startEvents: [],
    warnings: [],
    effectiveProfile: PROFILE,
    ...p,
  };
}
function acc(n: number): TrialResult["accidental"] {
  return Array.from({ length: n }, (_, i) => ({
    targetId: "t",
    timeMs: i,
    activity: "moving" as const,
    cause: "other" as const,
    entry: 0,
  }));
}

describe("verdictFor", () => {
  it("uses the three fixed strings", () => {
    expect(verdictFor(3, 1)).toBe("a did better");
    expect(verdictFor(1, 3)).toBe("b did better");
    expect(verdictFor(2, 2)).toBe("tie");
    expect(verdictFor(0, 0)).toBe("tie");
  });
});

describe("pairTrials", () => {
  it("orders pairs by user in request order, then trial order", () => {
    const mk = (u: string) => [trial({ userName: u, trialIndex: 0 }), trial({ userName: u, trialIndex: 1 })];
    const pairs = pairTrials(["z", "a"], [mk("z"), mk("a")], [mk("z"), mk("a")]);
    expect(pairs.map((p) => [p.user, p.trial])).toEqual([
      ["z", 0],
      ["z", 1],
      ["a", 0],
      ["a", 1],
    ]);
  });

  it("counts accidental selections only, not start events, and misses by outcome", () => {
    const a = trial({
      accidental: acc(2),
      startEvents: [{ targetId: "t", timeMs: 1 }, { targetId: null, timeMs: 2 }],
      entries: [sel(0, 100), miss(1), miss(2)],
    });
    const b = trial({ accidental: acc(2), entries: [sel(0, 100), sel(1, 100), miss(2)] });
    const [p] = pairTrials(["u"], [[a]], [[b]]);
    expect(p.a).toMatchObject({ accidental: 2, misses: 2 });
    expect(p.b).toMatchObject({ accidental: 2, misses: 1 });
  });

  it("uses only entries selected in both, with the same entries on both sides", () => {
    const a = trial({ entries: [sel(0, 100), sel(1, 900), sel(2, 300), miss(3)] });
    const b = trial({ entries: [sel(0, 500), miss(1), sel(2, 700), sel(3, 1)] });
    const [p] = pairTrials(["u"], [[a]], [[b]]);
    // shared entries 0 and 2: a = [100, 300] -> p50 100; b = [500, 700] -> p50 500
    expect(p.a.medianTimeMs).toBe(100);
    expect(p.b.medianTimeMs).toBe(500);
  });

  it("gives null on both sides when no entry is selected in both", () => {
    const a = trial({ entries: [sel(0, 100), miss(1)] });
    const b = trial({ entries: [miss(0), sel(1, 100)] });
    const [p] = pairTrials(["u"], [[a]], [[b]]);
    expect(p.a.medianTimeMs).toBeNull();
    expect(p.b.medianTimeMs).toBeNull();
  });

  it("rejects mismatched shapes", () => {
    expect(() => pairTrials(["u"], [[trial()]], [[]])).toThrow(RangeError);
    expect(() => pairTrials(["u", "v"], [[trial()]], [[trial()]])).toThrow(RangeError);
  });
});

describe("summarizePairs", () => {
  const side = (accidental: number, misses: number, medianTimeMs: number | null) => ({ accidental, misses, medianTimeMs });
  const pair = (a: ReturnType<typeof side>, b: ReturnType<typeof side>): ComparePair => ({ user: "u", trial: 0, a, b });

  it("counts wins, losses and ties with lower better and exact comparison", () => {
    const m = summarizePairs([
      pair(side(1, 0, 100), side(2, 0, 100)),
      pair(side(3, 1, 200), side(1, 1, 150)),
      pair(side(2, 2, 100.5), side(2, 1, 100.5000001)),
    ]);
    expect(m.accidental).toEqual({ aWins: 1, bWins: 1, ties: 1, verdict: "tie" });
    expect(m.misses).toEqual({ aWins: 0, bWins: 1, ties: 2, verdict: "b did better" });
    expect(m.timeToSelect).toEqual({ aWins: 1, bWins: 1, ties: 1, verdict: "tie", pairedTrials: 3 });
  });

  it("skips a null-time pair for time-to-select only", () => {
    const m = summarizePairs([
      pair(side(0, 0, null), side(1, 0, null)),
      pair(side(0, 0, 50), side(0, 0, 80)),
    ]);
    expect(m.accidental).toEqual({ aWins: 1, bWins: 0, ties: 1, verdict: "a did better" });
    expect(m.timeToSelect).toEqual({ aWins: 1, bWins: 0, ties: 0, verdict: "a did better", pairedTrials: 1 });
  });

  it("is a tie with zero pairs", () => {
    const m = summarizePairs([]);
    expect(m.timeToSelect).toEqual({ aWins: 0, bWins: 0, ties: 0, verdict: "tie", pairedTrials: 0 });
  });
});
