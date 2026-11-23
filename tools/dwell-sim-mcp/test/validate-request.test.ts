import { describe, expect, it } from "vitest";
import { CompareInputSchema, SimulateInputSchema, type CompareToolInput, type SimulateToolInput } from "../src/tool-schemas.js";
import { validateCompareRequest, validateSimulateRequest, type ValidationError } from "../src/validate-request.js";

const rect = (x: number, y: number, width = 100, height = 60) => ({ x, y, width, height });

const baseLayout = () => ({
  screen: { width: 800, height: 600 },
  targets: [
    { id: "menu", rect: rect(40, 40) },
    { id: "ok", rect: rect(400, 40) },
    { id: "rest", rect: rect(400, 400), role: "rest-area" as const },
  ],
});

/** A valid simulate input with defaults applied, with optional raw overrides (not parsed by zod). */
function sim(over: Record<string, unknown> = {}): SimulateToolInput {
  const parsed = SimulateInputSchema.parse({ layout: baseLayout(), users: ["steady"], task: ["menu", "ok"] });
  return { ...parsed, ...over } as SimulateToolInput;
}

function cmp(over: Record<string, unknown> = {}): CompareToolInput {
  const parsed = CompareInputSchema.parse({
    a: { layout: baseLayout() },
    b: {},
    users: ["steady"],
    task: ["menu", "ok"],
  });
  return { ...parsed, ...over } as CompareToolInput;
}

function simError(over: Record<string, unknown>): ValidationError {
  const r = validateSimulateRequest(sim(over));
  if (r.ok) throw new Error("expected an error");
  return r.error;
}
function cmpError(over: Record<string, unknown>): ValidationError {
  const r = validateCompareRequest(cmp(over));
  if (r.ok) throw new Error("expected an error");
  return r.error;
}

const layoutWith = (targets: unknown[], screen: unknown = { width: 800, height: 600 }) => ({ screen, targets });
const targetsN = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, rect: rect(i, i) }));
const custom = (overrides: Record<string, unknown>, name = "c") => ({ name, overrides });

describe("validateSimulateRequest: success", () => {
  it("returns the core request with defaults, resolved users and filled targets", () => {
    const r = validateSimulateRequest(sim());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.request.mode).toBe("head + dwell");
    expect(r.request.fps).toBe(30);
    expect(r.request.seed).toBe(1);
    expect(r.request.trialsPerUser).toBe(10);
    expect(r.request.users[0].name).toBe("steady");
    expect(r.request.users[0].params.throughputBitsPerS).toBe(1.42);
    expect(r.request.layout.targets[0]).toEqual({ id: "menu", rect: rect(40, 40), autoRepeat: false, role: "default" });
    expect(r.request.layout.targets[2].role).toBe("rest-area");
    expect(r.request.task).toEqual(["menu", "ok"]);
    expect(r.request.profile).toEqual({});
  });

  it("passes the profile and an eachTarget task through", () => {
    const r = validateSimulateRequest(sim({ profile: { dwellTime: 1000 }, task: { eachTarget: 2 } }));
    expect(r.ok && r.request.profile).toEqual({ dwellTime: 1000 });
    expect(r.ok && r.request.task).toEqual({ eachTarget: 2 });
  });
});

