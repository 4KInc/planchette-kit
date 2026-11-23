import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SimulateInputSchema, type SimulateToolInput } from "../src/tool-schemas.js";
import { validateSimulateRequest } from "../src/validate-request.js";

const layout = {
  screen: { width: 800, height: 600 },
  targets: [
    { id: "a", rect: { x: 0, y: 0, width: 50, height: 50 } },
    { id: "b", rect: { x: 100, y: 0, width: 50, height: 50 } },
  ],
};

function sim(over: Record<string, unknown> = {}): SimulateToolInput {
  const parsed = SimulateInputSchema.parse({ layout, users: ["steady"], task: ["a", "b"] });
  return { ...parsed, ...over } as SimulateToolInput;
}

const NUM_RUNS = 100;

describe("validate-request properties", () => {
  it("trialsPerUser: integers follow the count rule, with the real range", () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 200 }), (n) => {
        const r = validateSimulateRequest(sim({ trialsPerUser: n }));
        if (n >= 1 && n <= 50) return r.ok && r.request.trialsPerUser === n;
        if (r.ok) return false;
        const expectedCode = n < 1 ? "OUT_OF_RANGE" : "CAP_EXCEEDED";
        return (
          r.error.code === expectedCode &&
          r.error.parameter === "trialsPerUser" &&
          JSON.stringify(r.error.allowed) === JSON.stringify({ min: 1, max: 50 })
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("users: any count follows the count rule; names stay in request order", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20 }), (n) => {
        const users = Array.from({ length: n }, (_, i) => ({ name: `u${i}`, overrides: {} }));
        const r = validateSimulateRequest(sim({ users }));
        if (n >= 1 && n <= 12) return r.ok && r.request.users.map((u) => u.name).join() === users.map((u) => u.name).join();
        return !r.ok && r.error.parameter === "users" && r.error.code === (n < 1 ? "OUT_OF_RANGE" : "CAP_EXCEEDED");
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("fps: only 15, 30, 60 are accepted; the rest give NOT_ALLOWED_VALUE with the three values", () => {
    fc.assert(
      fc.property(fc.oneof(fc.integer({ min: -5, max: 120 }), fc.double({ noNaN: true })), (fps) => {
        const r = validateSimulateRequest(sim({ fps }));
        if (fps === 15 || fps === 30 || fps === 60) return r.ok && r.request.fps === fps;
        return (
          !r.ok &&
          r.error.code === "NOT_ALLOWED_VALUE" &&
          r.error.parameter === "fps" &&
          JSON.stringify(r.error.allowed) === JSON.stringify(["15", "30", "60"])
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("analysisWindowS: accepted exactly on 2..120", () => {
    fc.assert(
      fc.property(fc.double({ min: -10, max: 200, noNaN: true }), (w) => {
        const r = validateSimulateRequest(sim({ analysisWindowS: w }));
        const inside = w >= 2 && w <= 120;
        if (inside) return r.ok;
        return !r.ok && r.error.code === "OUT_OF_RANGE" && r.error.parameter === "analysisWindowS";
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("seed: integers are accepted exactly on the int32 range; non-integers are NOT_ALLOWED_VALUE", () => {
    fc.assert(
      fc.property(fc.oneof(fc.integer({ min: -3_000_000_000, max: 3_000_000_000 }), fc.double({ noNaN: true, min: -10, max: 10 })), (seed) => {
        const r = validateSimulateRequest(sim({ seed }));
        if (!Number.isInteger(seed)) return !r.ok && r.error.code === "NOT_ALLOWED_VALUE" && r.error.allowed === undefined;
        if (seed >= -2147483648 && seed <= 2147483647) return r.ok && r.request.seed === seed;
        return !r.ok && r.error.code === "OUT_OF_RANGE" && r.error.parameter === "seed";
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("tremorFrequencyHz: 0 and [1, 15] are accepted; (0, 1) and above 15 are OUT_OF_RANGE with allowed 1..15", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(0),
          fc.double({ min: 1, max: 15, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true, minExcluded: true, maxExcluded: true }),
          fc.double({ min: 15, max: 100, noNaN: true, minExcluded: true }),
        ),
        (hz) => {
          const r = validateSimulateRequest(sim({ users: [{ name: "c", overrides: { tremorFrequencyHz: hz } }] }));
          if (hz === 0 || (hz >= 1 && hz <= 15)) return r.ok;
          return (
            !r.ok &&
            r.error.code === "OUT_OF_RANGE" &&
            r.error.parameter === "users[0].overrides.tremorFrequencyHz" &&
            JSON.stringify(r.error.allowed) === JSON.stringify({ min: 1, max: 15 }) &&
            r.error.message.includes("0 means off")
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
  it("an earlier-stage error hides every later-stage error", () => {
    const laterBad = { trialsPerUser: 0, fps: 24, analysisWindowS: 1, seed: 1.5, task: [] };
    fc.assert(
      fc.property(fc.constantFrom("mode", "users", "layout"), (stage) => {
        const early: Record<string, Record<string, unknown>> = {
          mode: { mode: "mouse" },
          users: { users: ["nope"] },
          layout: { layout: { screen: { width: 800, height: 600 }, targets: [] } },
        };
        const r = validateSimulateRequest(sim({ ...laterBad, ...early[stage] }));
        if (r.ok) return false;
        const expected = { mode: "mode", users: "users[0]", layout: "layout.targets" }[stage];
        return r.error.parameter === expected;
      }),
      { numRuns: 20 },
    );
  });

  it("is pure: same input gives equal results and the input is not mutated", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -2, max: 60 }),
        fc.constantFrom(10, 15, 24, 30, 60),
        fc.constantFrom("head + dwell", "scan", "mouse"),
        (trialsPerUser, fps, mode) => {
          const input = sim({ trialsPerUser, fps, mode });
          const before = JSON.stringify(input);
          const r1 = validateSimulateRequest(input);
          const r2 = validateSimulateRequest(input);
          expect(JSON.stringify(input)).toBe(before);
          expect(r2).toEqual(r1);
          return true;
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it("explicit task: count rule and unknown ids report the first bad index", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom("a", "b", "zz"), { minLength: 1, maxLength: 8 }), (ids) => {
        const task = ids.flatMap((id, i) => (i > 0 && ids[i - 1] === id ? [id === "a" ? "b" : "a", id] : [id]));
        const r = validateSimulateRequest(sim({ task }));
        const firstUnknown = task.indexOf("zz");
        if (firstUnknown >= 0) return !r.ok && r.error.code === "UNKNOWN_TARGET" && r.error.parameter === `task[${firstUnknown}]`;
        return r.ok;
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
