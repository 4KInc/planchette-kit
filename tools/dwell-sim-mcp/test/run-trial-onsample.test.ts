import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Planchette } from "@planchette/skeleton";
// Wraps the real createPlanchette to record every frame fed to the engine (now, yaw, pitch).
// The behaviour is unchanged.
const fed: Array<{ now: number; yaw: number; pitch: number }> = [];
vi.mock("@planchette/skeleton", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@planchette/skeleton")>();
  return {
    ...actual,
    createPlanchette: (...args: Parameters<typeof actual.createPlanchette>): Planchette => {
      const pl = actual.createPlanchette(...args);
      const feed = pl.feedSamples.bind(pl);
      pl.feedSamples = (batch): void => {
        for (const s of batch) {
          const f = s.faces?.[0];
          if (f === undefined || f.rotation === undefined) continue;
          fed.push({ now: s.now, yaw: f.rotation.yaw, pitch: f.rotation.pitch });
        }
        feed(batch);
      };
      return pl;
    },
  };
});
import { runTrial, type FramePhase, type TrialConfig } from "../src/run-trial.js";
import { resolveUser } from "../src/resolve-user.js";
import type { LayoutTarget, ResolvedUser } from "../src/types.js";

const target = (id: string, x: number, y: number, role: LayoutTarget["role"] = "default"): LayoutTarget => ({
  id,
  rect: { x, y, width: 160, height: 120 },
  autoRepeat: false,
  role,
});
const user: ResolvedUser = (() => {
  const r = resolveUser("steady");
  if (!r.ok) throw new Error("user must resolve");
  return r.user;
})();
const base = (targets: LayoutTarget[]): TrialConfig => ({
  layout: { screen: { width: 800, height: 600 }, targets },
  profile: { dwellTime: 400 },
  user,
  mode: "head + dwell",
  task: ["a", "b"],
  fps: 30,
  analysisWindowMs: 5000,
  requestSeed: 7,
  trialIndex: 0,
});
const withRest = [target("rest", 620, 460, "rest-area"), target("a", 60, 60), target("b", 560, 60)];

beforeEach(() => {
  fed.length = 0;
});

describe("observers.onSample", () => {
  it("sees every fed frame, in increasing now order, phases warmup then start then entry", () => {
    const seen: Array<{ now: number; yaw: number; pitch: number; phase: FramePhase }> = [];
    runTrial({
      ...base(withRest),
      observers: {
        onSample: (now, rotation, phase) => {
          seen.push({ now, yaw: rotation.yaw, pitch: rotation.pitch, phase });
        },
      },
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.length).toBe(fed.length);
    expect(seen.map(({ now, yaw, pitch }) => ({ now, yaw, pitch }))).toEqual(fed);
    for (let i = 1; i < seen.length; i++) expect(seen[i].now).toBeGreaterThan(seen[i - 1].now);
    const order = { warmup: 0, start: 1, entry: 2 } as const;
    for (let i = 1; i < seen.length; i++) {
      expect(order[seen[i].phase]).toBeGreaterThanOrEqual(order[seen[i - 1].phase]);
    }
    expect(new Set(seen.map((s) => s.phase))).toEqual(new Set(["warmup", "start", "entry"]));
    expect(seen[0].phase).toBe("warmup");
    expect(seen[seen.length - 1].phase).toBe("entry");
  });

  it("has no start phase without a rest area", () => {
    const phases = new Set<FramePhase>();
    runTrial({
      ...base([target("a", 60, 60), target("b", 560, 60)]),
      observers: { onSample: (_n, _r, phase) => void phases.add(phase) },
    });
    expect(phases.has("warmup")).toBe(true);
    expect(phases.has("entry")).toBe(true);
    expect(phases.has("start")).toBe(false);
  });

  it("leaves the trial result identical with and without the hook", () => {
    const without = runTrial(base(withRest));
    const countWithout = fed.length;
    fed.length = 0;
    let calls = 0;
    const withHook = runTrial({ ...base(withRest), observers: { onSample: () => void calls++ } });
    expect(withHook).toEqual(without);
    expect(calls).toBe(countWithout);
  });

  it("calls nothing when the hook is absent", () => {
    const onEvent = vi.fn();
    expect(() => runTrial({ ...base(withRest), observers: { onEvent } })).not.toThrow();
    expect(fed.length).toBeGreaterThan(0);
  });
});
