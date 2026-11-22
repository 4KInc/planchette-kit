import { createPlanchette } from "@planchette/skeleton";
import { describe, expect, it } from "vitest";
import {
  aggregateUser,
  percentile,
  round1,
  type AccidentalRecord,
  type StartEventRecord,
  type TrialEntryResult,
  type TrialResult,
} from "../src/metrics.js";
import type { AccidentalCause, Activity, Layout } from "../src/types.js";

const CAUSES: readonly AccidentalCause[] = [
  "reading-pause",
  "pass-over",
  "tremor-at-edge",
  "repeat",
  "waiting",
  "early-on-intended-target",
  "other",
];
const ACTIVITY_LABELS: readonly Activity[] = ["waiting", "moving", "reading pause", "holding on the aim point"];

const pl = createPlanchette({ screen: { width: 800, height: 600 }, inputs: false, trackingIndicator: false });
const PROFILE = pl.getProfile();
pl.destroy();

const rect = (x: number) => ({ x, y: 0, width: 50, height: 50 });
const layout: Layout = {
  screen: { width: 800, height: 600 },
  targets: [
    { id: "b", rect: rect(100), autoRepeat: false, role: "default" },
    { id: "a", rect: rect(200), autoRepeat: false, role: "default" },
    { id: "cancel", rect: rect(300), autoRepeat: false, role: "cancel" },
    { id: "rest", rect: rect(400), autoRepeat: false, role: "rest-area" },
  ],
};