describe("one example per code", () => {
  it("UNKNOWN_PRESET", () => {
    expect(simError({ users: ["steady", "nope"] })).toEqual({
      code: "UNKNOWN_PRESET",
      parameter: "users[1]",
      message:
        'Unknown preset "nope". Valid presets: steady, slow, head-tremor, strong-head-tremor, small-range, reads-while-pointing.',
      allowed: ["steady", "slow", "head-tremor", "strong-head-tremor", "small-range", "reads-while-pointing"],
    });
  });

  it("UNKNOWN_PRESET for a custom base", () => {
    const e = simError({ users: [{ name: "c", base: "nope", overrides: {} }] });
    expect(e.code).toBe("UNKNOWN_PRESET");
    expect(e.parameter).toBe("users[0].base");
  });

  it("OUT_OF_RANGE", () => {
    expect(simError({ users: ["steady", "slow", custom({ throughputBitsPerS: 5 })] })).toEqual({
      code: "OUT_OF_RANGE",
      parameter: "users[2].overrides.throughputBitsPerS",
      message: "Parameter users[2].overrides.throughputBitsPerS must be between 0.3 and 4 bits/s; got 5.",
      allowed: { min: 0.3, max: 4 },
    });
  });

  it("CAP_EXCEEDED", () => {
    expect(simError({ trialsPerUser: 51 })).toEqual({
      code: "CAP_EXCEEDED",
      parameter: "trialsPerUser",
      message: "Parameter trialsPerUser allows at most 50; got 51.",
      allowed: { min: 1, max: 50 },
    });
  });

  it("NOT_ALLOWED_VALUE", () => {
    expect(simError({ fps: 24 })).toEqual({
      code: "NOT_ALLOWED_VALUE",
      parameter: "fps",
      message: "Parameter fps must be one of 15, 30, 60; got 24.",
      allowed: ["15", "30", "60"],
    });
  });

  it("UNSUPPORTED_MODE", () => {
    expect(simError({ mode: "mouse" })).toEqual({
      code: "UNSUPPORTED_MODE",
      parameter: "mode",
      message: 'Input mode "mouse" is not supported. Supported modes: head + dwell.',
      allowed: ["head + dwell"],
    });
  });

  it("NO_SELECTABLE_TARGETS", () => {
    expect(simError({ layout: layoutWith([{ id: "r", rect: rect(0, 0), role: "rest-area" }]) })).toEqual({
      code: "NO_SELECTABLE_TARGETS",
      parameter: "layout.targets",
      message: "The layout has no selectable targets (no targets, or only rest-area targets).",
    });
  });

  it("UNKNOWN_TARGET", () => {
    expect(simError({ task: ["menu", "ok", "menu", "ok", "ghost"] })).toEqual({
      code: "UNKNOWN_TARGET",
      parameter: "task[4]",
      message: 'Task entry 4 names target "ghost", which is not in the layout.',
    });
  });

  it("ADJACENT_REPEAT", () => {
    expect(simError({ task: ["menu", "ok", "ok"] })).toEqual({
      code: "ADJACENT_REPEAT",
      parameter: "task[2]",
      message:
        'Task entry 2 repeats target "ok" directly after entry 1, and the target has no autoRepeat. Entries are numbered from zero.',
    });
  });

  it("ADJACENT_REPEAT for eachTarget with one non-autoRepeat selectable target", () => {
    const layout = layoutWith([{ id: "only", rect: rect(0, 0) }]);
    const e = simError({ layout, task: { eachTarget: 2 } });
    expect(e.code).toBe("ADJACENT_REPEAT");
    expect(e.parameter).toBe("task.eachTarget");
    expect(e.message).toContain("Task entry 1 repeats target \"only\" directly after entry 0");
  });

  it("an autoRepeat target may repeat", () => {
    const layout = layoutWith([{ id: "only", rect: rect(0, 0), autoRepeat: true }]);
    expect(validateSimulateRequest(sim({ layout, task: ["only", "only"] })).ok).toBe(true);
    expect(validateSimulateRequest(sim({ layout, task: { eachTarget: 3 } })).ok).toBe(true);
  });

  it("INVALID_LAYOUT", () => {
    const layout = layoutWith([{ id: "menu", rect: rect(0, 0, 0, 10) }, { id: "ok", rect: rect(5, 5) }]);
    expect(simError({ layout })).toEqual({
      code: "INVALID_LAYOUT",
      parameter: 'layout.targets["menu"].rect.width',
      message: 'Layout problem at layout.targets["menu"].rect.width: width must be > 0.',
    });
  });

  it("UNKNOWN_PARAMETER", () => {
    const e = simError({ users: ["steady", "slow", custom({ colour: 1 })] });
    const names = [
      "headRangeDeg",
      "reactionTimeMs",
      "readingPauseChancePct",
      "readingPauseLengthMs",
      "scatterCapDeg",
      "throughputBitsPerS",
      "trackingNoiseDeg",
      "tremorAxis",
      "tremorFrequencyHz",
      "tremorPeakToPeakDeg",
    ];
    expect(e).toEqual({
      code: "UNKNOWN_PARAMETER",
      parameter: "users[2].overrides.colour",
      message: `Parameter users[2].overrides.colour cannot be overridden. Customisable: ${names.join(", ")}.`,
      allowed: names,
    });
  });

  it("UNKNOWN_PARAMETER lists the names sorted (UTF-16) and joined with ', '", () => {
    const e = simError({ users: [custom({ colour: 1 })] });
    const sorted = [...(e.allowed as string[])].sort();
    expect(e.allowed).toEqual(sorted);
    expect(e.message.endsWith(`Customisable: ${sorted.join(", ")}.`)).toBe(true);
  });

  it("LAYOUT_MISMATCH", () => {
    const b = { layout: layoutWith([{ id: "menu", rect: rect(0, 0) }, { id: "extra", rect: rect(200, 0) }]) };
    expect(cmpError({ b })).toEqual({
      code: "LAYOUT_MISMATCH",
      parameter: "b.layout",
      message: "The two layouts must have the same target ids; differing: extra, ok, rest.",
    });
  });
});

