/**
 * Plan one task entry (design section 4.7): reaction wait, aim point, Fitts movement time,
 * minimum-jerk pieces, reading pauses on crossed non-intended targets, final hold to the deadline.
 * Pure: every random value is a counter-based draw keyed by the entry index and the layout
 * target index (design section 3), so the plan never reads engine output, a clock or state.
 */
import type { Rect, TargetRole } from "@planchette/skeleton";
import { MIN_MOVE_PX, movementTimeMs, projectedWidth } from "./fitts.js";
import { toPx, type GeometryContext } from "./geometry.js";
import { u01, type Stream } from "./rng.js";
import { sampleAim } from "./scatter.js";
import type { Layout, Point, Pose, UserParams } from "./types.js";

export type Phase = "start-of-session" | "waiting" | "moving" | "reading-pause" | "holding";
/** Sub-phases of 'start-of-session'. */
export type StartSub = "reaction" | "moving";

export type Segment =
  | { kind: "hold"; t0: number; t1: number; pose: Pose; phase: Phase; sub?: StartSub }
  | {
      kind: "move";
      t0: number;
      t1: number;
      from: Pose;
      to: Pose;
      phase: "moving" | "start-of-session";
      sub?: StartSub;
    };

export interface PausePlan {
  targetId: string;
  t0: number;
  t1: number;
}

export interface EntryPlan {
  entry: number;
  targetId: string;
  role: TargetRole;
  tEntry: number;
  tMove0: number;
  /** tMove0 + analysis window. */
  deadline: number;
  segments: Segment[];
  pauses: PausePlan[];
  aim: Pose;
  aimPx: Point;
}

/** The user parameters planning reads. */
export type PlanUser = Pick<
  UserParams,
  | "throughputBitsPerS"
  | "reactionTimeMs"
  | "readingPauseChancePct"
  | "readingPauseLengthMs"
  | "scatterCapDeg"
>;

/** The streams planning draws from, each made with its own `Purpose`. */
export interface PlanStreams {
  /** `Purpose.Aim`. */
  aim: Stream;
  /** `Purpose.ReadingPauseChance`. */
  readingChance: Stream;
  /** `Purpose.ReadingPauseLength`. */
  readingLength: Stream;
  /** `Purpose.Start`; read only by `planStart` (design 4.7a). */
  start: Stream;
}

/** Everything `planEntry` reads. It holds nothing that depends on engine output. */
export interface PlanContext {
  geometry: GeometryContext;
  layout: Layout;
  /** Expanded task: the target id of entry k is `task[k]`. */
  task: readonly string[];
  user: PlanUser;
  analysisWindowMs: number;
  streams: PlanStreams;
}

/** Pause point as a fraction of the crossing, inside the target (design 4.7 step 4, chosen). */
export const READING_DEPTH = 0.5;
/** Most samples taken along the straight path to find crossings (design 4.7 step 4). */
export const MAX_PATH_SAMPLES = 2000;

/** Half-open test: `[x, x + w) x [y, y + h)`. Shared with the classifier. */
export function insideRect(rect: Rect, p: Point): boolean {
  return p.x >= rect.x && p.x < rect.x + rect.width && p.y >= rect.y && p.y < rect.y + rect.height;
}

function lerpPose(a: Pose, b: Pose, lambda: number): Pose {
  return { yaw: a.yaw + (b.yaw - a.yaw) * lambda, pitch: a.pitch + (b.pitch - a.pitch) * lambda };
}

interface PausePoint {
  targetId: string;
  lambda: number;
  lengthMs: number;
}

/** Layout target index: position of the id among all layout ids in UTF-16 order. */
function sortedIndexOf(layout: Layout, id: string): number {
  let index = 0;
  for (const t of layout.targets) if (t.id < id) index++;
  return index;
}

