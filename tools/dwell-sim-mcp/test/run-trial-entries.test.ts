import { describe, expect, it } from "vitest";
import { resolveUser } from "../src/resolve-user.js";
import {
  openTrial,
  pushEvent,
  runEntries,
  runStartOfSession,
  runTrial,
  runWarmup,
  type TrialConfig,
  type TrialDriver,
} from "../src/run-trial.js";
import type { LayoutTarget, RawEvent, ResolvedUser } from "../src/types.js";

const target = (id: string, x: number, y: number, role: LayoutTarget["role"] = "default"): LayoutTarget => ({
  id,
  rect: { x, y, width: 160, height: 120 },
  autoRepeat: false,
  role,
});

const steady = (): ResolvedUser => {
  const r = resolveUser("steady");
  if (!r.ok) throw new Error("steady preset must resolve");
  return r.user;
};

/** Worked example layout: 800 x 600 screen, rest area bottom right, targets a (top left) and b (top right). */
const targets = [target("rest", 620, 460, "rest-area"), target("a", 60, 60), target("b", 560, 60)];

const cfg = (over: Partial<TrialConfig> = {}): TrialConfig => ({
  layout: { screen: { width: 800, height: 600 }, targets },
  profile: { dwellTime: 400 },
  user: steady(),
  mode: "head + dwell",
  task: ["a", "b"],
  fps: 30,
  analysisWindowMs: 10000,
  requestSeed: 1,
  trialIndex: 0,
  ...over,
});

interface Run {
  d: TrialDriver;
  seen: RawEvent[];
  /** Every frame time fed to the skeleton, in order. */
  frames: number[];
}

/**
 * Runs warm-up, start and entries on an open driver. `hook` runs inside the observer, i.e.
 * while the engine emits an event, so it can push extra events into the queue by hand.
 */
function run(c: TrialConfig, hook?: (e: RawEvent, d: TrialDriver) => void): Run {
  const seen: RawEvent[] = [];
  const frames: number[] = [];
  let driver: TrialDriver | undefined;
  const d = openTrial({
    ...c,
    observers: {
      onEvent: (e) => {
        seen.push({ ...e });
        if (hook !== undefined && driver !== undefined) hook(e, driver);
      },
    },
  });
  driver = d;
  let now = 0;
  Object.defineProperty(d.sample, "now", {
    get: () => now,
    set: (v: number) => {
      now = v;
      frames.push(v);
    },
  });
  runWarmup(d);
  const s = runStartOfSession(d);
  runEntries(d, s);
  d.pl.destroy();
  return { d, seen, frames };
}