describe("count boundaries", () => {
  const usersN = (n: number) => Array.from({ length: n }, (_, i) => custom({}, `u${i}`));
  const taskN = (n: number) => Array.from({ length: n }, (_, i) => (i % 2 === 0 ? "menu" : "ok"));

  it("users: 0 OUT_OF_RANGE, 1 and 12 accepted, 13 CAP_EXCEEDED", () => {
    expect(simError({ users: [] })).toMatchObject({ code: "OUT_OF_RANGE", parameter: "users", allowed: { min: 1, max: 12 } });
    expect(validateSimulateRequest(sim({ users: usersN(1) })).ok).toBe(true);
    expect(validateSimulateRequest(sim({ users: usersN(12) })).ok).toBe(true);
    expect(simError({ users: usersN(13) })).toMatchObject({
      code: "CAP_EXCEEDED",
      parameter: "users",
      message: "Parameter users allows at most 12; got 13.",
      allowed: { min: 1, max: 12 },
    });
  });

  it("trials: 0 OUT_OF_RANGE, 1 and 50 accepted, 51 CAP_EXCEEDED", () => {
    expect(simError({ trialsPerUser: 0 })).toMatchObject({
      code: "OUT_OF_RANGE",
      parameter: "trialsPerUser",
      message: "Parameter trialsPerUser must be between 1 and 50; got 0.",
      allowed: { min: 1, max: 50 },
    });
    expect(validateSimulateRequest(sim({ trialsPerUser: 1 })).ok).toBe(true);
    expect(validateSimulateRequest(sim({ trialsPerUser: 50 })).ok).toBe(true);
    expect(simError({ trialsPerUser: 51 })).toMatchObject({ code: "CAP_EXCEEDED", allowed: { min: 1, max: 50 } });
  });

  it("targets: 0 OUT_OF_RANGE, 1 and 100 accepted, 101 CAP_EXCEEDED", () => {
    expect(simError({ layout: layoutWith([]) })).toMatchObject({
      code: "OUT_OF_RANGE",
      parameter: "layout.targets",
      allowed: { min: 1, max: 100 },
    });
    const one = layoutWith(targetsN(1));
    expect(validateSimulateRequest(sim({ layout: one, task: ["t0"] })).ok).toBe(true);
    expect(validateSimulateRequest(sim({ layout: layoutWith(targetsN(100)), task: ["t0"] })).ok).toBe(true);
    expect(simError({ layout: layoutWith(targetsN(101)) })).toMatchObject({
      code: "CAP_EXCEEDED",
      parameter: "layout.targets",
      message: "Parameter layout.targets allows at most 100; got 101.",
      allowed: { min: 1, max: 100 },
    });
  });

  it("task entries: 0 OUT_OF_RANGE, 1 and 500 accepted, 501 CAP_EXCEEDED", () => {
    expect(simError({ task: [] })).toMatchObject({ code: "OUT_OF_RANGE", parameter: "task", allowed: { min: 1, max: 500 } });
    expect(validateSimulateRequest(sim({ task: ["menu"] })).ok).toBe(true);
    expect(validateSimulateRequest(sim({ task: taskN(500) })).ok).toBe(true);
    expect(simError({ task: taskN(501) })).toMatchObject({
      code: "CAP_EXCEEDED",
      parameter: "task",
      message: "Parameter task allows at most 500; got 501.",
      allowed: { min: 1, max: 500 },
    });
  });

  it("eachTarget n times selectable above 500 is CAP_EXCEEDED with the product", () => {
    // two selectable targets: 250 is accepted (500 entries), 251 gives 502
    expect(validateSimulateRequest(sim({ task: { eachTarget: 100 } })).ok).toBe(true);
    const many = layoutWith(targetsN(6));
    expect(validateSimulateRequest(sim({ layout: many, task: { eachTarget: 83 } })).ok).toBe(true); // 498
    expect(simError({ layout: many, task: { eachTarget: 84 } })).toEqual({
      code: "CAP_EXCEEDED",
      parameter: "task.eachTarget",
      message: "Parameter task.eachTarget allows at most 500; got 504.",
      allowed: { min: 1, max: 500 },
    });
  });

  it("eachTarget range 1..100 and integer rule", () => {
    expect(simError({ task: { eachTarget: 0 } })).toMatchObject({
      code: "OUT_OF_RANGE",
      parameter: "task.eachTarget",
      message: "Parameter task.eachTarget must be between 1 and 100; got 0.",
      allowed: { min: 1, max: 100 },
    });
    expect(simError({ task: { eachTarget: 101 } })).toMatchObject({ code: "OUT_OF_RANGE", allowed: { min: 1, max: 100 } });
    const e = simError({ task: { eachTarget: 1.5 } });
    expect(e).toMatchObject({ code: "NOT_ALLOWED_VALUE", parameter: "task.eachTarget" });
    expect(e.message).toContain("must be an integer");
    expect(e.allowed).toBeUndefined();
  });
});

