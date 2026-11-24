/**
 * Classification of select and cancel events (design section 6): start-of-session first,
 * then intended, then accidental with exactly one of seven causes. Also the miss causes.
 * Pure apart from the caller-owned `ClassifyState`; no clock, no random draws.
 */
import type { Rect } from "@planchette/skeleton";
import { ampPx, tremorOrNoiseOn, type AmpUser } from "./amp-px.js";
import { toPx, type GeometryContext } from "./geometry.js";
import type { HeadModel } from "./head-model.js";
import { insideRect, type EntryPlan, type Phase, type Segment } from "./plan-entry.js";
import type { StartPlan } from "./plan-start.js";
import { isTargetReachable } from "./reachable.js";
import type { AccidentalCause, Activity, Layout, Point, RawEvent } from "./types.js";

/** Allowance for the smoother lag after a reading pause (chosen: above 400 ms at smoothing 0.9). */
export const LAG_ALLOWANCE_MS = 500;

export type MissCause = "unreachable" | "aim-outside-target" | "tremor-at-edge" | "other";

export type Classification =
  | { category: "start-of-session"; activity: "waiting"; cause: "start" }
  | { category: "intended"; activity: Activity }
  | { category: "accidental"; activity: Activity; cause: AccidentalCause };

/** Repeat state and the last pointer-move position. Created once per trial. */
export interface ClassifyState {
  /** Target of the previous select/cancel event after the start plan's tEnd; null before the first. */
  prevTargetId: string | null;
  prevRect: Rect | null;
  /** A pointer-move since the previous event left its rect. */
  leftRect: boolean;
  /** Last pointer-move position, or null when none has been seen. */
  pointer: Point | null;
}

export function createClassifyState(): ClassifyState {
  return { prevTargetId: null, prevRect: null, leftRect: false, pointer: null };
}

/** Record a `pointer-move`. Updates two numbers in place after the first call. */
export function notePointerMove(state: ClassifyState, x: number, y: number): void {
  if (state.pointer === null) state.pointer = { x, y };
  else {
    state.pointer.x = x;
    state.pointer.y = y;
  }
  if (state.prevRect !== null && !state.leftRect && !insideRect(state.prevRect, state.pointer)) {
    state.leftRect = true;
  }
}

/** Anything with a segment list: an entry plan or the start plan. */
export interface PhasePlan {
  segments: readonly Segment[];
}

/**
 * Phase of the segment with `t0 <= t < t1`; the last segment's phase from its end on; the first
 * segment's phase before it. A plan with no segments (start plan without rest area) is `start-of-session`.
 */
export function phaseAt(plan: PhasePlan, t: number): Phase {
  const segs = plan.segments;
  const n = segs.length;
  if (n === 0) return "start-of-session";
  for (let i = 0; i < n; i++) {
    const s = segs[i] as Segment;
    if (t < s.t1) return s.phase;
  }
  return (segs[n - 1] as Segment).phase;
}

/** Activity label of a phase. Start-of-session and waiting both give `waiting`. */
export function activityOf(phase: Phase): Activity {
  switch (phase) {
    case "start-of-session":
    case "waiting":
      return "waiting";
    case "moving":
      return "moving";
    case "reading-pause":
      return "reading pause";
    case "holding":
      return "holding on the aim point";
  }
}

/** Distance from `z` to the boundary of `r`: 0 on it, distance to the rectangle outside, least edge distance inside. */
export function edgeDist(z: Point, r: Rect): number {
  const dx = Math.max(r.x - z.x, 0, z.x - (r.x + r.width));
  const dy = Math.max(r.y - z.y, 0, z.y - (r.y + r.height));
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy);
  return Math.min(z.x - r.x, r.x + r.width - z.x, z.y - r.y, r.y + r.height - z.y);
}

export interface ClassifyContext {
  geometry: GeometryContext;
  layout: Layout;
  user: AmpUser;
  /** Profile `graceTime`, ms. */
  graceTimeMs: number;
  startPlan: Pick<StartPlan, "tEnd" | "segments">;
  headModel: HeadModel;
}

