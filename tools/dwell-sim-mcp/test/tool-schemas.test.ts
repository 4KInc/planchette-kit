import { describe, expect, it } from "vitest";
import { z } from "zod";
import { compare, type CompareRequest } from "../src/compare.js";
import { listUsers } from "../src/list-users.js";
import { presetParams, resolveUser } from "../src/resolve-user.js";
import { simulate } from "../src/simulate.js";
import {
  CompareInput,
  CompareInputSchema,
  CompareOutputSchema,
  ListUsersInput,
  ListUsersInputSchema,
  ListUsersOutputSchema,
  SimulateInputSchema,
  SimulateOutputSchema,
  type SimulateToolInput,
} from "../src/tool-schemas.js";
import type { Layout, ResolvedUser, SimulateRequest } from "../src/types.js";

const layoutInput = {
  screen: { width: 800, height: 600 },
  targets: [
    { id: "a", rect: { x: 60, y: 60, width: 160, height: 120 } },
    { id: "b", rect: { x: 560, y: 60, width: 160, height: 120 } },
    { id: "cancel", rect: { x: 330, y: 460, width: 160, height: 120 }, role: "cancel" },
    { id: "rest", rect: { x: 620, y: 460, width: 160, height: 120 }, role: "rest-area", autoRepeat: false },
  ],
};

// Conversion used by the tests only. Validation and user resolution for the server belong to Task 14.2.
function toLayout(l: SimulateToolInput["layout"]): Layout {
  return {
    screen: l.screen,
    targets: l.targets.map((t) => ({ id: t.id, rect: t.rect, autoRepeat: t.autoRepeat ?? false, role: t.role ?? "default" })),
  };
}
function toUsers(users: SimulateToolInput["users"]): ResolvedUser[] {
  return users.map((u) => {
    const r = resolveUser(u);
    if (!r.ok) throw new Error(r.error.message);
    return r.user;
  });
}
function toFps(n: number): SimulateRequest["fps"] {
  if (n === 15 || n === 30 || n === 60) return n;
  throw new Error("fps");
}
function toSimulateRequest(p: SimulateToolInput): SimulateRequest {
  return {
    layout: toLayout(p.layout),
    profile: p.profile ?? {},
    mode: "head + dwell",
    users: toUsers(p.users),
    task: p.task,
    trialsPerUser: p.trialsPerUser,
    fps: toFps(p.fps),
    analysisWindowS: p.analysisWindowS,
    seed: p.seed,
  };
}

const validSimulate = { layout: layoutInput, users: ["steady"], task: ["a", "b"], trialsPerUser: 1, analysisWindowS: 5 };

/** Collect every object property of a JSON schema and report those without a description. */
function missingDescriptions(node: unknown, path = "$"): string[] {
  if (node === null || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((n, i) => missingDescriptions(n, `${path}[${i}]`));
  const record = node as Record<string, unknown>;
  const out: string[] = [];
  const props = record.properties;
  if (props !== undefined && typeof props === "object" && props !== null) {
    for (const [key, value] of Object.entries(props)) {
      const v = value as Record<string, unknown>;
      if (typeof v.description !== "string" || v.description === "") out.push(`${path}.${key}`);
      out.push(...missingDescriptions(v, `${path}.${key}`));
    }
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === "properties") continue;
    out.push(...missingDescriptions(value, `${path}.${key}`));
  }
  return out;
}

