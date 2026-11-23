import { describe, expect, it } from "vitest";
import { followUp, scaleAndClip, type FollowUpRunner, type FollowUpUser } from "../src/follow-up.js";
import { resolveUser } from "../src/resolve-user.js";
import type { RunUserConfig } from "../src/run-user.js";
import type { ResolvedUser } from "../src/types.js";
import { layoutOf, target, trial, type TrialSpec } from "./suggest-fixtures.js";

const resolved = (name: string): ResolvedUser => {
  const r = resolveUser(name);
  if (!r.ok) throw new Error(`${name} must resolve`);
  return r.user;
};

const layout = layoutOf(target("a", 400, 200, 100, 50), target("b", 520, 200, 100, 50), target("far", 50, 500));

const makeUser = (name: string, spec: TrialSpec): FollowUpUser => {
  const config: RunUserConfig = {
    layout,
    profile: {},
    user: resolved("strong-head-tremor"),
    mode: "head + dwell",
    task: ["a", "b"],
    fps: 30,
    analysisWindowMs: 5000,
    requestSeed: 7,
    trials: 2,
  };
  return { name, trials: [trial(name, spec)], config: { ...config, user: { ...config.user, name } } };
};

const withEvents: TrialSpec = { misses: [{ target: "a", cause: "tremor-at-edge" }] };
const noEvents: TrialSpec = { misses: [{ target: "far", cause: "other" }], starts: ["a"] };

interface Call {
  userName: string;
  width: number;
  seed: number;
  task: readonly string[];
  trials: number;
}

/** A stub runner: events on `a` while the rectangle is narrower than `zeroAtWidth`. */
function stub(zeroAtWidth: number): { runner: FollowUpRunner; calls: Call[] } {
  const calls: Call[] = [];
  const runner: FollowUpRunner = (cfg) => {
    const t = cfg.layout.targets.find((x) => x.id === "a");
    const width = t?.rect.width ?? 0;
    calls.push({ userName: cfg.user.name, width, seed: cfg.requestSeed, task: cfg.task, trials: cfg.trials });
    return { trials: [trial(cfg.user.name, width >= zeroAtWidth ? {} : withEvents)] };
  };
  return { runner, calls };
}

describe("followUp", () => {
  const users = [makeUser("u1", withEvents), makeUser("u2", noEvents), makeUser("u3", withEvents)];

  it("stops at the first multiple with zero events and states it", () => {
    const { runner, calls } = stub(150);
    const r = followUp({ layout, targetId: "a", users, runner });
    expect(r.followUp?.factor).toBe(1.5);
    expect(r.runs).toBe(2);
    expect(new Set(calls.map((c) => c.width))).toEqual(new Set([125, 150]));
    expect(r.text).toContain("1.5");
  });

  it("makes at most 3 runs and gives no follow-up size when none reaches zero", () => {
    const { runner, calls } = stub(Infinity);
    const r = followUp({ layout, targetId: "a", users, runner });
    expect(r.followUp).toBeUndefined();
    expect(r.text).toBe("");
    expect(r.runs).toBe(3);
    expect(calls.length).toBe(3 * 2);
  });

  it("reruns only users with events on the target, with the same seed, task and trials", () => {
    const { runner, calls } = stub(125);
    followUp({ layout, targetId: "a", users, runner });
    expect(calls.map((c) => c.userName)).toEqual(["u1", "u3"]);
    for (const c of calls) {
      expect(c.seed).toBe(7);
      expect(c.task).toEqual(["a", "b"]);
      expect(c.trials).toBe(2);
    }
  });

  it("reports overlaps with other targets in the follow-up record and text", () => {
    const { runner } = stub(150); // 1.5 x 100 = 150 wide: x 375..525 overlaps b at 520
    const r = followUp({ layout, targetId: "a", users, runner });
    expect(r.followUp).toEqual({ factor: 1.5, overlaps: ["b"] });
    expect(r.text).toContain("overlaps b");
    const r2 = followUp({ layout, targetId: "a", users, runner: stub(125).runner });
    expect(r2.followUp).toEqual({ factor: 1.25, overlaps: [] });
    expect(r2.text).not.toContain("overlaps");
  });

  it("makes no run when no user had events on the target", () => {
    const { runner, calls } = stub(125);
    const r = followUp({ layout, targetId: "a", users: [makeUser("u2", noEvents)], runner });
    expect(r.runs).toBe(0);
    expect(calls).toEqual([]);
    expect(r.followUp).toBeUndefined();
  });
});

describe("scaleAndClip", () => {
  const screen = { width: 1001, height: 601 };
  it("scales about the centre", () => {
    expect(scaleAndClip({ x: 100, y: 100, width: 100, height: 40 }, 2, screen)).toEqual({
      x: 50,
      y: 80,
      width: 200,
      height: 80,
    });
  });
  it("crops (does not shift) at the screen edge", () => {
    expect(scaleAndClip({ x: 0, y: 0, width: 100, height: 50 }, 2, screen)).toEqual({
      x: 0,
      y: 0,
      width: 150,
      height: 75,
    });
  });
});
