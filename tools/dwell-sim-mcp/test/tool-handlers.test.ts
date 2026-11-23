import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompareRequest, CompareResult } from "../src/compare.js";
import type { ListUsersResult } from "../src/list-users.js";
import type { SimulateResult } from "../src/simulate.js";
import type { SimulateRequest } from "../src/types.js";

// Hooks for the mocked core. With nothing set, every mock delegates to the real module.
const hooks = vi.hoisted(() => ({
  simulate: undefined as undefined | ((r: SimulateRequest) => SimulateResult),
  compare: undefined as undefined | ((r: CompareRequest) => CompareResult),
  listUsers: undefined as undefined | (() => ListUsersResult),
  bypassValidation: false,
}));

vi.mock("../src/simulate.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/simulate.js")>();
  return { ...actual, simulate: (r: SimulateRequest) => (hooks.simulate ? hooks.simulate(r) : actual.simulate(r)) };
});
vi.mock("../src/compare.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/compare.js")>();
  return { ...actual, compare: (r: CompareRequest) => (hooks.compare ? hooks.compare(r) : actual.compare(r)) };
});
vi.mock("../src/list-users.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/list-users.js")>();
  return { ...actual, listUsers: () => (hooks.listUsers ? hooks.listUsers() : actual.listUsers()) };
});
vi.mock("../src/validate-request.js", async (importActual) => {
  const actual = await importActual<typeof import("../src/validate-request.js")>();
  return {
    ...actual,
    validateSimulateRequest: (input: unknown) =>
      hooks.bypassValidation ? { ok: true, request: input } : actual.validateSimulateRequest(input as never),
    validateCompareRequest: (input: unknown) =>
      hooks.bypassValidation ? { ok: true, request: input } : actual.validateCompareRequest(input as never),
  };
});

import { DISCLAIMER } from "../src/disclaimer.js";
import { handleCompare, handleListUsers, handleSimulate, type CallToolResult } from "../src/tool-handlers.js";
import {
  CompareInputSchema,
  SimulateInputSchema,
  type CompareToolInput,
  type SimulateToolInput,
} from "../src/tool-schemas.js";

const rect = (x: number, y: number, width = 100, height = 60) => ({ x, y, width, height });
const baseLayout = () => ({
  screen: { width: 800, height: 600 },
  targets: [
    { id: "menu", rect: rect(40, 40) },
    { id: "ok", rect: rect(400, 40) },
    { id: "rest", rect: rect(400, 400), role: "rest-area" as const },
  ],
});

/** A parsed simulate input (defaults applied) with raw overrides that zod would not accept. */
function sim(over: Record<string, unknown> = {}): SimulateToolInput {
  const parsed = SimulateInputSchema.parse({
    layout: baseLayout(),
    users: ["steady"],
    task: ["menu", "ok"],
    trialsPerUser: 1,
    fps: 15,
    analysisWindowS: 2,
    seed: 7,
  });
  return { ...parsed, ...over } as SimulateToolInput;
}
function cmp(over: Record<string, unknown> = {}): CompareToolInput {
  const parsed = CompareInputSchema.parse({
    a: { layout: baseLayout() },
    b: {},
    users: ["steady"],
    task: ["menu", "ok"],
    trialsPerUser: 1,
    fps: 15,
    analysisWindowS: 2,
    seed: 7,
  });
  return { ...parsed, ...over } as CompareToolInput;
}

function textOf(result: CallToolResult): string {
  const item = result.content[0];
  if (item.type !== "text") throw new Error("expected a text item");
  return item.text;
}

let errorSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let stdoutSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  hooks.simulate = undefined;
  hooks.compare = undefined;
  hooks.listUsers = undefined;
  hooks.bypassValidation = false;
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("success results", () => {
  it("list_users: disclaimer, text equals JSON.stringify(structuredContent)", () => {
    const r = handleListUsers();
    expect(r.isError).toBeUndefined();
    expect(r.content).toHaveLength(1);
    expect(r.structuredContent?.disclaimer).toBe(DISCLAIMER);
    expect(textOf(r)).toBe(JSON.stringify(r.structuredContent));
  });

  it("simulate: disclaimer, text equals JSON.stringify(structuredContent)", () => {
    const r = handleSimulate(sim());
    expect(r.isError).toBeUndefined();
    expect(r.content).toHaveLength(1);
    expect(r.structuredContent?.disclaimer).toBe(DISCLAIMER);
    expect(r.structuredContent?.seed).toBe(7);
    expect(textOf(r)).toBe(JSON.stringify(r.structuredContent));
  });

  it("compare: disclaimer, text equals JSON.stringify(structuredContent)", () => {
    const r = handleCompare(cmp());
    expect(r.isError).toBeUndefined();
    expect(r.content).toHaveLength(1);
    expect(r.structuredContent?.disclaimer).toBe(DISCLAIMER);
    expect(textOf(r)).toBe(JSON.stringify(r.structuredContent));
  });

  it("keeps null fields null", () => {
    hooks.simulate = () => ({ seed: 1, users: [{ timeToSelectMs: { median: null, p90: null } }] }) as unknown as SimulateResult;
    const r = handleSimulate(sim());
    expect(r.structuredContent).toEqual({ seed: 1, users: [{ timeToSelectMs: { median: null, p90: null } }] });
    expect(textOf(r)).toBe('{"seed":1,"users":[{"timeToSelectMs":{"median":null,"p90":null}}]}');
  });
});