describe("input schemas", () => {
  it("parses a valid simulate request and applies the defaults", () => {
    const p = SimulateInputSchema.parse({ layout: layoutInput, users: ["steady", { name: "c", overrides: { reactionTimeMs: 300 } }], task: { eachTarget: 2 } });
    expect(p.seed).toBe(1);
    expect(p.fps).toBe(30);
    expect(p.analysisWindowS).toBe(10);
    expect(p.trialsPerUser).toBe(10);
    expect(p.mode).toBe("head + dwell");
  });

  it("accepts every mode name so validation can reject it", () => {
    for (const mode of ["scan", "head + gesture", "gesture scan", "mouse"]) {
      expect(SimulateInputSchema.safeParse({ ...validSimulate, mode }).success).toBe(true);
    }
    expect(SimulateInputSchema.safeParse({ ...validSimulate, mode: "voice" }).success).toBe(false);
  });

  it("does not check ranges, which validation does", () => {
    expect(SimulateInputSchema.safeParse({ ...validSimulate, fps: 24, trialsPerUser: 500, seed: 1.5 }).success).toBe(true);
  });

  it("parses a valid compare request; b may omit its layout", () => {
    const p = CompareInputSchema.parse({ a: { layout: layoutInput, profile: { dwellTime: 1000 }, label: "x" }, b: { profile: { dwellTime: 1400 } }, users: ["steady"], task: ["a", "b"] });
    expect(p.b.layout).toBeUndefined();
    expect(p.seed).toBe(1);
    expect(p.fps).toBe(30);
    expect(p.analysisWindowS).toBe(10);
    expect(p.trialsPerUser).toBe(10);
  });

  it("rejects wrong types", () => {
    const bad: Record<string, unknown>[] = [
      { ...validSimulate, seed: "1" },
      { ...validSimulate, fps: "30" },
      { ...validSimulate, users: "steady" },
      { ...validSimulate, users: [3] },
      { ...validSimulate, task: "a" },
      { ...validSimulate, task: { eachTarget: "2" } },
      { ...validSimulate, layout: { ...layoutInput, targets: "none" } },
      { ...validSimulate, layout: { ...layoutInput, targets: [{ id: 1, rect: layoutInput.targets[0].rect }] } },
      { ...validSimulate, layout: { ...layoutInput, targets: [{ id: "a", rect: layoutInput.targets[0].rect, role: "boss" }] } },
      { ...validSimulate, users: [{ name: "c", overrides: { notAParameter: 1 } }] },
      { ...validSimulate, users: [{ name: "c", overrides: { reactionTimeMs: "fast" } }] },
      { users: ["steady"], task: ["a"] },
    ];
    for (const input of bad) expect(SimulateInputSchema.safeParse(input).success).toBe(false);
    expect(CompareInputSchema.safeParse({ a: { layout: layoutInput }, b: { label: 3 }, users: ["steady"], task: ["a"] }).success).toBe(false);
    expect(CompareInputSchema.safeParse({ b: {}, users: ["steady"], task: ["a"] }).success).toBe(false);
  });

  it("has an empty input shape for list_users", () => {
    expect(Object.keys(ListUsersInput)).toEqual([]);
    expect(ListUsersInputSchema.safeParse({}).success).toBe(true);
  });

  it("describes every field of the input and output schemas", () => {
    const inputs = [SimulateInputSchema, CompareInputSchema, ListUsersInputSchema];
    const outputs = [SimulateOutputSchema, CompareOutputSchema, ListUsersOutputSchema];
    for (const s of inputs) expect(missingDescriptions(z.toJSONSchema(s, { io: "input" }))).toEqual([]);
    for (const s of outputs) expect(missingDescriptions(z.toJSONSchema(s, { io: "output" }))).toEqual([]);
    expect(Object.keys(CompareInput)).toContain("a");
  });
});

const causes = { "reading-pause": 0, "pass-over": 1, "tremor-at-edge": 3, repeat: 0, waiting: 0, "early-on-intended-target": 0, other: 0 };
const activities = { waiting: 0, moving: 1, "reading pause": 0, "holding on the aim point": 3 };
const profileFull = { dwellTime: 1000, headGain: 1 };
const exampleLayout = {
  screen: { width: 1280, height: 720 },
  targets: [
    { id: "menu", rect: { x: 40, y: 40, width: 200, height: 120 } },
    { id: "rest", rect: { x: 540, y: 600, width: 200, height: 80 }, role: "rest-area" },
  ],
};
const disclaimer = "Simulated users are models from published group averages, not real people. Use these results to compare layouts and settings.";

