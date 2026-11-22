import fc from "fast-check";
import { createPlanchette } from "@planchette/skeleton";
import { describe, expect, it } from "vitest";
import {
  aggregateUser,
  percentile,
  type AccidentalRecord,
  type StartEventRecord,
  type TargetMetrics,
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

const IDS = ["a", "b", "c", "rest", "Z"] as const;
const layout: Layout = {
  screen: { width: 800, height: 600 },
  targets: [
    { id: "c", rect: { x: 0, y: 0, width: 50, height: 50 }, autoRepeat: false, role: "default" },
    { id: "a", rect: { x: 100, y: 0, width: 50, height: 50 }, autoRepeat: false, role: "default" },
    { id: "b", rect: { x: 200, y: 0, width: 50, height: 50 }, autoRepeat: false, role: "cancel" },
    { id: "rest", rect: { x: 300, y: 0, width: 50, height: 50 }, autoRepeat: false, role: "rest-area" },
  ],
};

const idArb = fc.constantFrom<string>(...IDS);
const nullableIdArb = fc.option(idArb, { nil: null });

const entryArb: fc.Arbitrary<TrialEntryResult> = fc.oneof(
  fc.record({
    entry: fc.nat(50),
    targetId: idArb,
    outcome: fc.constant("selected" as const),
    timeToSelectMs: fc.integer({ min: 0, max: 30000 }),
    missCause: fc.constant(null),
  }),
  fc.record({
    entry: fc.nat(50),
    targetId: idArb,
    outcome: fc.constant("miss" as const),
    timeToSelectMs: fc.constant(null),
    missCause: fc.constantFrom("unreachable" as const, "tremor-at-edge" as const, "other" as const),
  }),
);

const accidentalArb: fc.Arbitrary<AccidentalRecord> = fc.record({
  targetId: nullableIdArb,
  timeMs: fc.integer({ min: 0, max: 60000 }),
  activity: fc.constantFrom(...ACTIVITY_LABELS),
  cause: fc.constantFrom(...CAUSES),
  entry: fc.nat(50),
});

const startArb: fc.Arbitrary<StartEventRecord> = fc.record({
  targetId: nullableIdArb,
  timeMs: fc.integer({ min: 0, max: 5000 }),
});

const trialArb: fc.Arbitrary<TrialResult> = fc.record({
  userName: fc.constant("u"),
  trialIndex: fc.nat(20),
  entries: fc.array(entryArb, { maxLength: 12 }),
  accidental: fc.array(accidentalArb, { maxLength: 8 }),
  startEvents: fc.array(startArb, { maxLength: 4 }),
  warnings: fc.constant<string[]>([]),
  effectiveProfile: fc.constant(PROFILE),
});

const trialsArb = fc.array(trialArb, { maxLength: 5 });

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

function everyNumberFinite(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(everyNumberFinite);
  if (v !== null && typeof v === "object") return Object.values(v).every(everyNumberFinite);
  return true;
}

describe("aggregateUser properties", () => {
  it("per-target counts sum to the per-user counts", () => {
    fc.assert(
      fc.property(trialsArb, (trials) => {
        const m = aggregateUser("u", trials, layout);
        const rows = m.perTarget;
        expect(sum(rows.map((r) => r.intended))).toBe(m.intended);
        expect(sum(rows.map((r) => r.misses))).toBe(m.misses);
        expect(sum(rows.map((r) => r.accidental))).toBe(m.accidental);
        expect(sum(rows.map((r) => r.startCount))).toBe(m.startCount);
        for (const c of CAUSES) expect(sum(rows.map((r) => r.causes[c]))).toBe(m.causes[c]);
        for (const a of ACTIVITY_LABELS) expect(sum(rows.map((r) => r.activities[a]))).toBe(m.activities[a]);
        expect(sum(Object.values(m.causes))).toBe(m.accidental);
        expect(sum(Object.values(m.activities))).toBe(m.accidental);
      }),
      { numRuns: 200 },
    );
  });

  it("user counts equal the counts in the trial results; start events are not accidental", () => {
    fc.assert(
      fc.property(trialsArb, (trials) => {
        const m = aggregateUser("u", trials, layout);
        expect(m.trials).toBe(trials.length);
        expect(m.intended).toBe(sum(trials.map((t) => t.entries.filter((e) => e.outcome === "selected").length)));
        expect(m.misses).toBe(sum(trials.map((t) => t.entries.filter((e) => e.outcome === "miss").length)));
        expect(m.accidental).toBe(sum(trials.map((t) => t.accidental.length)));
        expect(m.startCount).toBe(sum(trials.map((t) => t.startEvents.length)));
        expect(m.accidentalPer100Intended).toBe(m.intended === 0 ? null : (m.accidental / m.intended) * 100);
      }),
      { numRuns: 200 },
    );
  });

  it("startOfSession.byTarget sums to count, equals startCount and matches the rows", () => {
    fc.assert(
      fc.property(trialsArb, (trials) => {
        const m = aggregateUser("u", trials, layout);
        const s = m.startOfSession;
        expect(sum(s.byTarget.map((b) => b.count))).toBe(s.count);
        expect(s.count).toBe(m.startCount);
        expect(s.byTarget.every((b) => b.count > 0)).toBe(true);
        for (const b of s.byTarget) {
          expect(m.perTarget.find((r) => r.targetId === b.targetId)?.startCount).toBe(b.count);
        }
        const ids = s.byTarget.map((b) => b.targetId);
        const expected = [...ids].sort((x, y) => (x === y ? 0 : x === null ? 1 : y === null ? -1 : x < y ? -1 : 1));
        expect(ids).toEqual(expected);
      }),
      { numRuns: 200 },
    );
  });

  it("perTarget order and membership follow the rules", () => {
    fc.assert(
      fc.property(trialsArb, (trials) => {
        const m = aggregateUser("u", trials, layout);
        const ids = m.perTarget.map((r) => r.targetId);
        expect(new Set(ids).size).toBe(ids.length);
        const nullAt = ids.indexOf(null);
        if (nullAt >= 0) expect(nullAt).toBe(ids.length - 1);
        const named = ids.filter((i): i is string => i !== null);
        expect(named).toEqual([...named].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
        for (const id of ["a", "b", "c"]) expect(ids).toContain(id);
        const hasEvents = (r: TargetMetrics) => r.intended + r.misses + r.accidental + r.startCount > 0;
        for (const r of m.perTarget) {
          if (r.targetId === null || r.targetId === "rest" || r.targetId === "Z") expect(hasEvents(r)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("causes and activities have all keys on users and targets; nothing is NaN or Infinity", () => {
    fc.assert(
      fc.property(trialsArb, (trials) => {
        const m = aggregateUser("u", trials, layout);
        for (const x of [m, ...m.perTarget]) {
          expect(Object.keys(x.causes).sort()).toEqual([...CAUSES].sort());
          expect(Object.keys(x.activities).sort()).toEqual([...ACTIVITY_LABELS].sort());
        }
        expect(everyNumberFinite(m)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("is invariant to trial order", () => {
    fc.assert(
      fc.property(trialsArb, (trials) => {
        expect(aggregateUser("u", [...trials].reverse(), layout)).toEqual(aggregateUser("u", trials, layout));
      }),
      { numRuns: 100 },
    );
  });
});

describe("percentile properties", () => {
  it("returns the nearest-rank element of the sorted samples", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -1000, max: 1000 }), { minLength: 1, maxLength: 60 }),
        fc.constantFrom(0.5, 0.9),
        (xs, p) => {
          const sorted = [...xs].sort((a, b) => a - b);
          const n = xs.length;
          // exact integer form of ceil(p * n)
          const rank = p === 0.5 ? Math.ceil(n / 2) : Math.ceil((9 * n) / 10);
          expect(percentile(xs, p)).toBe(sorted[rank - 1]);
          expect(xs).toContain(percentile(xs, p));
        },
      ),
      { numRuns: 200 },
    );
  });
});