describe("validation errors", () => {
  const twoRest = {
    screen: { width: 800, height: 600 },
    targets: [{ id: "rest", rect: rect(400, 400), role: "rest-area" }],
  };
  const badWidth = {
    screen: { width: 800, height: 600 },
    targets: [{ id: "menu", rect: rect(40, 40, 0, 60) }],
  };
  const simCases: Array<[string, Record<string, unknown>]> = [
    ["UNKNOWN_PRESET", { users: ["nope"] }],
    ["OUT_OF_RANGE", { users: [] }],
    ["CAP_EXCEEDED", { trialsPerUser: 51 }],
    ["NOT_ALLOWED_VALUE", { fps: 20 }],
    ["UNSUPPORTED_MODE", { mode: "mouse" }],
    ["NO_SELECTABLE_TARGETS", { layout: twoRest }],
    ["UNKNOWN_TARGET", { task: ["menu", "zzz"] }],
    ["INVALID_LAYOUT", { layout: badWidth }],
    ["ADJACENT_REPEAT", { task: ["menu", "menu"] }],
    ["UNKNOWN_PARAMETER", { users: [{ name: "c", overrides: { colour: 1 } }] }],
  ];

  it.each(simCases)("simulate returns %s as isError with matching structuredContent", (code, over) => {
    const r = handleSimulate(sim(over));
    expect(r.isError).toBe(true);
    expect(r.content).toHaveLength(1);
    expect(r.structuredContent?.code).toBe(code);
    expect(r.structuredContent).toEqual(JSON.parse(textOf(r)));
    expect(textOf(r)).toBe(JSON.stringify(r.structuredContent));
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("compare returns LAYOUT_MISMATCH on b.layout", () => {
    const other = { screen: { width: 800, height: 600 }, targets: [{ id: "menu", rect: rect(40, 40) }, { id: "zzz", rect: rect(400, 40) }] };
    const r = handleCompare(cmp({ b: { profile: {}, layout: other } }));
    expect(r.isError).toBe(true);
    expect(r.structuredContent?.code).toBe("LAYOUT_MISMATCH");
    expect(r.structuredContent?.parameter).toBe("b.layout");
    expect(r.structuredContent).toEqual(JSON.parse(textOf(r)));
  });

  it("compare returns a validation error from the shared fields", () => {
    const r = handleCompare(cmp({ users: ["nope"] }));
    expect(r.isError).toBe(true);
    expect(r.structuredContent?.code).toBe("UNKNOWN_PRESET");
    expect(r.structuredContent).toEqual(JSON.parse(textOf(r)));
  });
});

describe("INTERNAL_ERROR", () => {
  it("simulate: no allowed, exact stderr line", () => {
    const boom = new Error("boom");
    hooks.simulate = () => {
      throw boom;
    };
    const r = handleSimulate(sim());
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toEqual({ code: "INTERNAL_ERROR", parameter: "", message: "The simulation failed: boom." });
    expect("allowed" in (r.structuredContent ?? {})).toBe(false);
    expect(textOf(r)).toBe(JSON.stringify(r.structuredContent));
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(`dwell-sim-mcp: INTERNAL_ERROR (seed 7): ${boom.stack}`);
  });

  it("strips one trailing period so the message never ends with '..'", () => {
    for (const msg of ["boom.", "boom"]) {
      hooks.simulate = () => {
        throw new Error(msg);
      };
      const r = handleSimulate(sim());
      expect(r.structuredContent?.message).toBe("The simulation failed: boom.");
    }
  });

  it("compare: no allowed, exact stderr line", () => {
    const boom = new Error("kaboom");
    hooks.compare = () => {
      throw boom;
    };
    const r = handleCompare(cmp({ seed: -3 }));
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toEqual({ code: "INTERNAL_ERROR", parameter: "", message: "The simulation failed: kaboom." });
    expect("allowed" in (r.structuredContent ?? {})).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(`dwell-sim-mcp: INTERNAL_ERROR (seed -3): ${boom.stack}`);
  });

  it("list_users: no allowed, stderr line without the seed part", () => {
    const boom = new Error("nope");
    hooks.listUsers = () => {
      throw boom;
    };
    const r = handleListUsers();
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toEqual({ code: "INTERNAL_ERROR", parameter: "", message: "The simulation failed: nope." });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(`dwell-sim-mcp: INTERNAL_ERROR: ${boom.stack}`);
  });

  it("NO_TRIALS thrown by the core becomes INTERNAL_ERROR (simulate and compare)", () => {
    hooks.bypassValidation = true;
    const s = handleSimulate(sim({ trialsPerUser: 0 }));
    expect(s.structuredContent?.code).toBe("INTERNAL_ERROR");
    expect(s.structuredContent?.parameter).toBe("");
    expect("allowed" in (s.structuredContent ?? {})).toBe(false);
    expect(errorSpy).toHaveBeenLastCalledWith(expect.stringContaining("dwell-sim-mcp: INTERNAL_ERROR (seed 7): SimulateError: trialsPerUser must be at least 1"));
    const c = handleCompare(cmp({ trialsPerUser: 0 }));
    expect(c.structuredContent?.code).toBe("INTERNAL_ERROR");
    expect(c.isError).toBe(true);
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });
});

describe("core errors rebuilt when validation is bypassed", () => {
  beforeEach(() => {
    hooks.bypassValidation = true;
  });

  it("ADJACENT_REPEAT with an explicit list uses task[{index}]", () => {
    const r = handleSimulate(sim({ task: ["menu", "ok", "ok"] }));
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toEqual({
      code: "ADJACENT_REPEAT",
      parameter: "task[2]",
      message:
        'Task entry 2 repeats target "ok" directly after entry 1, and the target has no autoRepeat. Entries are numbered from zero.',
    });
    expect(textOf(r)).toBe(JSON.stringify(r.structuredContent));
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("ADJACENT_REPEAT with eachTarget uses task.eachTarget", () => {
    const one = { screen: { width: 800, height: 600 }, targets: [{ id: "menu", rect: rect(40, 40) }] };
    const r = handleSimulate(sim({ layout: one, task: { eachTarget: 2 } }));
    expect(r.structuredContent).toEqual({
      code: "ADJACENT_REPEAT",
      parameter: "task.eachTarget",
      message:
        'Task entry 1 repeats target "menu" directly after entry 0, and the target has no autoRepeat. Entries are numbered from zero.',
    });
  });

  it("ADJACENT_REPEAT in compare", () => {
    const r = handleCompare(cmp({ task: ["menu", "menu"] }));
    expect(r.structuredContent?.code).toBe("ADJACENT_REPEAT");
    expect(r.structuredContent?.parameter).toBe("task[1]");
  });

  it("UNSUPPORTED_MODE has parameter mode and allowed", () => {
    const expected = {
      code: "UNSUPPORTED_MODE",
      parameter: "mode",
      message: 'Input mode "mouse" is not supported. Supported modes: head + dwell.',
      allowed: ["head + dwell"],
    };
    expect(handleSimulate(sim({ mode: "mouse" })).structuredContent).toEqual(expected);
    expect(handleCompare(cmp({ mode: "mouse" })).structuredContent).toEqual(expected);
  });

  it("LAYOUT_MISMATCH has parameter b.layout", () => {
    const other = { screen: { width: 800, height: 600 }, targets: [{ id: "menu", rect: rect(40, 40) }, { id: "zzz", rect: rect(400, 40) }] };
    const r = handleCompare(cmp({ b: { profile: {}, layout: other } }));
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toEqual({
      code: "LAYOUT_MISMATCH",
      parameter: "b.layout",
      message: "The two layouts must have the same target ids; differing: ok, rest, zzz.",
    });
    expect(textOf(r)).toBe(JSON.stringify(r.structuredContent));
  });
});

describe("stdout", () => {
  it("no handler writes to stdout or console.log, on success or error", () => {
    handleListUsers();
    handleSimulate(sim());
    handleCompare(cmp());
    handleSimulate(sim({ users: ["nope"] }));
    handleCompare(cmp({ users: ["nope"] }));
    hooks.simulate = () => {
      throw new Error("x");
    };
    hooks.compare = () => {
      throw new Error("y");
    };
    hooks.listUsers = () => {
      throw new Error("z");
    };
    handleSimulate(sim());
    handleCompare(cmp());
    handleListUsers();
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(3);
  });
});