/** The design section 11 simulate example, with the elided parts filled in and `startCount` on the user row. */
function simulateExample(): Record<string, unknown> {
  return {
    seed: 1,
    parameters: {
      mode: "head + dwell",
      fps: 30,
      analysisWindowS: 10,
      trialsPerUser: 10,
      task: { eachTarget: 2 },
      profile: { dwellTime: 1000 },
      layout: exampleLayout,
      users: [{ name: "head-tremor", params: presetParams("head-tremor"), effectiveProfile: profileFull }],
    },
    users: [
      {
        name: "head-tremor",
        trials: 10,
        intended: 38,
        accidental: 4,
        startCount: 1,
        accidentalPer100Intended: 10.5,
        startOfSession: { count: 1, byTarget: [{ targetId: "menu", count: 1 }] },
        misses: 2,
        timeToSelectMs: { median: 2310, p90: 3590 },
        causes,
        activities,
        perTarget: [
          { targetId: "ghost", intended: 4, accidental: 3, startCount: 0, accidentalPer100Intended: 75, misses: 1, timeToSelectMs: { median: 2100, p90: 2900 }, causes, activities },
        ],
      },
    ],
    accidentalSelections: [
      { user: "head-tremor", trial: 3, targetId: "ghost", timeMs: 18420, activity: "holding on the aim point", cause: "tremor-at-edge" },
    ],
    suggestions: [
      { targetId: "ghost", metric: "tremor-at-edge share", value: 0.75, users: ["head-tremor"], text: "larger target" },
      { targetId: "menu", metric: "screen-centre-hit", value: null, users: [], text: "The screen centre lies inside target \"menu\"." },
    ],
    warnings: ["NO_REST_AREA: the layout has no rest-area target. Accessibility rule: every layout has a rest area."],
    notes: ["TREMOR_ABOVE_TUNED: user strong-head-tremor has tremor 1.6° peak to peak, above the 1° the smoothing is tuned for."],
    disclaimer,
  };
}

describe("simulate output schema", () => {
  it("parses the design example", () => {
    const r = SimulateOutputSchema.safeParse(simulateExample());
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.suggestions.map((s) => s.value)).toEqual([0.75, null]);
      expect(r.data.users[0].startOfSession.count).toBe(1);
    }
  });

  it("accepts a suggestion with a follow-up, and a null target in byTarget", () => {
    const ex = simulateExample();
    (ex.suggestions as Record<string, unknown>[])[0].followUp = { factor: 1.5, overlaps: ["rest"] };
    const users = ex.users as { startOfSession: { byTarget: unknown[] } }[];
    users[0].startOfSession.byTarget.push({ targetId: null, count: 0 });
    expect(SimulateOutputSchema.safeParse(ex).success).toBe(true);
  });

  it("rejects malformed suggestions", () => {
    const withSuggestion = (s: Record<string, unknown>) => {
      const ex = simulateExample();
      ex.suggestions = [s];
      return SimulateOutputSchema.safeParse(ex).success;
    };
    const good = { targetId: "menu", metric: "unreachable", value: null, users: ["steady"], text: "t" };
    expect(withSuggestion(good)).toBe(true);
    expect(withSuggestion({ targetId: "menu", metric: "unreachable", users: [], text: "t" })).toBe(false);
    expect(withSuggestion({ ...good, metric: "tremor-at-edge share (0.75)" })).toBe(false);
    expect(withSuggestion({ ...good, metric: "reading-pause" })).toBe(false);
    expect(withSuggestion({ ...good, value: "0.75" })).toBe(false);
    expect(withSuggestion({ ...good, value: undefined })).toBe(false);
    expect(withSuggestion({ ...good, followUp: { factor: "1.5", overlaps: [] } })).toBe(false);
  });

  it("rejects the cause `start`", () => {
    const ex = simulateExample();
    (ex.accidentalSelections as Record<string, unknown>[])[0].cause = "start";
    expect(SimulateOutputSchema.safeParse(ex).success).toBe(false);
  });
});

