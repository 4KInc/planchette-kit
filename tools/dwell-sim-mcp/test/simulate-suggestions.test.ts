import { describe, expect, it, vi } from "vitest";
import { resolveUser } from "../src/resolve-user.js";
import type { RunUserConfig } from "../src/run-user.js";
import { simulate } from "../src/simulate.js";
import type { Layout, LayoutTarget, ResolvedUser, SimulateRequest } from "../src/types.js";

// Records every config `simulate` (and the follow-up) passes to the real `runUser`.
const calls: RunUserConfig[] = [];
vi.mock("../src/run-user.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/run-user.js")>();
  return {
    ...actual,
    runUser: (cfg: RunUserConfig) => {
      calls.push(cfg);
      return actual.runUser(cfg);
    },
  };
});

const target = (id: string, x: number, y: number, w: number, h: number, role: LayoutTarget["role"] = "default"): LayoutTarget => ({
  id,
  rect: { x, y, width: w, height: h },
  autoRepeat: false,
  role,
});

const user = (input: Parameters<typeof resolveUser>[0]): ResolvedUser => {
  const r = resolveUser(input);
  if (!r.ok) throw new Error("user must resolve");
  return r.user;
};

const request = (layout: Layout, over: Partial<SimulateRequest> = {}): SimulateRequest => ({
  layout,
  profile: { dwellTime: 400 },
  mode: "head + dwell",
  users: [user("strong-head-tremor")],
  task: ["a", "b", "a", "b"],
  trialsPerUser: 4,
  fps: 30,
  analysisWindowS: 8,
  seed: 7,
  ...over,
});

const screen = { width: 800, height: 600 };

// Found by a one-off search (seed 7, dwell 400 ms, strong-head-tremor, 4 trials, task a b a b):
// two square targets of this size give a tremor-at-edge suggestion on "a". At 24 px the 1.25 multiple reaches
// zero events; at 16 px none of 1.25, 1.5 and 2 does.
const small = (size: number): Layout => ({
  screen,
  targets: [target("a", 100, 100, size, size), target("b", 600, 400, size, size)],
});

describe("simulate suggestions", () => {
  it("gives a tremor-at-edge suggestion with a value for a small target and a strong-tremor user", () => {
    // Small targets away from the centre; the 1.6 degree tremor at the edge of a 24 px target produces events.
    const layout = small(24);
    const result = simulate(request(layout));
    const s = result.suggestions.filter((x) => x.metric === "tremor-at-edge share");
    expect(s.length).toBeGreaterThan(0);
    expect(s[0].targetId).toBe("a");
    expect(s[0].value).toBeGreaterThan(0.5);
    expect(s[0].users).toEqual(["strong-head-tremor"]);
    expect(s[0].text.length).toBeGreaterThan(0);
  });

  it("sets followUp and appends its text when a multiple reaches zero", () => {
    const s = simulate(request(small(24))).suggestions.find((x) => x.metric === "tremor-at-edge share");
    expect(s?.followUp).toEqual({ factor: 1.25, overlaps: [] });
    expect(s?.text).toContain("1.25 times the current size");
  });

  it("leaves followUp unset and the text unchanged when no multiple reaches zero", () => {
    const s = simulate(request(small(16))).suggestions.find((x) => x.metric === "tremor-at-edge share");
    expect(s).toBeDefined();
    expect(s?.followUp).toBeUndefined();
    expect(s?.text).not.toContain("times the current size");
  });

  it("gives no suggestion for a clean layout", () => {
    const layout: Layout = { screen, targets: [target("a", 100, 100, 200, 150), target("b", 500, 350, 200, 150)] };
    expect(simulate(request(layout, { users: [user("steady")] })).suggestions).toEqual([]);
  });

  it("gives an unreachable suggestion with value null", () => {
    const layout: Layout = { screen, targets: [target("a", 0, 0, 20, 20), target("b", 600, 400, 160, 120)] };
    // Head range 3 degrees against a calibrated range of 10 degrees: the screen corner is out of reach.
    const profile = { calibrationRangeLeft: 10, calibrationRangeRight: 10, calibrationRangeUp: 10, calibrationRangeDown: 10 };
    const result = simulate(request(layout, { users: [user("small-range")], trialsPerUser: 1, profile }));
    const s = result.suggestions.filter((x) => x.metric === "unreachable");
    expect(s.length).toBeGreaterThan(0);
    expect(s[0].value).toBeNull();
  });

  it("returns the centre-hit suggestion for a centred target", () => {
    const layout: Layout = { screen, targets: [target("a", 350, 250, 100, 100), target("b", 600, 400, 160, 120)] };
    const result = simulate(request(layout, { users: [user("steady")], trialsPerUser: 1 }));
    const hit = result.suggestions.filter((x) => x.metric === "screen-centre-hit");
    expect(hit.map((x) => x.targetId)).toEqual(["a"]);
    expect(hit[0].value).toBeNull();
    expect(hit[0].users).toEqual([]);
    expect(hit[0].followUp).toBeUndefined();
  });

  it("is deterministic: the same request gives the same suggestions", () => {
    const layout = small(24);
    expect(simulate(request(layout)).suggestions).toEqual(simulate(request(layout)).suggestions);
  });

  it("runs the follow-up with the same seed, task, trials and the other settings, on a scaled target", () => {
    const layout = small(24);
    calls.length = 0;
    const req = request(layout);
    const result = simulate(req);
    const [original, ...extra] = calls;
    expect(result.suggestions.some((x) => x.followUp !== undefined)).toBe(true);
    expect(extra.length).toBe(1); // 1.25 reaches zero, so exactly one extra run
    expect(extra.length).toBeLessThanOrEqual(3);
    for (const c of extra) {
      expect(c.requestSeed).toBe(req.seed);
      expect(c.task).toEqual(original.task);
      expect(c.trials).toBe(original.trials);
      expect(c.fps).toBe(original.fps);
      expect(c.user).toBe(original.user);
      expect(c.layout.targets.find((t) => t.id === "a")!.rect.width).toBeCloseTo(30, 6);
    }
  });
});
