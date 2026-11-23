import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { suggest } from "../src/suggest.js";
import { layoutOf, repeat, target, trial, user, type TrialSpec } from "./suggest-fixtures.js";

const layout = layoutOf(target("t1", 400, 300));
const NAMES = ["u0", "u1", "u2", "u3"] as const;

const countsArb: fc.Arbitrary<Counts> = fc.record({
  reading: fc.integer({ min: 0, max: 8 }),
  pass: fc.integer({ min: 0, max: 8 }),
  edgeAcc: fc.integer({ min: 0, max: 8 }),
  edgeMiss: fc.integer({ min: 0, max: 8 }),
  otherMiss: fc.integer({ min: 0, max: 8 }),
});
const perUserArb = fc.array(countsArb, { minLength: 1, maxLength: 4 });
interface Counts {
  reading: number;
  pass: number;
  edgeAcc: number;
  edgeMiss: number;
  otherMiss: number;
}

function spec(c: Counts, starts = 0): TrialSpec {
  return {
    accidental: [
      ...repeat(c.reading, { target: "t1", cause: "reading-pause" as const }),
      ...repeat(c.pass, { target: "t1", cause: "pass-over" as const }),
      ...repeat(c.edgeAcc, { target: "t1", cause: "tremor-at-edge" as const }),
    ],
    misses: [
      ...repeat(c.edgeMiss, { target: "t1", cause: "tremor-at-edge" as const }),
      ...repeat(c.otherMiss, { target: "t1", cause: "other" as const }),
    ],
    starts: repeat(starts, "t1"),
  };
}

function build(list: Counts[], starts = 0) {
  return list.map((c, i) => user(NAMES[i], [trial(NAMES[i], spec(c, starts))]));
}

const sum = (list: Counts[], f: (c: Counts) => number): number => list.reduce((a, c) => a + f(c), 0);

describe("suggest properties", () => {
  it("event suggestions appear exactly when the share is above 50 % and there are at least 3 events", () => {
    // **Validates: Requirements 6.1, 6.2, 6.7**
    fc.assert(
      fc.property(perUserArb, (list) => {
        const out = suggest({ mode: "head + dwell", users: build(list), task: ["t1"], layout });
        const reading = sum(list, (c) => c.reading);
        const accidental = sum(list, (c) => c.reading + c.pass + c.edgeAcc);
        const edge = sum(list, (c) => c.edgeAcc + c.edgeMiss);
        const events = accidental + sum(list, (c) => c.edgeMiss + c.otherMiss);
        const hasReading = out.some((s) => s.metric === "reading-pause share");
        const hasEdge = out.some((s) => s.metric === "tremor-at-edge share");
        expect(hasReading).toBe(events >= 3 && accidental > 0 && 2 * reading > accidental);
        expect(hasEdge).toBe(events >= 3 && 2 * edge > events);
        for (const s of out) {
          if (s.metric === "reading-pause share") expect(s.value).toBe(Math.round((reading / accidental) * 100) / 100);
          if (s.metric === "tremor-at-edge share") expect(s.value).toBe(Math.round((edge / events) * 100) / 100);
        }
      }),
    );
  });

  it("users are those with an event of the cause, in request order", () => {
    // **Validates: Requirements 6.2, 6.6**
    fc.assert(
      fc.property(perUserArb, (list) => {
        const out = suggest({ mode: "head + dwell", users: build(list), task: ["t1"], layout });
        const readingUsers = list.flatMap((c, i) => (c.reading > 0 ? [NAMES[i]] : []));
        const edgeUsers = list.flatMap((c, i) => (c.edgeAcc + c.edgeMiss > 0 ? [NAMES[i]] : []));
        for (const s of out) {
          if (s.metric === "reading-pause share") expect(s.users).toEqual(readingUsers);
          if (s.metric === "tremor-at-edge share") expect(s.users).toEqual(edgeUsers);
        }
      }),
    );
  });

  it("start-of-session events never change the output", () => {
    // **Validates: Requirements 6.7**
    fc.assert(
      fc.property(perUserArb, fc.integer({ min: 1, max: 6 }), (list, starts) => {
        const base = suggest({ mode: "head + dwell", users: build(list), task: ["t1"], layout });
        const withStarts = suggest({ mode: "head + dwell", users: build(list, starts), task: ["t1"], layout });
        expect(withStarts).toEqual(base);
      }),
    );
  });

  it("scan mode gives no event-based suggestion", () => {
    // **Validates: Requirements 6.1, 6.2**
    fc.assert(
      fc.property(perUserArb, (list) => {
        const out = suggest({ mode: "scan", users: build(list), task: ["t1"], layout });
        expect(out).toEqual([]);
      }),
    );
  });

  it("output is ordered by target id then rule order, and is deterministic", () => {
    // **Validates: Requirements 6.3, 6.4**
    const ids = ["a", "B", "b", "Z", "é"];
    const idsArb = fc.shuffledSubarray(ids, { minLength: 1 });
    fc.assert(
      fc.property(idsArb, (order) => {
        const targets = order.map((id, i) => target(id, 0, i * 60));
        const lay = layoutOf(...targets);
        const accidental = order.flatMap((id) => [
          ...repeat(4, { target: id, cause: "reading-pause" as const }),
          ...repeat(1, { target: id, cause: "tremor-at-edge" as const }),
        ]);
        const misses = order.flatMap((id) => repeat(8, { target: id, cause: "tremor-at-edge" as const }));
        const input = {
          mode: "head + dwell" as const,
          users: [user("u", [trial("u", { accidental, misses })], { ...user("x", []).geometry, headRange: { left: 1, right: 1, up: 1, down: 1 } })],
          task: [order[0]],
          layout: lay,
        };
        const out = suggest(input);
        expect(suggest(input)).toEqual(out);
        const rank = (m: string) => ["reading-pause share", "tremor-at-edge share", "unreachable"].indexOf(m);
        for (let k = 1; k < out.length; k++) {
          const a = out[k - 1];
          const b = out[k];
          expect(a.targetId <= b.targetId).toBe(true);
          if (a.targetId === b.targetId) expect(rank(a.metric)).toBeLessThan(rank(b.metric));
        }
        // every target is outside the 1 degree head range (x 450..550) in this fixture: one unreachable each
        expect(out.filter((s) => s.metric === "unreachable")).toHaveLength(order.length);
      }),
    );
  });
});