describe("compare and list_users output schemas", () => {
  const side = (label: string, dwell: number) => ({
    label,
    layout: exampleLayout,
    profile: { dwellTime: dwell },
    effectiveProfiles: [{ user: "steady", effectiveProfile: profileFull }],
  });
  const compareExample = {
    seed: 1,
    parameters: {
      shared: { mode: "head + dwell", fps: 30, analysisWindowS: 10, trialsPerUser: 10, task: { eachTarget: 2 }, users: [{ name: "steady", params: presetParams("steady") }] },
      a: side("dwell 1000", 1000),
      b: side("dwell 1400", 1400),
    },
    metrics: {
      accidental: { aWins: 14, bWins: 22, ties: 24, verdict: "b did better" },
      misses: { aWins: 3, bWins: 3, ties: 54, verdict: "tie" },
      timeToSelect: { aWins: 20, bWins: 31, ties: 5, verdict: "b did better", pairedTrials: 56 },
    },
    pairs: [
      { user: "steady", trial: 0, a: { accidental: 1, misses: 0, medianTimeMs: 2200 }, b: { accidental: 0, misses: 0, medianTimeMs: 2050 } },
      { user: "steady", trial: 1, a: { accidental: 0, misses: 2, medianTimeMs: null }, b: { accidental: 0, misses: 2, medianTimeMs: null } },
    ],
    statement: "These counts are not a test of statistical significance.",
    warnings: ["A: NO_CANCEL_TARGET: the layout has no cancel-role target."],
    notes: [],
    disclaimer,
  };

  it("parses the compare example and rejects a bad verdict", () => {
    expect(CompareOutputSchema.safeParse(compareExample).success).toBe(true);
    const bad = structuredClone(compareExample);
    bad.metrics.misses.verdict = "draw";
    expect(CompareOutputSchema.safeParse(bad).success).toBe(false);
  });

  it("parses the list_users example, with a string and a citation source", () => {
    const example = {
      users: [
        {
          name: "steady",
          description: "…",
          parameters: {
            throughputBitsPerS: { value: 1.42, source: "Head pointing throughput, mobile head tracker [5]" },
            tremorPeakToPeakDeg: { value: 0, source: "chosen: no tremor" },
            scatterCapDeg: { value: 0.6, source: { row: "r", ref: 3, citation: "c", note: "n" } },
          },
        },
      ],
      customRanges: { throughputBitsPerS: { min: 0.3, max: 4, unit: "bits/s" } },
      disclaimer,
    };
    expect(ListUsersOutputSchema.safeParse(example).success).toBe(true);
    expect(ListUsersOutputSchema.safeParse({ ...example, customRanges: { x: { min: 0.3 } } }).success).toBe(false);
  });

  it("parses the real list_users result", () => {
    expect(ListUsersOutputSchema.safeParse(listUsers()).success).toBe(true);
  });
});

describe("schemas against real results", () => {
  it("echoes the default seed 1 and the simulate result parses", () => {
    const parsed = SimulateInputSchema.parse(validSimulate);
    expect(parsed.seed).toBe(1);
    const result = simulate(toSimulateRequest(parsed));
    expect(result.seed).toBe(1);
    expect(result.parameters.analysisWindowS).toBe(5);
    const out = SimulateOutputSchema.safeParse(result);
    expect(out.success, out.success ? "" : JSON.stringify(out.error.issues)).toBe(true);
  });

  it("parses a simulate result with suggestions and accidental selections", () => {
    const parsed = SimulateInputSchema.parse({
      layout: { screen: { width: 800, height: 600 }, targets: [{ id: "a", rect: { x: 340, y: 240, width: 120, height: 120 } }] },
      users: ["head-tremor"],
      task: ["a", "a", "a"].slice(0, 1),
      trialsPerUser: 1,
      analysisWindowS: 5,
    });
    const result = simulate(toSimulateRequest(parsed));
    expect(result.suggestions.some((s) => s.metric === "screen-centre-hit" && s.value === null)).toBe(true);
    const out = SimulateOutputSchema.safeParse(result);
    expect(out.success, out.success ? "" : JSON.stringify(out.error.issues)).toBe(true);
  });

  it("parses a real compare result", () => {
    const parsed = CompareInputSchema.parse({
      a: { layout: layoutInput, profile: { dwellTime: 400 }, label: "fast" },
      b: { profile: { dwellTime: 1200 } },
      users: ["steady"],
      task: ["a", "b"],
      trialsPerUser: 1,
      analysisWindowS: 5,
    });
    const request: CompareRequest = {
      a: { layout: toLayout(parsed.a.layout), ...(parsed.a.profile ? { profile: parsed.a.profile } : {}), ...(parsed.a.label ? { label: parsed.a.label } : {}) },
      b: { ...(parsed.b.profile ? { profile: parsed.b.profile } : {}) },
      mode: "head + dwell",
      users: toUsers(parsed.users),
      task: parsed.task,
      trialsPerUser: parsed.trialsPerUser,
      fps: toFps(parsed.fps),
      analysisWindowS: parsed.analysisWindowS,
      seed: parsed.seed,
    };
    const result = compare(request);
    expect(result.seed).toBe(1);
    const out = CompareOutputSchema.safeParse(result);
    expect(out.success, out.success ? "" : JSON.stringify(out.error.issues)).toBe(true);
  });
});
