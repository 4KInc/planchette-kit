import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Planchette } from "@planchette/skeleton";

// Wraps the real createPlanchette to record every instance and its destroy() call. The
// behaviour is unchanged; this only counts instances created through the driver.
const created: Planchette[] = [];
const destroyed = new Set<Planchette>();
vi.mock("@planchette/skeleton", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@planchette/skeleton")>();
  return {
    ...actual,
    createPlanchette: (...args: Parameters<typeof actual.createPlanchette>): Planchette => {
      const pl = actual.createPlanchette(...args);
      const destroy = pl.destroy.bind(pl);
      pl.destroy = (): void => {
        destroyed.add(pl);
        destroy();
      };
      created.push(pl);
      return pl;
    },
  };
});

import { resolveUser } from "../src/resolve-user.js";
import { runUser, type RunUserConfig } from "../src/run-user.js";
import type { LayoutTarget, ResolvedUser } from "../src/types.js";

const target = (id: string, x: number, y: number, role: LayoutTarget["role"] = "default"): LayoutTarget => ({
  id,
  rect: { x, y, width: 160, height: 120 },
  autoRepeat: false,
  role,
});

const user = (name: string): ResolvedUser => {
  const r = resolveUser(name);
  if (!r.ok) throw new Error(`${name} must resolve`);
  return r.user;
};

const layout = {
  screen: { width: 800, height: 600 },
  targets: [target("rest", 620, 460, "rest-area"), target("a", 60, 60), target("b", 560, 60)],
};

const cfg = (u: ResolvedUser, trials: number, over: Partial<RunUserConfig> = {}): RunUserConfig => ({
  layout,
  profile: { dwellTime: 400 },
  user: u,
  mode: "head + dwell",
  task: ["a", "b"],
  fps: 30,
  analysisWindowMs: 5000,
  requestSeed: 7,
  trials,
  ...over,
});

beforeEach(() => {
  created.length = 0;
  destroyed.clear();
});

describe("runUser", () => {
  it("runs one trial per index 0..trials-1 and aggregates them", () => {
    const r = runUser(cfg(user("head-tremor"), 3));
    expect(r.trials.map((t) => t.trialIndex)).toEqual([0, 1, 2]);
    expect(r.trials.every((t) => t.userName === "head-tremor")).toBe(true);
    expect(r.metrics.userName).toBe("head-tremor");
    expect(r.metrics.trials).toBe(3);
    expect(r.metrics.intended + r.metrics.misses).toBe(3 * 2);
  });

  it("runs no trial for trials = 0", () => {
    const r = runUser(cfg(user("steady"), 0));
    expect(r.trials).toEqual([]);
    expect(r.metrics.trials).toBe(0);
    expect(r.metrics.intended).toBe(0);
    expect(created).toHaveLength(0);
  });

  it("uses a new engine instance for every trial and destroys each one", () => {
    runUser(cfg(user("steady"), 4));
    expect(created).toHaveLength(4);
    expect(new Set(created).size).toBe(4);
    expect(destroyed.size).toBe(4);
  });

  it("gives each trial its own draws (trials of a tremor user differ)", () => {
    const r = runUser(cfg(user("head-tremor"), 3));
    const times = r.trials.map((t) => t.entries.map((e) => e.timeToSelectMs));
    expect(new Set(times.map((t) => JSON.stringify(t))).size).toBeGreaterThan(1);
  });

  it("is deterministic for the same configuration", () => {
    expect(runUser(cfg(user("head-tremor"), 2))).toEqual(runUser(cfg(user("head-tremor"), 2)));
  });

  it("does not change a user's results when other users are added or removed", () => {
    const names = ["steady", "head-tremor", "small-range", "reads-while-pointing"];
    const run = (list: string[]): Map<string, ReturnType<typeof runUser>> => {
      const m = new Map<string, ReturnType<typeof runUser>>();
      for (const n of list) m.set(n, runUser(cfg(user(n), 2)));
      return m;
    };
    const alone = run(["head-tremor"]).get("head-tremor");
    const all = run(names).get("head-tremor");
    const reordered = run([...names].reverse()).get("head-tremor");
    const fewer = run(["head-tremor", "slow"]).get("head-tremor");
    expect(alone).toBeDefined();
    expect(all).toEqual(alone);
    expect(reordered).toEqual(alone);
    expect(fewer).toEqual(alone);
  });

  it("changes results when the request seed changes", () => {
    const a = runUser(cfg(user("head-tremor"), 2, { requestSeed: 1 }));
    const b = runUser(cfg(user("head-tremor"), 2, { requestSeed: 2 }));
    expect(a.trials).not.toEqual(b.trials);
  });
});