describe("fps, window, seed, trials integer", () => {
  it("fps 15, 30, 60 accepted; 24 rejected", () => {
    for (const fps of [15, 30, 60]) expect(validateSimulateRequest(sim({ fps })).ok).toBe(true);
    expect(simError({ fps: 24 }).code).toBe("NOT_ALLOWED_VALUE");
  });

  it("analysisWindowS 2 and 120 accepted; 1 and 121 rejected", () => {
    for (const analysisWindowS of [2, 120]) expect(validateSimulateRequest(sim({ analysisWindowS })).ok).toBe(true);
    for (const analysisWindowS of [1, 121]) {
      expect(simError({ analysisWindowS })).toEqual({
        code: "OUT_OF_RANGE",
        parameter: "analysisWindowS",
        message: `Parameter analysisWindowS must be between 2 and 120 s; got ${analysisWindowS}.`,
        allowed: { min: 2, max: 120 },
      });
    }
  });

  it("seed bounds and non-integer", () => {
    for (const seed of [-2147483648, 2147483647, 0]) expect(validateSimulateRequest(sim({ seed })).ok).toBe(true);
    for (const seed of [-2147483649, 2147483648]) {
      expect(simError({ seed })).toEqual({
        code: "OUT_OF_RANGE",
        parameter: "seed",
        message: `Parameter seed must be between -2147483648 and 2147483647; got ${seed}.`,
        allowed: { min: -2147483648, max: 2147483647 },
      });
    }
    const e = simError({ seed: 1.5 });
    expect(e).toMatchObject({ code: "NOT_ALLOWED_VALUE", parameter: "seed" });
    expect(e.message).toContain("must be an integer");
    expect(e.allowed).toBeUndefined();
  });

  it("non-integer trialsPerUser is NOT_ALLOWED_VALUE without allowed", () => {
    const e = simError({ trialsPerUser: 2.5 });
    expect(e).toMatchObject({ code: "NOT_ALLOWED_VALUE", parameter: "trialsPerUser" });
    expect(e.message).toContain("must be an integer");
    expect(e.allowed).toBeUndefined();
  });
});