/** Pauses on crossed non-intended selectable targets, sorted by position along the path (step 4). */
function readingPauses(
  ctx: PlanContext,
  entry: number,
  aimedId: string,
  p0: Pose,
  aim: Pose,
  P0: Point,
  A: number,
): PausePoint[] {
  const { chance, lengthRange } = {
    chance: ctx.user.readingPauseChancePct / 100,
    lengthRange: ctx.user.readingPauseLengthMs,
  };
  const n = Math.min(MAX_PATH_SAMPLES, Math.ceil(A) + 1);
  const lambdas = new Array<number>(n);
  const px = new Array<Point>(n);
  for (let i = 0; i < n; i++) {
    lambdas[i] = i / (n - 1);
    px[i] = toPx(ctx.geometry, lerpPose(p0, aim, lambdas[i] as number));
  }
  const out: PausePoint[] = [];
  for (const x of ctx.layout.targets) {
    if (x.role === "rest-area" || x.id === aimedId || insideRect(x.rect, P0)) continue;
    let first = -1;
    let last = -1;
    for (let i = 0; i < n; i++) {
      const inside = insideRect(x.rect, px[i] as Point);
      if (inside && first < 0) first = i;
      if (inside) last = i;
      else if (first >= 0) break;
    }
    if (first < 0) continue;
    const index = sortedIndexOf(ctx.layout, x.id);
    if (u01(ctx.streams.readingChance, entry, index) >= chance) continue;
    const lengthMs =
      lengthRange.min +
      u01(ctx.streams.readingLength, entry, index) * (lengthRange.max - lengthRange.min);
    const lIn = lambdas[first] as number;
    const lOut = lambdas[last] as number;
    out.push({ targetId: x.id, lambda: lIn + READING_DEPTH * (lOut - lIn), lengthMs });
  }
  out.sort((a, b) => a.lambda - b.lambda);
  return out;
}

export function planEntry(ctx: PlanContext, entry: number, tEntry: number, p0: Pose): EntryPlan {
  const targetId = ctx.task[entry];
  const target = ctx.layout.targets.find((t) => t.id === targetId);
  if (targetId === undefined || target === undefined) {
    throw new Error(`planEntry: entry ${entry} names no target of the layout`);
  }
  const tMove0 = tEntry + ctx.user.reactionTimeMs;
  const deadline = tMove0 + ctx.analysisWindowMs;
  const segments: Segment[] = [
    { kind: "hold", t0: tEntry, t1: tMove0, pose: p0, phase: "waiting" },
  ];
  const pauses: PausePlan[] = [];

  const aim = sampleAim(ctx.geometry, target.rect, ctx.user.scatterCapDeg, ctx.streams.aim, entry);
  const P0 = toPx(ctx.geometry, p0);
  const Pa = toPx(ctx.geometry, aim);
  const A = Math.hypot(Pa.x - P0.x, Pa.y - P0.y);
  const plan: EntryPlan = {
    entry,
    targetId,
    role: target.role,
    tEntry,
    tMove0,
    deadline,
    segments,
    pauses,
    aim,
    aimPx: Pa,
  };
  if (A < MIN_MOVE_PX) {
    segments.push({ kind: "hold", t0: tMove0, t1: deadline, pose: aim, phase: "holding" });
    return plan;
  }

  const dx = (Pa.x - P0.x) / A;
  const dy = (Pa.y - P0.y) / A;
  const W = projectedWidth(target.rect, dx, dy);
  const stops = readingPauses(ctx, entry, targetId, p0, aim, P0, A);

  let t = tMove0;
  let from = p0;
  let fromPx = P0;
  const piece = (to: Pose): void => {
    const toPoint = toPx(ctx.geometry, to);
    const a = Math.hypot(toPoint.x - fromPx.x, toPoint.y - fromPx.y);
    if (a >= MIN_MOVE_PX) {
      const mt = movementTimeMs(a, W, ctx.user.throughputBitsPerS);
      segments.push({ kind: "move", t0: t, t1: t + mt, from, to, phase: "moving" });
      t += mt;
    }
    from = to;
    fromPx = toPoint;
  };
  for (const stop of stops) {
    const at = lerpPose(p0, aim, stop.lambda);
    piece(at);
    segments.push({ kind: "hold", t0: t, t1: t + stop.lengthMs, pose: at, phase: "reading-pause" });
    pauses.push({ targetId: stop.targetId, t0: t, t1: t + stop.lengthMs });
    t += stop.lengthMs;
  }
  piece(aim);
  if (t < deadline) {
    segments.push({ kind: "hold", t0: t, t1: deadline, pose: aim, phase: "holding" });
  }
  return plan;
}
