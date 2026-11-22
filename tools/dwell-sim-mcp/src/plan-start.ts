/**
 * Plan the start of session (design section 4.7a): from the screen centre, wait the reaction
 * time, then move along a minimum-jerk path to an aim point inside the first rest area.
 * No reading pauses. It reuses the aim sampler, Fitts' law and the segment types of an entry,
 * so there is no start-only movement code. Pure: the only draws are `u01(start, 0, 0)` and
 * `u01(start, 0, 1)` (through `sampleAim`).
 */
import { MIN_MOVE_PX, movementTimeMs, projectedWidth } from "./fitts.js";
import { clampToHeadRange, toPose, toPx } from "./geometry.js";
import type { PlanContext, Segment } from "./plan-entry.js";
import { sampleAim } from "./scatter.js";
import type { Pose } from "./types.js";
export interface StartPlan {
  /** The frame time of the calibration-step 'centre'/'done' event. */
  tBegin: number;
  /** End of the start of session; the first task entry starts here. */
  tEnd: number;
  /** Phase 'start-of-session', sub 'reaction' then 'moving'. */
  segments: Segment[];
  /** p0 of entry 0. */
  endPose: Pose;
  restId: string | null;
  /** The rest point lies outside the user's head range. */
  clamped: boolean;
}
/** The screen-centre pose. */
const CENTRE: Pose = { yaw: 0, pitch: 0 };
export function planStart(ctx: PlanContext, tBegin: number): StartPlan {
  const rest = ctx.layout.targets.find((t) => t.role === "rest-area");
  if (rest === undefined) {
    return { tBegin, tEnd: tBegin, segments: [], endPose: CENTRE, restId: null, clamped: false };
  }
  const tMove0 = tBegin + ctx.user.reactionTimeMs;
  const segments: Segment[] = [
    {
      kind: "hold",
      t0: tBegin,
      t1: tMove0,
      pose: CENTRE,
      phase: "start-of-session",
      sub: "reaction",
    },
  ];
  const aim = sampleAim(ctx.geometry, rest.rect, ctx.user.scatterCapDeg, ctx.streams.start, 0);
  const centrePose = toPose(ctx.geometry, {
    x: rest.rect.x + rest.rect.width / 2,
    y: rest.rect.y + rest.rect.height / 2,
  });
  const reachable = clampToHeadRange(ctx.geometry.headRange, centrePose);
  const clamped = reachable.yaw !== centrePose.yaw || reachable.pitch !== centrePose.pitch;
  const P0 = toPx(ctx.geometry, CENTRE);
  const Pa = toPx(ctx.geometry, aim);
  const A = Math.hypot(Pa.x - P0.x, Pa.y - P0.y);
  let tEnd = tMove0;
  if (A >= MIN_MOVE_PX) {
    const W = projectedWidth(rest.rect, (Pa.x - P0.x) / A, (Pa.y - P0.y) / A);
    tEnd = tMove0 + movementTimeMs(A, W, ctx.user.throughputBitsPerS);
    segments.push({
      kind: "move",
      t0: tMove0,
      t1: tEnd,
      from: CENTRE,
      to: aim,
      phase: "start-of-session",
      sub: "moving",
    });
  }
  return { tBegin, tEnd, segments, endPose: aim, restId: rest.id, clamped };
}