describe("entry loop", () => {
  it("selects an intended target and measures time-to-select from tMove0", () => {
    const { d, seen } = run(cfg({ task: ["a"] }));
    expect(d.entries).toHaveLength(1);
    const e = d.entries[0];
    expect(e.outcome).toBe("selected");
    expect(e.missCause).toBeNull();
    const ev = seen.find((x) => x.targetId === "a");
    expect(ev).toBeDefined();
    expect(e.timeToSelectMs).toBe((ev as RawEvent).now - d.plans[0].tMove0);
    expect(d.plans[0].tMove0).toBe(d.plans[0].tEntry + 500);
    expect(d.accidental).toEqual([]);
  });

  it("a miss moves on to the next entry at the deadline frame (Req 11 AC 11)", () => {
    const { d, frames } = run(cfg({ analysisWindowMs: 300 }));
    expect(d.entries[0]).toMatchObject({ entry: 0, outcome: "miss", timeToSelectMs: null, missCause: "other" });
    expect(d.entries).toHaveLength(2);
    expect(d.entries.map((x) => x.entry)).toEqual([0, 1]);
    // The plan's last segment ends after the deadline, yet the entry ends at the deadline frame.
    const p0 = d.plans[0];
    const lastSeg = p0.segments[p0.segments.length - 1];
    expect(lastSeg.t1).toBeGreaterThan(p0.deadline);
    const frameMs = d.frameMs;
    const deadlineFrame = Math.ceil(p0.deadline / frameMs - 1e-9);
    const p1 = d.plans[1];
    expect(p1.tEntry).toBeCloseTo(deadlineFrame * frameMs, 9);
    expect(p1.tEntry).toBeGreaterThanOrEqual(p0.deadline);
    expect(p1.tEntry - p0.deadline).toBeLessThan(frameMs);
    // The next entry starts from the base pose of the previous plan at that time.
    expect(p1.segments[0]).toMatchObject({ kind: "hold", phase: "waiting" });
    const hold = p1.segments[0];
    expect(hold.kind === "hold" ? hold.pose : null).toEqual(d.head.basePose(p0, p1.tEntry));
    // Frames form one sequence on the grid: none is skipped, repeated or fed after the deadline frame for entry 0.
    frames.forEach((f, i) => expect(f).toBeCloseTo(i * frameMs, 6));
    const fedForEntry0 = frames.filter((f) => f >= p0.tEntry && f <= p1.tEntry);
    expect(fedForEntry0[fedForEntry0.length - 1]).toBeCloseTo(p1.tEntry, 9);
    expect(fedForEntry0.filter((f) => f > p0.deadline)).toHaveLength(1);
  });

  it("an unreachable target is a miss with cause unreachable", () => {
    const small = resolveUser({
      name: "small",
      overrides: { headRangeDeg: { left: 3, right: 3, up: 3, down: 3 } },
    });
    if (!small.ok) throw new Error("custom user must resolve");
    const c = cfg({
      user: small.user,
      profile: {
        dwellTime: 400,
        calibrationRangeLeft: 20,
        calibrationRangeRight: 20,
        calibrationRangeUp: 20,
        calibrationRangeDown: 20,
      },
      layout: { screen: { width: 800, height: 600 }, targets: [target("far", 0, 0), target("near", 360, 240)] },
      task: ["far", "near"],
      analysisWindowMs: 4000,
    });
    const { d, seen } = run(c);
    expect(d.entries[0]).toMatchObject({ entry: 0, targetId: "far", outcome: "miss", missCause: "unreachable" });
    expect(seen.some((e) => e.targetId === "far")).toBe(false);
    expect(d.entries).toHaveLength(2);
  });

  it("an intended event on the deadline frame wins; one frame earlier it is a miss", () => {
    const ref = run(cfg({ task: ["a"] }));
    const tts = ref.d.entries[0].timeToSelectMs as number;
    const frameMs = ref.d.frameMs;
    // Deadline 1 ms before the event: the event frame is the deadline frame.
    const win = run(cfg({ task: ["a"], analysisWindowMs: tts - 1 }));
    expect(win.d.entries[0].outcome).toBe("selected");
    expect(win.d.entries[0].timeToSelectMs).toBe(tts);
    expect(tts).toBeGreaterThan(tts - 1);
    expect(tts - (tts - 1)).toBeLessThan(frameMs);
    // Deadline 1.5 frames before the event: the deadline frame comes before the dwell completes.
    const lose = run(cfg({ task: ["a"], analysisWindowMs: tts - 1.5 * frameMs }));
    expect(lose.d.entries[0]).toMatchObject({ outcome: "miss", timeToSelectMs: null });
    expect(lose.seen.filter((e) => e.targetId === "a")).toEqual([]);
  });

  it("two events in one frame: the second is classified under plan k+1 with entry = k+1", () => {
    const { d, seen } = run(cfg(), (e, drv) => {
      if (e.targetId === "a" && e.kind === "select") pushEvent(drv.queue, "select", "b", e.now);
    });
    expect(d.entries.map((x) => x.outcome)).toEqual(["selected", "selected"]);
    expect(d.accidental).toEqual([
      { targetId: "b", timeMs: seen[0].now, activity: "waiting", cause: "waiting", entry: 1 },
    ]);
    expect(d.plans[1].tEntry).toBe(seen[0].now);
  });

  it("events in the final frame after the last entry resolves keep the last entry's index; no later frame is fed", () => {
    const { d, seen, frames } = run(cfg({ task: ["a"] }), (e, drv) => {
      if (e.targetId === "a") {
        pushEvent(drv.queue, "cancel", undefined, e.now);
        pushEvent(drv.queue, "select", "a", e.now); // would classify as intended
      }
    });
    const now = seen[0].now;
    expect(d.entries).toHaveLength(1);
    expect(d.entries[0].outcome).toBe("selected");
    expect(d.accidental).toEqual([
      { targetId: null, timeMs: now, activity: "holding on the aim point", cause: "other", entry: 0 },
      { targetId: "a", timeMs: now, activity: "holding on the aim point", cause: "other", entry: 0 },
    ]);
    expect(frames[frames.length - 1]).toBe(now);
    expect((d.k - 1) * d.frameMs).toBe(now);
  });

  it("observers.onEvent sees every engine event, each classified once", () => {
    const { d, seen } = run(cfg());
    const selected = d.entries.filter((e) => e.outcome === "selected").length;
    expect(seen.length).toBe(d.startEvents.length + selected + d.accidental.length);
  });

  it("runTrial returns the whole result and repeats exactly", () => {
    const a = runTrial(cfg());
    expect(a.entries.map((e) => e.entry)).toEqual([0, 1]);
    expect(a.userName).toBe("steady");
    expect(a.effectiveProfile.mode).toBe("head + dwell");
    expect(runTrial(cfg())).toEqual(a);
  });
});