describe("modes", () => {
  it.each(["scan", "head + gesture", "gesture scan", "mouse"])("%s lists head + dwell only", (mode) => {
    const e = simError({ mode });
    expect(e.code).toBe("UNSUPPORTED_MODE");
    expect(e.parameter).toBe("mode");
    expect(e.allowed).toEqual(["head + dwell"]);
    expect(e.message).toBe(`Input mode "${mode}" is not supported. Supported modes: head + dwell.`);
  });

  it("compare rejects scan the same way", () => {
    expect(cmpError({ mode: "scan" })).toMatchObject({ code: "UNSUPPORTED_MODE", allowed: ["head + dwell"] });
  });
});

describe("first problem in the fixed order wins", () => {
  const bad = {
    mode: "mouse",
    users: [],
    layout: layoutWith([]),
    task: [],
    trialsPerUser: 0,
    fps: 24,
    analysisWindowS: 1,
    seed: 1.5,
  };

  it("walks mode, users, layout, task, trials, fps, window, seed", () => {
    const o: Record<string, unknown> = { ...bad };
    const order = ["mode", "users", "layout.targets", "task", "trialsPerUser", "fps", "analysisWindowS", "seed"];
    const fixes: Record<string, unknown> = {
      mode: "head + dwell",
      users: ["steady"],
      "layout.targets": baseLayout(),
      task: ["menu", "ok"],
      trialsPerUser: 10,
      fps: 30,
      analysisWindowS: 10,
    };
    const keyOf: Record<string, string> = { "layout.targets": "layout" };
    for (const expected of order) {
      expect(simError(o).parameter).toBe(expected);
      const key = keyOf[expected] ?? expected;
      o[key] = fixes[expected];
    }
  });

  it("users come before layout, preset before duplicate on a later user", () => {
    expect(simError({ users: ["nope"], layout: layoutWith([]) }).code).toBe("UNKNOWN_PRESET");
  });

  it("layout step order: screen, target count, id, rect fields, selectable", () => {
    const wide = { width: 0, height: 0 };
    expect(simError({ layout: layoutWith([], wide) }).parameter).toBe("layout.screen.width");
    expect(simError({ layout: layoutWith([], { width: 10, height: 0 }) }).parameter).toBe("layout.screen.height");
    expect(simError({ layout: layoutWith([]) }).parameter).toBe("layout.targets");
    const t = (id: string, r: Record<string, number>) => ({ id, rect: { x: 0, y: 0, width: 5, height: 5, ...r } });
    expect(simError({ layout: layoutWith([t("", {}), t("a", { x: NaN })]) }).parameter).toBe("layout.targets[0].id");
    expect(simError({ layout: layoutWith([t("a", { x: NaN, y: NaN, width: -1, height: -1 })]) }).parameter).toBe(
      'layout.targets["a"].rect.x',
    );
    expect(simError({ layout: layoutWith([t("a", { y: NaN, width: -1, height: -1 })]) }).parameter).toBe(
      'layout.targets["a"].rect.y',
    );
    expect(simError({ layout: layoutWith([t("a", { width: -1, height: -1 })]) }).parameter).toBe(
      'layout.targets["a"].rect.width',
    );
    expect(simError({ layout: layoutWith([t("a", { height: -1 })]) }).parameter).toBe('layout.targets["a"].rect.height');
    // an earlier target's rect problem comes before a later target's id problem
    expect(simError({ layout: layoutWith([t("a", { width: 0 }), t("", {})]) }).parameter).toBe(
      'layout.targets["a"].rect.width',
    );
  });

  it("UNKNOWN_TARGET comes before ADJACENT_REPEAT", () => {
    const e = simError({ task: ["menu", "menu", "ghost"] });
    expect(e.code).toBe("UNKNOWN_TARGET");
    expect(e.parameter).toBe("task[2]");
  });

  describe("compare", () => {
    const badLayout = layoutWith([{ id: "x", rect: rect(0, 0, 0, 5) }]);
    const badLayout2 = layoutWith([{ id: "x", rect: rect(0, 0, 5, 0) }]);

    it("A's layout error comes before B's", () => {
      const e = cmpError({ a: { layout: badLayout }, b: { layout: badLayout2 }, task: [] });
      expect(e.parameter).toBe('a.layout.targets["x"].rect.width');
    });

    it("B's layout error comes before LAYOUT_MISMATCH", () => {
      const e = cmpError({ b: { layout: badLayout2 }, task: [] });
      expect(e.code).toBe("INVALID_LAYOUT");
      expect(e.parameter).toBe('b.layout.targets["x"].rect.height');
    });

    it("LAYOUT_MISMATCH comes before task errors", () => {
      const b = { layout: layoutWith([{ id: "other", rect: rect(0, 0) }]) };
      expect(cmpError({ b, task: ["ghost"] }).code).toBe("LAYOUT_MISMATCH");
    });

    it("task ids are checked against layout A", () => {
      const e = cmpError({ task: ["menu", "ghost"] });
      expect(e).toMatchObject({ code: "UNKNOWN_TARGET", parameter: "task[1]" });
    });

    it("side layout paths carry the a. / b. prefix for every layout error", () => {
      expect(cmpError({ a: { layout: layoutWith([], { width: 0, height: 5 }) } }).parameter).toBe("a.layout.screen.width");
      expect(cmpError({ a: { layout: layoutWith([]) } }).parameter).toBe("a.layout.targets");
      expect(cmpError({ b: { layout: layoutWith(targetsN(101)) } })).toMatchObject({
        code: "CAP_EXCEEDED",
        parameter: "b.layout.targets",
      });
      expect(cmpError({ b: { layout: layoutWith([{ id: "r", rect: rect(0, 0), role: "rest-area" }]) } })).toMatchObject({
        code: "NO_SELECTABLE_TARGETS",
        parameter: "b.layout.targets",
      });
    });

    it("shared fields are unprefixed", () => {
      expect(cmpError({ fps: 24 }).parameter).toBe("fps");
      expect(cmpError({ users: [] }).parameter).toBe("users");
    });

    it("a valid compare request defaults b.layout to undefined and keeps labels", () => {
      const r = validateCompareRequest(
        cmp({ a: { layout: baseLayout(), label: "A", profile: { dwellTime: 900 } }, b: { label: "B" } }),
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.request.b.layout).toBeUndefined();
      expect(r.request.a.label).toBe("A");
      expect(r.request.b.label).toBe("B");
      expect(r.request.a.profile).toEqual({ dwellTime: 900 });
      expect(r.request.fps).toBe(30);
    });

    it("a valid B layout with the same ids is accepted", () => {
      const b = { layout: layoutWith([{ id: "rest", rect: rect(1, 1) }, { id: "ok", rect: rect(9, 9) }, { id: "menu", rect: rect(5, 5) }]) };
      const r = validateCompareRequest(cmp({ b }));
      expect(r.ok && r.request.b.layout?.targets.map((t) => t.id)).toEqual(["rest", "ok", "menu"]);
    });
  });
});

