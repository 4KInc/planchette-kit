import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  openTrial,
  runEntries,
  runStartOfSession,
  runTrial,
  runWarmup,
  type TrialConfig,
  type TrialResult,
} from "../src/run-trial.js";
import { expandTask } from "../src/task.js";
import type { AccidentalCause, Activity, Layout, RawEvent } from "../src/types.js";
import { layoutArb, profileArb, resolvedUserArb, taskArb } from "./arbitraries.js";

const LABELS: readonly Activity[] = ["waiting", "moving", "reading pause", "holding on the aim point"];
const CAUSES: readonly AccidentalCause[] = [
  "reading-pause",
  "pass-over",
  "tremor-at-edge",
  "repeat",
  "waiting",
  "early-on-intended-target",
  "other",
];

/**
 * The metrics layer (Task 9) is not built yet, so the numbers it will report are derived here
 * from the TrialResult fields: intended = entries with outcome 'selected', accidental =
 * accidental.length, startOfSession.count = startEvents.length, byTarget = startEvents grouped
 * by targetId (null for a cancel without a target).
 */
function metricsOf(r: TrialResult) {
  const intended = r.entries.filter((e) => e.outcome === "selected").length;
  const accidental = r.accidental.length;
  const byTarget = new Map<string | null, number>();
  for (const s of r.startEvents) byTarget.set(s.targetId, (byTarget.get(s.targetId) ?? 0) + 1);
  const accidentalPer100Intended = intended === 0 ? null : (accidental / intended) * 100;
  return { intended, accidental, startCount: r.startEvents.length, byTarget, accidentalPer100Intended };
}

interface Case {
  cfg: TrialConfig;
}

const caseArb: fc.Arbitrary<Case> = fc
  .oneof(
    // With a rest area and a selectable target between the centre and the rest area.
    layoutArb({ restArea: true, selectableBetweenCentreAndRest: true, maxTargets: 4 }),
    layoutArb({ restArea: true, maxTargets: 4 }),
    layoutArb({ restArea: false, maxTargets: 4 }),
    layoutArb({ restArea: true, selectableBetweenCentreAndRest: true, centreClear: false, maxTargets: 3 }),
  )
  .chain((layout: Layout) =>
    fc.record({
      layout: fc.constant(layout),
      task: taskArb(layout, { maxLength: 4, maxEach: 1 }),
      user: resolvedUserArb(),
      profile: profileArb(),
      fps: fc.constantFrom(15 as const, 30 as const, 60 as const),
      analysisWindowMs: fc.integer({ min: 4000, max: 10000 }),
      requestSeed: fc.integer({ min: -100000, max: 100000 }),
      trialIndex: fc.integer({ min: 0, max: 5 }),
    }),
  )
  .map(({ layout, task, user, profile, fps, analysisWindowMs, requestSeed, trialIndex }) => {
    const expanded = expandTask(layout, task, requestSeed);
    if (!expanded.ok) throw new Error("taskArb produced an invalid task");
    return {
      cfg: {
        layout,
        profile,
        user,
        mode: "head + dwell",
        task: expanded.ids,
        fps,
        analysisWindowMs,
        requestSeed,
        trialIndex,
      } satisfies TrialConfig,
    };
  });

describe("Feature: dwell-sim-mcp, Property 4: Every event is accounted for", () => {
  it("intended + accidental + start-of-session = events counted by an independent listener", () => {
    // **Validates: Requirements 4.3, 4.9, 4.10, 4.11, 4.25**
    fc.assert(
      fc.property(caseArb, ({ cfg }) => {
        // Run 1: `runTrial` with a second, independent listener through `observers.onEvent`.
        const counted: RawEvent[] = [];
        const result = runTrial({ ...cfg, observers: { onEvent: (e) => counted.push({ ...e }) } });
        const m = metricsOf(result);

        // The three categories add up to the events the second listener counted.
        expect(m.intended + m.accidental + m.startCount).toBe(counted.length);

        // The list length equals the count; every record has a valid label and cause.
        expect(result.accidental).toHaveLength(m.accidental);
        for (const a of result.accidental) {
          expect(LABELS).toContain(a.activity);
          expect(CAUSES).toContain(a.cause);
        }

        // byTarget sums to the count.
        let sum = 0;
        for (const n of m.byTarget.values()) sum += n;
        expect(sum).toBe(m.startCount);

        // accidentalPer100Intended = accidental / intended x 100, null when intended = 0.
        if (m.intended === 0) expect(m.accidentalPer100Intended).toBeNull();
        else expect(m.accidentalPer100Intended).toBe((m.accidental / m.intended) * 100);

        // Run 2: the same trial through the driver's parts (identical code to `runTrial`), to read
        // the start plan's `tEnd`, which `TrialResult` does not carry.
        const seen: RawEvent[] = [];
        const d = openTrial({ ...cfg, observers: { onEvent: (e) => seen.push({ ...e }) } });
        let tEnd: number;
        let tDone: number;
        let r2: TrialResult;
        try {
          runWarmup(d);
          tDone = d.tDone;
          const s = runStartOfSession(d);
          tEnd = s.tEntry;
          runEntries(d, s);
          r2 = {
            userName: cfg.user.name,
            trialIndex: cfg.trialIndex,
            entries: d.entries,
            accidental: d.accidental,
            startEvents: d.startEvents,
            warnings: d.warnings,
            effectiveProfile: d.eff,
          };
        } finally {
          d.pl.destroy();
        }
        // Deterministic: both runs see the same events and give the same result.
        expect(seen).toEqual(counted);
        expect(r2.entries).toEqual(result.entries);
        expect(r2.accidental).toEqual(result.accidental);
        expect(r2.startEvents).toEqual(result.startEvents);

        // Every event before the end of the start of session (warm-up events included) is a
        // start-of-session event and is in no accidental record.
        const early = seen.filter((e) => e.now < tEnd || e.now <= tDone);
        expect(r2.startEvents).toHaveLength(early.length);
        early.forEach((e, i) => {
          expect(r2.startEvents[i]).toEqual({ targetId: e.targetId ?? null, timeMs: e.now });
        });
        for (const a of r2.accidental) {
          expect(a.timeMs >= tEnd && a.timeMs > tDone).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});
