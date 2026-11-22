import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { classify, createClassifyState, notePointerMove } from "../src/classify.js";
import type { EntryPlan, Segment } from "../src/plan-entry.js";
import type { RawEvent } from "../src/types.js";
import { ctxFor, hold, layout, mkPlan, move, quiet, shaky } from "./classify-fixtures.js";

const ACTIVITIES = ["waiting", "moving", "reading pause", "holding on the aim point"];
const CAUSES = [
  "repeat",
  "waiting",
  "reading-pause",
  "tremor-at-edge",
  "early-on-intended-target",
  "pass-over",
  "other",
];

const poseArb = fc.record({
  yaw: fc.double({ min: -20, max: 20, noNaN: true }),
  pitch: fc.double({ min: -20, max: 20, noNaN: true }),
});
const phaseArb = fc.constantFrom("waiting", "moving", "reading-pause", "holding");
const ids = [...layout.targets.map((t) => t.id)];
const planArb = fc
  .record({
    tEntry: fc.integer({ min: 0, max: 2000 }),
    steps: fc.array(fc.record({ phase: phaseArb, len: fc.integer({ min: 1, max: 800 }), a: poseArb, b: poseArb }), {
      minLength: 1,
      maxLength: 6,
    }),
    target: fc.constantFrom("goal", "mid", "rep", "cancel"),
    pauses: fc.array(
      fc.record({ targetId: fc.constantFrom(...ids), t0: fc.integer({ min: 0, max: 4000 }), len: fc.integer({ min: 0, max: 1000 }) }),
      { maxLength: 3 },
    ),
  })
  .map(({ tEntry, steps, target, pauses }): EntryPlan => {
    let t = tEntry;
    const segments: Segment[] = steps.map((s) => {
      const seg: Segment =
        s.phase === "moving"
          ? move(t, t + s.len, s.a, s.b)
          : hold(t, t + s.len, s.a, s.phase);
      t += s.len;
      return seg;
    });
    const role = target === "cancel" ? "cancel" : "default";
    return mkPlan(segments, {
      targetId: target,
      role,
      pauses: pauses.map((p) => ({ targetId: p.targetId, t0: p.t0, t1: p.t0 + p.len })),
    });
  });
const eventArb: fc.Arbitrary<RawEvent> = fc.oneof(
  fc.record({ kind: fc.constantFrom("select" as const, "cancel" as const), targetId: fc.constantFrom(...ids), now: fc.integer({ min: 0, max: 6000 }) }),
  fc.record({ kind: fc.constantFrom("select" as const, "cancel" as const), now: fc.integer({ min: 0, max: 6000 }) }),
);
const pointerArb = fc.option(
  fc.record({ x: fc.integer({ min: 0, max: 1000 }), y: fc.integer({ min: 0, max: 1000 }) }),
  { nil: null },
);

describe("classify properties", () => {
  it("every event is exactly one of start-of-session, intended or accidental, with the right labels", () => {
    // **Validates: Requirements 4.9, 4.10, 4.11**
    fc.assert(
      fc.property(
        planArb,
        fc.array(eventArb, { minLength: 1, maxLength: 6 }),
        fc.integer({ min: 0, max: 2500 }),
        fc.boolean(),
        fc.boolean(),
        pointerArb,
        (plan, events, tEnd, withSegments, tremor, pointer) => {
          const start = {
            tEnd,
            segments: withSegments && tEnd > 0 ? [hold(0, tEnd, { yaw: 0, pitch: 0 }, "waiting")] : [],
          };
          const ctx = ctxFor(tremor ? shaky : quiet, start);
          const state = createClassifyState();
          if (pointer !== null) notePointerMove(state, pointer.x, pointer.y);
          for (const e of events) {
            const c = classify(ctx, e, plan, state);
            expect(["start-of-session", "intended", "accidental"]).toContain(c.category);
            expect(c.category === "start-of-session").toBe(e.now < tEnd);
            expect(ACTIVITIES).toContain(c.activity);
            if (c.category === "start-of-session") {
              expect(c).toEqual({ category: "start-of-session", activity: "waiting", cause: "start" });
            } else if (c.category === "intended") {
              expect(Object.keys(c).sort()).toEqual(["activity", "category"]);
            } else {
              expect(CAUSES.filter((x) => x === c.cause)).toHaveLength(1);
              if (e.targetId === undefined) {
                expect(c.cause).not.toBe("repeat");
                expect(c.cause).not.toBe("tremor-at-edge");
              }
            }
            if (e.targetId === undefined && c.category === "intended") {
              // only a matching cancel-role or select event can be intended, and both carry an id
              throw new Error("unattributed event classified as intended");
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