describe("INVALID_LAYOUT reasons and paths", () => {
  const t = (id: string, r: Record<string, number> = {}) => ({ id, rect: { x: 0, y: 0, width: 5, height: 5, ...r } });
  it.each([
    ["duplicate id", [t("a"), t("a")], "layout.targets[1].id", "duplicate id"],
    ["empty id", [t("a"), t("")], "layout.targets[1].id", "empty id"],
    ["x not finite", [t("a", { x: Infinity })], 'layout.targets["a"].rect.x', "not finite"],
    ["y not finite", [t("a", { y: NaN })], 'layout.targets["a"].rect.y', "not finite"],
    ["width not finite", [t("a", { width: Infinity })], 'layout.targets["a"].rect.width', "not finite"],
    ["height not finite", [t("a", { height: NaN })], 'layout.targets["a"].rect.height', "not finite"],
    ["width zero", [t("a", { width: 0 })], 'layout.targets["a"].rect.width', "width must be > 0"],
    ["width negative", [t("a", { width: -3 })], 'layout.targets["a"].rect.width', "width must be > 0"],
    ["height zero", [t("a", { height: 0 })], 'layout.targets["a"].rect.height', "height must be > 0"],
  ])("%s", (_name, targets, parameter, reason) => {
    expect(simError({ layout: layoutWith(targets) })).toEqual({
      code: "INVALID_LAYOUT",
      parameter,
      message: `Layout problem at ${parameter}: ${reason}.`,
    });
  });

  it.each([
    [{ width: 0, height: 10 }, "layout.screen.width"],
    [{ width: Infinity, height: 10 }, "layout.screen.width"],
    [{ width: 0.5, height: 10 }, "layout.screen.width"],
    [{ width: 10, height: NaN }, "layout.screen.height"],
    [{ width: 10, height: 0.99 }, "layout.screen.height"],
  ])("screen %j", (screen, parameter) => {
    expect(simError({ layout: layoutWith([t("a")], screen) })).toEqual({
      code: "INVALID_LAYOUT",
      parameter,
      message: `Layout problem at ${parameter}: screen size must be finite and ≥ 1.`,
    });
  });

  it("screen size 1 is accepted", () => {
    expect(validateSimulateRequest(sim({ layout: layoutWith([t("a")], { width: 1, height: 1 }), task: ["a"] })).ok).toBe(true);
  });

  it("escapes quotes in the id inside the path", () => {
    const e = simError({ layout: layoutWith([t('a"b', { width: 0 })]) });
    expect(e.parameter).toBe('layout.targets["a\\"b"].rect.width');
  });
});