function targetOf(layout: Layout, id: string | undefined): { rect: Rect; autoRepeat: boolean } | null {
  if (id === undefined) return null;
  const t = layout.targets.find((x) => x.id === id);
  return t === undefined ? null : { rect: t.rect, autoRepeat: t.autoRepeat };
}

/**
 * Classify one drained event. `plan` is the entry plan in force; it may be null only for an
 * event before the start plan's tEnd.
 */
export function classify(
  ctx: ClassifyContext,
  e: RawEvent,
  plan: EntryPlan | null,
  state: ClassifyState,
): Classification {
  if (e.now < ctx.startPlan.tEnd) {
    return { category: "start-of-session", activity: "waiting", cause: "start" };
  }
  if (plan === null) {
    throw new Error("classify: an entry plan is required at or after the start plan's tEnd");
  }
  const phase = phaseAt(plan, e.now);
  const activity = activityOf(phase);
  const aimed = ctx.layout.targets.find((t) => t.id === plan.targetId);
  const base = ctx.headModel.basePose(plan, e.now);
  const q = toPx(ctx.geometry, base);
  const target = targetOf(ctx.layout, e.targetId);

  const aimedMatch =
    plan.role === "cancel"
      ? e.kind === "cancel" && e.targetId === plan.targetId
      : e.kind === "select" && e.targetId === plan.targetId;
  const intended =
    aimedMatch &&
    aimed !== undefined &&
    (phase === "holding" || (phase === "moving" && insideRect(aimed.rect, q)));

  let result: Classification;
  if (intended) {
    result = { category: "intended", activity };
  } else {
    result = { category: "accidental", activity, cause: accidentalCause(ctx, e, plan, state, phase, base, q, target) };
  }
  state.prevTargetId = e.targetId ?? null;
  state.prevRect = target === null ? null : target.rect;
  state.leftRect = false;
  return result;
}

/** The seven accidental causes, first match wins (design section 6 table). Reads `state` before it is updated. */
function accidentalCause(
  ctx: ClassifyContext,
  e: RawEvent,
  plan: EntryPlan,
  state: ClassifyState,
  phase: Phase,
  base: { yaw: number; pitch: number },
  q: Point,
  target: { rect: Rect; autoRepeat: boolean } | null,
): AccidentalCause {
  if (target !== null && target.autoRepeat && state.prevTargetId === e.targetId && !state.leftRect) {
    return "repeat";
  }
  if (phase === "waiting") return "waiting";
  if (e.targetId !== undefined) {
    for (const r of plan.pauses) {
      if (
        r.targetId === e.targetId &&
        r.t0 <= e.now &&
        e.now < r.t1 + ctx.graceTimeMs + LAG_ALLOWANCE_MS
      ) {
        return "reading-pause";
      }
    }
  }
  if (target !== null && tremorOrNoiseOn(ctx.user)) {
    const amp = ampPx(ctx.geometry, ctx.user, base);
    if (
      edgeDist(q, target.rect) <= amp ||
      (state.pointer !== null && edgeDist(state.pointer, target.rect) <= amp)
    ) {
      return "tremor-at-edge";
    }
  }
  if (e.targetId === plan.targetId && phase === "moving") return "early-on-intended-target";
  if (phase === "moving") return "pass-over";
  return "other";
}

/** Cause of a missed entry (design section 6, "Miss causes"). */
export function classifyMiss(ctx: ClassifyContext, plan: EntryPlan): MissCause {
  const target = ctx.layout.targets.find((t) => t.id === plan.targetId);
  if (target === undefined) return "other";
  if (!isTargetReachable(ctx.geometry, target.rect)) return "unreachable";
  if (!insideRect(target.rect, plan.aimPx)) return "aim-outside-target";
  if (
    tremorOrNoiseOn(ctx.user) &&
    edgeDist(plan.aimPx, target.rect) <= ampPx(ctx.geometry, ctx.user, plan.aim)
  ) {
    return "tremor-at-edge";
  }
  return "other";
}
