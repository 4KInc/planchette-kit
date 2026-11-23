import { describe, expect, it } from "vitest";
import { DISCLAIMER } from "../src/disclaimer.js";
import { round1 } from "../src/metrics.js";
import { resolveUser } from "../src/resolve-user.js";
import { runUser } from "../src/run-user.js";
import { SimulateError, simulate } from "../src/simulate.js";
import { expandTask } from "../src/task.js";
import type { Layout, LayoutTarget, ResolvedUser, SimulateRequest } from "../src/types.js";

const target = (id: string, x: number, y: number, role: LayoutTarget["role"] = "default"): LayoutTarget => ({
  id,
  rect: { x, y, width: 160, height: 120 },
  autoRepeat: false,
  role,
});

const user = (input: Parameters<typeof resolveUser>[0]): ResolvedUser => {
  const r = resolveUser(input);
  if (!r.ok) throw new Error("user must resolve");
  return r.user;
};

const layout: Layout = {
  screen: { width: 800, height: 600 },
  targets: [target("rest", 620, 460, "rest-area"), target("a", 60, 60), target("b", 560, 60)],
};

const request = (over: Partial<SimulateRequest> = {}): SimulateRequest => ({
  layout,
  profile: { dwellTime: 400 },
  mode: "head + dwell",
  users: [user("steady")],
  task: ["a", "b"],
  trialsPerUser: 2,
  fps: 30,
  analysisWindowS: 5,
  seed: 7,
  ...over,
});

const CAUSES = ["reading-pause", "pass-over", "tremor-at-edge", "repeat", "waiting", "early-on-intended-target", "other"];
const ACTIVITIES = ["waiting", "moving", "reading pause", "holding on the aim point"];
const sorted = (o: object): string[] => Object.keys(o).sort();

describe("simulate result shape (design 11 example)", () => {
  const result = simulate(request({ users: [user("steady"), user("head-tremor")] }));

  it("has exactly the top-level fields of the example", () => {
    expect(sorted(result)).toEqual(
      ["accidentalSelections", "disclaimer", "notes", "parameters", "seed", "suggestions", "users", "warnings"],
    );
  });

  it("has the parameters of the example and no top-level effectiveProfile", () => {
    expect(sorted(result.parameters)).toEqual(
      ["analysisWindowS", "fps", "layout", "mode", "profile", "task", "trialsPerUser", "users"],
    );
    expect(result.parameters.layout).toEqual(layout);
    expect(result.parameters.layout).not.toBe(layout);
    const copy = simulate(request({ trialsPerUser: 1 }));
    copy.parameters.layout.targets[0].id = "changed";
    expect(layout.targets[0].id).toBe("rest");
    expect(result.parameters).not.toHaveProperty("effectiveProfile");
    expect(result.parameters.profile).toEqual({ dwellTime: 400 });
    expect(result.parameters.task).toEqual(["a", "b"]);
    expect(result.parameters.mode).toBe("head + dwell");
    expect(result.parameters.fps).toBe(30);
    expect(result.parameters.analysisWindowS).toBe(5);
    expect(result.parameters.trialsPerUser).toBe(2);
  });

  it("echoes the task spec as given for eachTarget", () => {
    expect(simulate(request({ task: { eachTarget: 1 }, trialsPerUser: 1 })).parameters.task).toEqual({ eachTarget: 1 });
  });

  it("has name, params and effectiveProfile for each user, in request order", () => {
    expect(result.parameters.users.map((u) => u.name)).toEqual(["steady", "head-tremor"]);
    for (const u of result.parameters.users) {
      expect(sorted(u)).toEqual(["effectiveProfile", "name", "params"]);
      expect(u.effectiveProfile.dwellTime).toBe(400);
    }
    expect(result.parameters.users[1].params).toEqual(user("head-tremor").params);
  });

  it("has every user field of the example, with all causes and activities", () => {
    expect(result.users.map((u) => u.name)).toEqual(["steady", "head-tremor"]);
    for (const u of result.users) {
      expect(sorted(u)).toEqual(
        [
          "accidental", "accidentalPer100Intended", "activities", "causes", "intended", "misses", "name",
          "perTarget", "startCount", "startOfSession", "timeToSelectMs", "trials",
        ],
      );
      expect(u.trials).toBe(2);
      expect(sorted(u.startOfSession)).toEqual(["byTarget", "count"]);
      expect(sorted(u.timeToSelectMs)).toEqual(["median", "p90"]);
      expect(sorted(u.causes)).toEqual([...CAUSES].sort());
      expect(sorted(u.activities)).toEqual([...ACTIVITIES].sort());
      expect(u.perTarget.map((r) => r.targetId)).toEqual(["a", "b"]);
      for (const row of u.perTarget) {
        expect(sorted(row)).toEqual(
          [
            "accidental", "accidentalPer100Intended", "activities", "causes", "intended", "misses",
            "startCount", "targetId", "timeToSelectMs",
          ],
        );
        expect(sorted(row.causes)).toEqual([...CAUSES].sort());
        expect(sorted(row.activities)).toEqual([...ACTIVITIES].sort());
      }
    }
  });

  it("has accidentalSelections items with the example's six fields and no start events", () => {
    const r = simulate(request({ users: [user("strong-head-tremor")], trialsPerUser: 3, task: { eachTarget: 3 } }));
    const total = r.users[0].accidental;
    expect(r.accidentalSelections).toHaveLength(total);
    for (const a of r.accidentalSelections) {
      expect(sorted(a)).toEqual(["activity", "cause", "targetId", "timeMs", "trial", "user"]);
      expect(a.user).toBe("strong-head-tremor");
      expect(ACTIVITIES).toContain(a.activity);
      expect(CAUSES).toContain(a.cause);
    }
  });

  it("has warnings, notes and suggestions as arrays, suggestions equal to []", () => {
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.notes)).toBe(true);
    expect(result.suggestions).toEqual([]);
    // The layout has a rest area but no cancel target.
    expect(result.warnings.some((w) => w.startsWith("NO_CANCEL_TARGET:"))).toBe(true);
    expect(result.warnings.some((w) => w.startsWith("NO_REST_AREA:"))).toBe(false);
  });

  it("emits the tremor note for a user above 1 degree", () => {
    const r = simulate(request({ users: [user("strong-head-tremor")], trialsPerUser: 1 }));
    expect(r.notes.some((n) => n.startsWith("TREMOR_ABOVE_TUNED:") && n.includes("strong-head-tremor"))).toBe(true);
  });

  it("contains the disclaimer exactly", () => {
    expect(result.disclaimer).toBe(DISCLAIMER);
  });

  it("has no wall-clock style field names", () => {
    const keys = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        for (const [k, x] of Object.entries(v)) {
          keys.add(k);
          walk(x);
        }
      }
    };
    walk(result);
    for (const bad of ["timestamp", "generatedAt", "createdAt", "runId", "durationMs", "elapsedMs"]) {
      expect(keys.has(bad)).toBe(false);
    }
  });
});