describe("resolveUser mappings (V5a)", () => {
  it("NaN and Infinity become OUT_OF_RANGE with the parameter's range", () => {
    expect(simError({ users: [custom({ reactionTimeMs: NaN })] })).toEqual({
      code: "OUT_OF_RANGE",
      parameter: "users[0].overrides.reactionTimeMs",
      message: "Parameter users[0].overrides.reactionTimeMs must be between 150 and 1500 ms; got NaN.",
      allowed: { min: 150, max: 1500 },
    });
    expect(simError({ users: [custom({ headRangeDeg: { left: Infinity } })] })).toMatchObject({
      code: "OUT_OF_RANGE",
      parameter: "users[0].overrides.headRangeDeg.left",
      allowed: { min: 3, max: 60 },
    });
    expect(simError({ users: [custom({ readingPauseLengthMs: { min: NaN, max: 5 } })] })).toMatchObject({
      code: "OUT_OF_RANGE",
      parameter: "users[0].overrides.readingPauseLengthMs.min",
      allowed: { min: 0, max: 3000 },
    });
  });

  it("a bad tremorAxis is NOT_ALLOWED_VALUE with the options", () => {
    expect(simError({ users: ["steady", "slow", custom({ tremorAxis: "roll" })] })).toMatchObject({
      code: "NOT_ALLOWED_VALUE",
      parameter: "users[2].overrides.tremorAxis",
      allowed: ["yaw", "pitch"],
    });
  });

  it("a non-object headRangeDeg has no allowed and the fixed message", () => {
    const e = simError({ users: [custom({ headRangeDeg: 5 })] });
    expect(e.code).toBe("NOT_ALLOWED_VALUE");
    expect(e.parameter).toBe("users[0].overrides.headRangeDeg");
    expect(e.message).toContain("must be an object with left, right, up, down");
    expect(e.allowed).toBeUndefined();
  });

  it("throughput zero, negative or infinite is OUT_OF_RANGE with the range", () => {
    for (const v of [0, -1, Infinity]) {
      expect(simError({ users: [custom({ throughputBitsPerS: v })] })).toMatchObject({
        code: "OUT_OF_RANGE",
        parameter: "users[0].overrides.throughputBitsPerS",
        allowed: { min: 0.3, max: 4 },
      });
    }
  });

  it("readingPauseLengthMs min > max is OUT_OF_RANGE on .min", () => {
    const e = simError({ users: [custom({ readingPauseLengthMs: { min: 900, max: 300 } })] });
    expect(e.code).toBe("OUT_OF_RANGE");
    expect(e.parameter).toBe("users[0].overrides.readingPauseLengthMs.min");
    expect(e.allowed).toEqual({ min: 0, max: 300 });
  });

  it("custom ranges: inside accepted, just outside rejected with path and range", () => {
    const cases: Array<[string, unknown, unknown, string, { min: number; max: number }]> = [
      ["throughputBitsPerS", 0.3, 0.29, "throughputBitsPerS", { min: 0.3, max: 4 }],
      ["throughputBitsPerS", 4, 4.01, "throughputBitsPerS", { min: 0.3, max: 4 }],
      ["tremorFrequencyHz", 15, 15.1, "tremorFrequencyHz", { min: 1, max: 15 }],
      ["tremorPeakToPeakDeg", 0, -0.1, "tremorPeakToPeakDeg", { min: 0, max: 5 }],
      ["reactionTimeMs", 150, 149, "reactionTimeMs", { min: 150, max: 1500 }],
      ["readingPauseChancePct", 100, 101, "readingPauseChancePct", { min: 0, max: 100 }],
      ["scatterCapDeg", 0.1, 0.09, "scatterCapDeg", { min: 0.1, max: 3 }],
      ["trackingNoiseDeg", 2, 2.1, "trackingNoiseDeg", { min: 0, max: 2 }],
      ["headRangeDeg", { up: 3, down: 60 }, { up: 2.9 }, "headRangeDeg.up", { min: 3, max: 60 }],
      ["headRangeDeg", { left: 60 }, { left: 61 }, "headRangeDeg.left", { min: 3, max: 60 }],
      ["readingPauseLengthMs", { min: 0, max: 3000 }, { min: 0, max: 3001 }, "readingPauseLengthMs.max", { min: 0, max: 3000 }],
    ];
    for (const [key, inside, outside, path, range] of cases) {
      expect(validateSimulateRequest(sim({ users: [custom({ [key]: inside })] })).ok).toBe(true);
      const e = simError({ users: [custom({ [key]: outside })] });
      expect(e.code).toBe("OUT_OF_RANGE");
      expect(e.parameter).toBe(`users[0].overrides.${path}`);
      expect(e.allowed).toEqual(range);
    }
  });

  it("a custom user keeps its resolved overrides", () => {
    const r = validateSimulateRequest(
      sim({ users: [{ name: "c", base: "slow", overrides: { tremorAxis: "pitch", headRangeDeg: { left: 10 } } }] }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.request.users[0].params.tremorAxis).toBe("pitch");
    expect(r.request.users[0].params.headRangeDeg.left).toBe(10);
    expect(r.request.users[0].params.throughputBitsPerS).toBe(0.61);
  });
});

describe("tremorFrequencyHz (D3)", () => {
  it("0.5 is OUT_OF_RANGE with allowed 1..15 and a message that 0 means off", () => {
    const e = simError({ users: [custom({ tremorFrequencyHz: 0.5 })] });
    expect(e).toMatchObject({
      code: "OUT_OF_RANGE",
      parameter: "users[0].overrides.tremorFrequencyHz",
      allowed: { min: 1, max: 15 },
    });
    expect(e.message).toBe(
      "Parameter users[0].overrides.tremorFrequencyHz must be 0 (0 means off) or between 1 and 15 Hz; got 0.5.",
    );
  });
  it("0 and 1 are accepted", () => {
    for (const v of [0, 1]) {
      expect(validateSimulateRequest(sim({ users: [custom({ tremorFrequencyHz: v })] })).ok, String(v)).toBe(true);
    }
  });
});
describe("rest area in an explicit task (D5)", () => {
  it("is UNKNOWN_TARGET with a rest-area message", () => {
    expect(simError({ task: ["menu", "rest"] })).toEqual({
      code: "UNKNOWN_TARGET",
      parameter: "task[1]",
      message: 'Task entry 1 names target "rest", which is a rest area and cannot be selected.',
    });
  });
});
describe("duplicate user names (V5e)", () => {
  it("rejects the second occurrence", () => {
    const e = simError({ users: ["steady", "slow", "steady"] });
    expect(e.code).toBe("NOT_ALLOWED_VALUE");
    expect(e.parameter).toBe("users[2]");
    expect(e.message).toContain("duplicate user name");
    expect(e.allowed).toBeUndefined();
  });

  it("a custom user named like a preset counts as a duplicate", () => {
    expect(simError({ users: ["steady", custom({}, "steady")] })).toMatchObject({ code: "NOT_ALLOWED_VALUE", parameter: "users[1]" });
  });

  it("two custom users with one name collide", () => {
    expect(simError({ users: [custom({}, "x"), custom({}, "x")] }).parameter).toBe("users[1]");
  });
});