function sel(entry: number, targetId: string, t: number): TrialEntryResult {
  return { entry, targetId, outcome: "selected", timeToSelectMs: t, missCause: null };
}
function miss(entry: number, targetId: string, cause: "unreachable" | "tremor-at-edge" | "other" = "other"): TrialEntryResult {
  return { entry, targetId, outcome: "miss", timeToSelectMs: null, missCause: cause };
}
function acc(targetId: string | null, cause: AccidentalCause = "other", activity: Activity = "moving"): AccidentalRecord {
  return { targetId, timeMs: 1, activity, cause, entry: 0 };
}
function start(targetId: string | null): StartEventRecord {
  return { targetId, timeMs: 1 };
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
function row(m: ReturnType<typeof aggregateUser>, id: string | null) {
  return m.perTarget.find((r) => r.targetId === id);
}

describe("percentile (nearest rank)", () => {
  it("is null with no samples", () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([], 0.9)).toBeNull();
  });
  it("takes the lower middle value for an even count", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(percentile([4, 1, 3, 2], 0.5)).toBe(2);
  });
  it("takes the middle value for an odd count and the only value for n = 1", () => {
    expect(percentile([5, 1, 3], 0.5)).toBe(3);
    expect(percentile([7], 0.5)).toBe(7);
    expect(percentile([7], 0.9)).toBe(7);
  });
  it("p90 is sorted[ceil(0.9 n) - 1]", () => {
    const ten = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(ten, 0.9)).toBe(90);
    expect(percentile([...ten, 110], 0.9)).toBe(100); // ceil(9.9) = 10
    const thirty = Array.from({ length: 30 }, (_, i) => i + 1);
    expect(percentile(thirty, 0.9)).toBe(27); // 0.9 * 30 is exactly 27, not 28
  });
  it("does not change its input", () => {
    const xs = [3, 1, 2];
    percentile(xs, 0.5);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe("round1", () => {
  it("rounds to one decimal, null stays null, integers stay", () => {
    expect(round1(10.526315789473685)).toBe(10.5);
    expect(round1(null)).toBeNull();
    expect(round1(75)).toBe(75);
    expect(round1(0)).toBe(0);
  });
});

describe("aggregateUser: null rules", () => {
  it("no trials: rate and percentiles are null, counts zero", () => {
    const m = aggregateUser("u", [], layout);
    expect(m.trials).toBe(0);
    expect(m.intended).toBe(0);
    expect(m.accidentalPer100Intended).toBeNull();
    expect(m.timeToSelectMs).toEqual({ median: null, p90: null });
    expect(m.startOfSession).toEqual({ count: 0, byTarget: [] });
  });
  it("no intended selection: the rate is null even with accidentals", () => {
    const m = aggregateUser("u", [trial({ entries: [miss(0, "a")], accidental: [acc("a")] })], layout);
    expect(m.accidental).toBe(1);
    expect(m.misses).toBe(1);
    expect(m.accidentalPer100Intended).toBeNull();
    expect(m.timeToSelectMs).toEqual({ median: null, p90: null });
    expect(row(m, "a")?.accidentalPer100Intended).toBeNull();
  });
  it("a user row has the user fields and no targetId", () => {
    const m = aggregateUser("ann", [trial()], layout);
    expect(m.userName).toBe("ann");
    expect("targetId" in m).toBe(false);
  });
});

describe("aggregateUser: counting rules", () => {
  const t1 = trial({
    entries: [sel(0, "a", 400), miss(1, "b", "tremor-at-edge"), sel(2, "a", 200)],
    accidental: [acc("b", "reading-pause", "reading pause"), acc(null, "waiting", "waiting")],
    startEvents: [start("a")],
  });
  const t2 = trial({
    trialIndex: 1,
    entries: [sel(0, "b", 100), sel(1, "a", 300)],
    accidental: [acc("a", "repeat", "holding on the aim point")],
    startEvents: [start("a"), start(null)],
  });
  const m = aggregateUser("u", [t1, t2], layout);

  it("counts intended on the aimed target and sums trials", () => {
    expect(m.trials).toBe(2);
    expect(m.intended).toBe(4);
    expect(row(m, "a")?.intended).toBe(3);
    expect(row(m, "b")?.intended).toBe(1);
  });
  it("counts a miss on its aimed target", () => {
    expect(m.misses).toBe(1);
    expect(row(m, "b")?.misses).toBe(1);
    expect(row(m, "a")?.misses).toBe(0);
  });
  it("pools time samples across trials (nearest rank)", () => {
    // a: 400, 200, 300 -> median 300; all: 100, 200, 300, 400 -> median 200
    expect(row(m, "a")?.timeToSelectMs).toEqual({ median: 300, p90: 400 });
    expect(m.timeToSelectMs).toEqual({ median: 200, p90: 400 });
  });
  it("counts accidental on its targetId, null bucket when absent, and not start events", () => {
    expect(m.accidental).toBe(3);
    expect(row(m, "b")?.accidental).toBe(1);
    expect(row(m, "a")?.accidental).toBe(1);
    expect(row(m, null)?.accidental).toBe(1);
    expect(row(m, null)?.causes.waiting).toBe(1);
    expect(row(m, null)?.activities.waiting).toBe(1);
  });
  it("counts start events as startCount and in startOfSession, sorted, null last", () => {
    expect(m.startCount).toBe(3);
    expect(row(m, "a")?.startCount).toBe(2);
    expect(row(m, null)?.startCount).toBe(1);
    expect(m.startOfSession).toEqual({
      count: 3,
      byTarget: [
        { targetId: "a", count: 2 },
        { targetId: null, count: 1 },
      ],
    });
  });
  it("sums causes and activities over accidental records only", () => {
    expect(m.causes["reading-pause"]).toBe(1);
    expect(m.causes.repeat).toBe(1);
    expect(m.causes.waiting).toBe(1);
    expect(m.activities["reading pause"]).toBe(1);
    expect(m.activities["holding on the aim point"]).toBe(1);
  });
  it("per-target rates use the target's own counts", () => {
    expect(row(m, "a")?.accidentalPer100Intended).toBeCloseTo((1 / 3) * 100, 10);
    expect(row(m, "b")?.accidentalPer100Intended).toBe(100);
  });
});

describe("start events stay out of accidental and the rate", () => {
  it("4 accidental, 1 start and 38 intended: 10.526... in metrics, 10.5 after round1", () => {
    const entries = Array.from({ length: 38 }, (_, i) => sel(i, "a", 100));
    const m = aggregateUser(
      "u",
      [trial({ entries, accidental: [acc("a"), acc("a"), acc("b"), acc("b")], startEvents: [start("a")] })],
      layout,
    );
    expect(m.accidental).toBe(4);
    expect(m.startCount).toBe(1);
    expect(m.accidentalPer100Intended).toBe((4 / 38) * 100);
    expect(m.accidentalPer100Intended).not.toBe(10.5);
    expect(round1(m.accidentalPer100Intended)).toBe(10.5);
    expect(round1(row(m, "a")?.accidentalPer100Intended ?? null)).toBe(round1((2 / 38) * 100));
  });
});

describe("perTarget order and membership", () => {
  it("has a zero row for every selectable target, in id order, and no rest-area or null row", () => {
    const m = aggregateUser("u", [trial()], layout);
    expect(m.perTarget.map((r) => r.targetId)).toEqual(["a", "b", "cancel"]);
    for (const r of m.perTarget) {
      expect(r.intended + r.misses + r.accidental + r.startCount).toBe(0);
      expect(r.accidentalPer100Intended).toBeNull();
    }
  });
  it("orders ids by UTF-16 code unit, with null last", () => {
    const l: Layout = {
      screen: layout.screen,
      targets: ["b", "B", "a", "é", "10", "9"].map((id, i) => ({
        id,
        rect: rect(i * 60),
        autoRepeat: false,
        role: "default" as const,
      })),
    };
    const m = aggregateUser("u", [trial({ accidental: [acc(null)] })], l);
    expect(m.perTarget.map((r) => r.targetId)).toEqual(["10", "9", "B", "a", "b", "é", null]);
  });
  it("adds a rest-area row only when it has events", () => {
    const without = aggregateUser("u", [trial()], layout);
    expect(row(without, "rest")).toBeUndefined();
    for (const p of [
      { accidental: [acc("rest")] },
      { startEvents: [start("rest")] },
    ]) {
      const m = aggregateUser("u", [trial(p)], layout);
      expect(m.perTarget.map((r) => r.targetId)).toEqual(["a", "b", "cancel", "rest"]);
    }
  });
  it("adds the null row only when it has events, after every id", () => {
    expect(row(aggregateUser("u", [trial()], layout), null)).toBeUndefined();
    const m = aggregateUser("u", [trial({ startEvents: [start(null)] })], layout);
    expect(m.perTarget.map((r) => r.targetId)).toEqual(["a", "b", "cancel", null]);
  });
});

describe("causes and activities keys", () => {
  it("are complete with zeros on users and targets", () => {
    const m = aggregateUser("u", [trial({ entries: [sel(0, "a", 1)], accidental: [acc("a", "pass-over")] })], layout);
    for (const x of [m, ...m.perTarget]) {
      expect(Object.keys(x.causes).sort()).toEqual([...CAUSES].sort());
      expect(Object.keys(x.activities).sort()).toEqual([...ACTIVITY_LABELS].sort());
    }
    expect(m.causes["pass-over"]).toBe(1);
    expect(m.causes.other).toBe(0);
    const empty = aggregateUser("u", [], layout);
    expect(Object.values(empty.causes).every((v) => v === 0)).toBe(true);
    expect(Object.keys(empty.activities)).toHaveLength(4);
  });
});

describe("no NaN or Infinity", () => {
  it("every number in the output is finite", () => {
    const outputs = [
      aggregateUser("u", [], layout),
      aggregateUser("u", [trial({ entries: [miss(0, "a")], accidental: [acc("a")], startEvents: [start(null)] })], layout),
      aggregateUser("u", [trial({ entries: [sel(0, "a", 0)] })], layout),
    ];
    for (const o of outputs) {
      const bad = JSON.stringify(o, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? "BAD" : v));
      expect(bad).not.toContain("BAD");
      expect(JSON.stringify(o)).not.toContain("null,\"NaN");
    }
  });
});