describe("simulate seed", () => {
  it("echoes the seed given in the request", () => {
    expect(simulate(request({ seed: 12345, trialsPerUser: 1 })).seed).toBe(12345);
    expect(simulate(request({ seed: -3, trialsPerUser: 1 })).seed).toBe(-3);
  });

  it("is deterministic for the same request", () => {
    const r = request({ users: [user("head-tremor")] });
    expect(simulate(r)).toEqual(simulate(r));
  });
});

describe("simulate effective profile", () => {
  it("differs between two users with different head ranges", () => {
    const wide = user({ name: "wide", overrides: { headRangeDeg: { left: 30, right: 30, up: 30, down: 30 } } });
    const narrow = user({ name: "narrow", overrides: { headRangeDeg: { left: 5, right: 5, up: 5, down: 5 } } });
    const r = simulate(request({ users: [wide, narrow], trialsPerUser: 1 }));
    const [a, b] = r.parameters.users;
    expect(a.effectiveProfile).not.toEqual(b.effectiveProfile);
    expect(a.effectiveProfile.calibrationRangeLeft).not.toBe(b.effectiveProfile.calibrationRangeLeft);
  });

  it("is the profile every trial ran with", () => {
    const u = user("small-range");
    const r = simulate(request({ users: [u], trialsPerUser: 3 }));
    const run = runUser({
      layout, profile: { dwellTime: 400 }, user: u, mode: "head + dwell", task: ["a", "b"], fps: 30,
      analysisWindowMs: 5000, requestSeed: 7, trials: 3,
    });
    for (const t of run.trials) expect(t.effectiveProfile).toEqual(r.parameters.users[0].effectiveProfile);
  });
});

describe("simulate null rules and rounding", () => {
  it("gives null rates and percentiles when there is no data", () => {
    // Every entry targets an unreachable spot: calibration ranges above the head range, tiny window.
    const r = simulate(request({ users: [user("steady")], task: [], trialsPerUser: 1 }));
    const u = r.users[0];
    expect(u.intended).toBe(0);
    expect(u.accidentalPer100Intended).toBeNull();
    expect(u.timeToSelectMs).toEqual({ median: null, p90: null });
    for (const row of u.perTarget) {
      expect(row.accidentalPer100Intended).toBeNull();
      expect(row.timeToSelectMs).toEqual({ median: null, p90: null });
    }
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/);
  });

  it("outputs round1 of the full-precision metric rate on users and per target", () => {
    const u = user("strong-head-tremor");
    const base = request({ users: [u], trialsPerUser: 5, task: { eachTarget: 4 }, profile: { dwellTime: 250 } });
    const out = simulate(base).users[0];
    const ids = expandTask(layout, base.task, base.seed);
    if (!ids.ok) throw new Error("task");
    const full = runUser({
      layout, profile: base.profile, user: u, mode: "head + dwell", task: ids.ids, fps: 30,
      analysisWindowMs: 5000, requestSeed: base.seed, trials: 5,
    }).metrics;
    expect(out.accidentalPer100Intended).toBe(round1(full.accidentalPer100Intended));
    full.perTarget.forEach((row, i) => {
      expect(out.perTarget[i].accidentalPer100Intended).toBe(round1(row.accidentalPer100Intended));
    });
    // Counts are unrounded.
    expect(out.accidental).toBe(full.accidental);
    expect(out.intended).toBe(full.intended);
  });
});

describe("simulate errors", () => {
  it("throws a clear error for mode scan", () => {
    const fn = (): unknown => simulate(request({ mode: "scan" }));
    expect(fn).toThrow(SimulateError);
    expect(fn).toThrow(/scan mode is not implemented/);
    try {
      fn();
    } catch (e) {
      expect((e as SimulateError).code).toBe("UNSUPPORTED_MODE");
    }
  });

  it("throws a typed ADJACENT_REPEAT error when the task expansion fails", () => {
    try {
      simulate(request({ task: ["a", "a"] }));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SimulateError);
      const err = e as SimulateError;
      expect(err.code).toBe("ADJACENT_REPEAT");
      expect(err.taskError).toEqual({ code: "ADJACENT_REPEAT", index: 1, targetId: "a" });
    }
  });
});