describe("worked trace: steady preset, two entries", () => {
  // Layout: screen 800 x 600; rest area (620, 460, 160 x 120); a (60, 60, 160 x 120); b (560, 60, 160 x 120).
  // Task a, b. fps 30 (33.33 ms per frame), dwellTime 400, analysis window 10 s, seed 1.
  it("matches the numbers in the report", () => {
    const { d, seen } = run(cfg());
    const frameMs = d.frameMs;
    const round = (x: number): number => Math.round(x * 10) / 10;

    // Warm-up ends with the centre step at 1500 ms; no events in it.
    expect(d.tDone).toBe(1500);
    expect(d.startEvents).toEqual([]);

    // Start plan: reaction hold 1500..2000, then the move to the rest area, ending at 3086.6.
    expect(round(d.plans[0].tEntry)).toBe(3086.6);

    // Entry 0: waiting, moving, holding.
    const e0 = d.plans[0];
    expect(e0.segments.map((s) => [s.kind, s.phase, round(s.t0), round(s.t1)])).toEqual([
      ["hold", "waiting", 3086.6, 3586.6],
      ["move", "moving", 3586.6, 5130.8],
      ["hold", "holding", 5130.8, 13586.6],
    ]);
    // Entry 1 starts at the resolving frame of entry 0 (frame 155 = 5166.7 ms).
    const e1 = d.plans[1];
    expect(e1.tEntry).toBeCloseTo(155 * frameMs, 9);
    expect(e1.segments.map((s) => [s.kind, s.phase, round(s.t0), round(s.t1)])).toEqual([
      ["hold", "waiting", 5166.7, 5666.7],
      ["move", "moving", 5666.7, 7073.8],
      ["hold", "holding", 7073.8, 15666.7],
    ]);

    // Two events, both intended: select a at frame 155, select b at frame 216 (7200 ms), the last frame fed.
    expect(seen.map((e) => [e.kind, e.targetId, round(e.now)])).toEqual([
      ["select", "a", 5166.7],
      ["select", "b", 7200],
    ]);
    expect(seen[0].now).toBeCloseTo(155 * frameMs, 9);
    expect(seen[1].now).toBeCloseTo(216 * frameMs, 9);
    expect(d.k - 1).toBe(216);
    expect(d.entries.map((e) => [e.entry, e.outcome, e.missCause, round(e.timeToSelectMs as number)])).toEqual([
      [0, "selected", null, 1580.1],
      [1, "selected", null, 1533.3],
    ]);
    expect(d.accidental).toEqual([]);
  });
});
