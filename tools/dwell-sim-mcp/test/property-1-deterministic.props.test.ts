import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { simulate } from "../src/simulate.js";
import type { SimulateRequest } from "../src/types.js";
import { layoutArb, resolvedUserArb, taskArb } from "./arbitraries.js";

/**
 * Feature: dwell-sim-mcp, Property 1: Deterministic.
 *
 * A full request (layout, 1 to 3 distinct users, task, fps, window, seed, 1 to 3 trials) with the
 * defaults already applied (`simulate` applies none), mode "head + dwell":
 * - two runs give `toEqual` results;
 * - the JSON holds no Date, no ISO timestamp string, no wall-clock field name, no NaN or Infinity;
 * - with the users in reverse order, each user's result (matched by name: its metrics, its
 *   accidental selections and its effectiveProfile) is unchanged.
 *
 * Layouts, tasks and windows are small so 200 runs stay fast. No clock and no Math.random.
 *
 * **Property 1: Deterministic**
 * **Validates: Requirements 4.4, 7.1, 7.2, 7.4**
 */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
/** Field names that would carry wall-clock time. `timeMs` and `timeToSelectMs` are simulated time and allowed. */
const WALL_CLOCK_KEY = /^(date|datetime|timestamp|createdAt|created|updatedAt|generatedAt|timeOfDay|wallClock\w*|elapsedWall\w*|now)$/i;

function walk(value: unknown, path: string, problems: string[]): void {
  if (value instanceof Date) {
    problems.push(`${path}: Date instance`);
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) problems.push(`${path}: ${String(value)}`);
  } else if (typeof value === "string") {
    if (ISO_TIMESTAMP.test(value)) problems.push(`${path}: ISO timestamp "${value}"`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`, problems));
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (WALL_CLOCK_KEY.test(k)) problems.push(`${path}.${k}: wall-clock field name`);
      walk(v, `${path}.${k}`, problems);
    }
  }
}

const requestArb: fc.Arbitrary<SimulateRequest> = layoutArb({
  minTargets: 1,
  maxTargets: 3,
  minScreen: { width: 640, height: 480 },
  maxScreen: { width: 1024, height: 768 },
}).chain((layout) =>
  fc
    .record({
      users: fc.uniqueArray(resolvedUserArb(), { minLength: 1, maxLength: 3, selector: (u) => u.name }),
      task: taskArb(layout, { maxLength: 3, maxEach: 1 }),
      fps: fc.constantFrom(15, 30, 60) as fc.Arbitrary<15 | 30 | 60>,
      analysisWindowS: fc.integer({ min: 2, max: 6 }),
      seed: fc.integer({ min: 0, max: 0xffffffff }),
      trialsPerUser: fc.integer({ min: 1, max: 3 }),
    })
    .map((r): SimulateRequest => ({ layout, profile: {}, mode: "head + dwell", ...r })),
);

describe("Property 1: Deterministic", () => {
  it("same request, same result; no wall-clock or non-finite values; user order does not matter", () => {
    fc.assert(
      fc.property(requestArb, (request) => {
        const a = simulate(request);
        const b = simulate(request);
        expect(b).toEqual(a);

        const json = JSON.parse(JSON.stringify(a)) as unknown;
        const problems: string[] = [];
        walk(a, "result", problems);
        walk(json, "json", problems);
        expect(problems).toEqual([]);

        const reversed = simulate({ ...request, users: [...request.users].reverse() });
        for (const user of a.users) {
          const other = reversed.users.find((u) => u.name === user.name);
          expect(other).toEqual(user);
          const mine = a.parameters.users.find((u) => u.name === user.name);
          const theirs = reversed.parameters.users.find((u) => u.name === user.name);
          expect(theirs).toEqual(mine);
          expect(reversed.accidentalSelections.filter((s) => s.user === user.name)).toEqual(
            a.accidentalSelections.filter((s) => s.user === user.name),
          );
        }
      }),
      { numRuns: 200 },
    );
    // 15 s, not the 5 s default: alone this takes about 1.4 s, but a seed sweep runs it beside the whole suite and it timed out under CPU load.
  }, 15_000);
});
