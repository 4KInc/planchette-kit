import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { expandTask } from "../src/task.js";
import { runTrial, type TrialConfig } from "../src/run-trial.js";
import { layoutArb, profileArb, resolvedUserArb, taskArb } from "./arbitraries.js";

/**
 * Feature: dwell-sim-mcp, Property 8: each task entry resolves once.
 *
 * Requests mix reachable and unreachable targets (a narrow head range against calibration ranges
 * up to 90 degrees puts far targets out of reach) with a short analysis window of 2 to 10 s, so
 * misses are common.
 */
const configArb: fc.Arbitrary<TrialConfig> = layoutArb({ cancelTarget: "optional" }).chain((layout) =>
  fc
    .record({
      user: resolvedUserArb({ ranges: { headRangeDeg: { min: 3, max: 25 } } }),
      profile: profileArb({ calibrationRanges: true }),
      spec: taskArb(layout),
      fps: fc.constantFrom<15 | 30 | 60>(15, 30, 60),
      analysisWindowMs: fc.integer({ min: 2000, max: 10000 }),
      requestSeed: fc.integer({ min: 0, max: 0xffffffff }),
      trialIndex: fc.integer({ min: 0, max: 20 }),
    })
    .map(({ spec, ...rest }): TrialConfig => {
      const t = expandTask(layout, spec, rest.requestSeed);
      if (!t.ok) throw new Error(`arbitrary produced an invalid task: ${t.error.code} at index ${t.error.index} (${t.error.targetId})`);
      return { layout, mode: "head + dwell", task: t.ids, ...rest };
    }),
);

describe("Property 8: each task entry resolves once", () => {
  it("intended + misses = task length, and entry indices are exactly 0..n-1 without duplicates", () => {
    // **Validates: Requirements 4.12, 11.11**
    const tally = { runs: 0, withMiss: 0, withUnreachable: 0 };
    fc.assert(
      fc.property(configArb, (cfg) => {
        const r = runTrial(cfg);
        tally.runs++;
        if (r.entries.some((e) => e.outcome === "miss")) tally.withMiss++;
        if (r.entries.some((e) => e.missCause === "unreachable")) tally.withUnreachable++;
        const n = cfg.task.length;
        const intended = r.entries.filter((e) => e.outcome === "selected").length;
        const misses = r.entries.filter((e) => e.outcome === "miss").length;
        expect(intended + misses).toBe(n);
        const indices = r.entries.map((e) => e.entry);
        expect(new Set(indices).size).toBe(indices.length);
        expect([...indices].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
      }),
      { numRuns: 200 },
    );
    const pct = (k: number) => ((100 * k) / tally.runs).toFixed(1);
    console.log(
      `Property 8 tally: runs=${tally.runs}, with >=1 miss=${tally.withMiss} (${pct(tally.withMiss)}%), ` +
        `with >=1 unreachable=${tally.withUnreachable} (${pct(tally.withUnreachable)}%)`,
    );
    expect(tally.runs).toBe(200);
    expect(tally.withMiss / tally.runs).toBeGreaterThanOrEqual(0.1);
  });
});
