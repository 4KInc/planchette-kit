import type { ClassifyContext } from "../src/classify.js";
import type { GeometryContext } from "../src/geometry.js";
import { createHeadModel, type HeadUser } from "../src/head-model.js";
import type { EntryPlan, PausePlan, Segment } from "../src/plan-entry.js";
import { Purpose, stream } from "../src/rng.js";
import type { Layout, Pose } from "../src/types.js";
import { toPx } from "../src/geometry.js";
import type { TargetRole } from "@planchette/skeleton";

/**
 * Linear mapping with 25 px per degree on both axes: gain 1, no dead zone, range 20 degrees,
 * 1001 x 1001 px. So x = 500 + 25 yaw and y = 500 - 25 pitch, exactly, at integer pixels.
 */
export const profile = {
  headGain: 1,
  headDeadZone: 0,
  calibrationRangeLeft: 20,
  calibrationRangeRight: 20,
  calibrationRangeUp: 20,
  calibrationRangeDown: 20,
};
export const geometry: GeometryContext = {
  profile,
  screen: { width: 1001, height: 1001 },
  headRange: { left: 20, right: 20, up: 20, down: 20 },
};

export const layout: Layout = {
  screen: geometry.screen,
  targets: [
    { id: "goal", rect: { x: 800, y: 450, width: 100, height: 100 }, autoRepeat: false, role: "default" },
    { id: "mid", rect: { x: 400, y: 450, width: 100, height: 100 }, autoRepeat: false, role: "default" },
    { id: "rep", rect: { x: 100, y: 100, width: 100, height: 100 }, autoRepeat: true, role: "default" },
    { id: "cancel", rect: { x: 800, y: 100, width: 100, height: 100 }, autoRepeat: false, role: "cancel" },
    { id: "rest", rect: { x: 0, y: 900, width: 100, height: 100 }, autoRepeat: false, role: "rest-area" },
  ],
};

export const quiet: HeadUser = {
  tremorFrequencyHz: 0,
  tremorPeakToPeakDeg: 0,
  tremorDriftFraction: 0.2,
  tremorAxis: "yaw",
  trackingNoiseDeg: 0,
  headRangeDeg: { left: 20, right: 20, up: 20, down: 20 },
};
/** Tremor on the yaw axis: aT = 1 x 1.2 / 2 = 0.6 deg = 15 px, so ampPx = 16. */
export const shaky: HeadUser = { ...quiet, tremorFrequencyHz: 5, tremorPeakToPeakDeg: 1 };

export function pxPose(x: number, y: number): Pose {
  return { yaw: (x - 500) / 25, pitch: (500 - y) / 25 };
}

/** The start plan used by the examples: reaction [200, 500), movement [500, 1000), tEnd 1000. */
export const startWithRest = {
  tEnd: 1000,
  segments: [
    { kind: "hold", t0: 200, t1: 500, pose: pxPose(500, 500), phase: "start-of-session", sub: "reaction" },
    {
      kind: "move",
      t0: 500,
      t1: 1000,
      from: pxPose(500, 500),
      to: pxPose(50, 950),
      phase: "start-of-session",
      sub: "moving",
    },
  ] as Segment[],
};
/** A start plan without a rest area: zero length at tBegin = 1000. */
export const startNoRest = { tEnd: 1000, segments: [] as Segment[] };

export function ctxFor(
  user: HeadUser,
  start: { tEnd: number; segments: Segment[] } = startWithRest,
  geo: GeometryContext = geometry,
): ClassifyContext {
  const streams = {
    phase: stream(1, 7, 0, Purpose.TremorPhase),
    drift: stream(1, 7, 0, Purpose.TremorDriftKnot),
    noise: stream(1, 7, 0, Purpose.TrackingNoise),
  };
  return {
    geometry: geo,
    layout,
    user,
    graceTimeMs: 150,
    startPlan: start,
    headModel: createHeadModel(user, streams),
  };
}

export function hold(t0: number, t1: number, pose: Pose, phase: "waiting" | "reading-pause" | "holding"): Segment {
  return { kind: "hold", t0, t1, pose, phase };
}
export function move(t0: number, t1: number, from: Pose, to: Pose): Segment {
  return { kind: "move", t0, t1, from, to, phase: "moving" };
}

export function mkPlan(
  segments: Segment[],
  opts: { targetId?: string; role?: TargetRole; pauses?: PausePlan[]; aim?: Pose; entry?: number } = {},
): EntryPlan {
  const aim = opts.aim ?? pxPose(850, 500);
  const first = segments[0] as Segment;
  const last = segments[segments.length - 1] as Segment;
  return {
    entry: opts.entry ?? 0,
    targetId: opts.targetId ?? "goal",
    role: opts.role ?? "default",
    tEntry: first.t0,
    tMove0: first.t1,
    deadline: last.t1,
    segments,
    pauses: opts.pauses ?? [],
    aim,
    aimPx: toPx(geometry, aim),
  };
}

/** Entry plan from t = 1000: wait [1000, 1500), move to the aim [1500, 2500), hold [2500, 10000). */
export function standardPlan(opts: Parameters<typeof mkPlan>[1] = {}): EntryPlan {
  const aim = opts.aim ?? pxPose(850, 500);
  return mkPlan(
    [
      hold(1000, 1500, pxPose(500, 500), "waiting"),
      move(1500, 2500, pxPose(500, 500), aim),
      hold(2500, 10000, aim, "holding"),
    ],
    { ...opts, aim },
  );
}
