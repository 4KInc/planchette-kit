/**
 * The head as a pure function of simulated time (design sections 4.5, 4.6, 4.7):
 * head(t) = clampToHeadRange(base(t) + tremor(t) + noise(t)).
 * `base` comes from the plan's segments. Tremor and noise are counter-based draws keyed by
 * time, so the value at `t` never depends on which other times were asked for. The only state
 * is a forward cursor over the segments and the output objects; the cursor is an optimisation
 * and is reset whenever `t` goes back or the plan changes, so it cannot change a result.
 */
import { clampToHeadRange, type HeadRange } from "./geometry.js";
import { poseOnSegment } from "./min-jerk.js";
import { u01, type Stream } from "./rng.js";
import type { Segment } from "./plan-entry.js";
import { tremorOffset, type TremorParams, type TremorStreams } from "./tremor.js";
import type { Pose } from "./types.js";

/** Any plan: an `EntryPlan` or the start plan. */
export interface SegmentPlan {
  segments: readonly Segment[];
}

/** The user parameters the head function reads. */
export interface HeadUser extends TremorParams {
  tremorAxis: "yaw" | "pitch";
  trackingNoiseDeg: number;
  headRangeDeg: HeadRange;
}

/** `phase` is `Purpose.TremorPhase`, `drift` is `Purpose.TremorDriftKnot`, `noise` is `Purpose.TrackingNoise`. */
export interface HeadStreams extends TremorStreams {
  noise: Stream;
}

export interface HeadModel {
  /**
   * The head pose at `t` (ms). The returned object is reused: it is overwritten by the next
   * `head` call on this model, so copy it to keep it.
   */
  head(plan: SegmentPlan, t: number): Pose;
  /** The pose from the segments alone, without tremor, noise or clamping. Reused object, as for `head`. */
  basePose(plan: SegmentPlan, t: number): Pose;
}

/** Creates the head function for one user and trial. Each model has its own cursor and output objects. */
export function createHeadModel(user: HeadUser, streams: HeadStreams): HeadModel {
  const range = user.headRangeDeg;
  const noiseDeg = user.trackingNoiseDeg;
  const tremorOnPitch = user.tremorAxis === "pitch";
  const out: Pose = { yaw: 0, pitch: 0 };
  const baseOut: Pose = { yaw: 0, pitch: 0 };
  let cursorPlan: SegmentPlan | null = null;
  let cursor = 0;

  /**
   * The first segment with t < t1, or the last one. The cursor only skips segments that end
   * at or before the previous t; it restarts at 0 when t is before the end of the segment
   * before it, or when the plan is not the one the cursor belongs to.
   */
  function segmentAt(segments: readonly Segment[], plan: SegmentPlan, t: number): Segment | null {
    const n = segments.length;
    if (n === 0) return null;
    if (plan !== cursorPlan || cursor >= n || (cursor > 0 && t < segments[cursor - 1].t1)) {
      cursorPlan = plan;
      cursor = 0;
    }
    while (cursor < n - 1 && t >= segments[cursor].t1) cursor++;
    return segments[cursor];
  }

  function writeBase(plan: SegmentPlan, t: number, into: Pose): void {
    const seg = segmentAt(plan.segments, plan, t);
    if (seg === null) {
      into.yaw = 0;
      into.pitch = 0;
    } else if (seg.kind === "hold") {
      into.yaw = seg.pose.yaw;
      into.pitch = seg.pose.pitch;
    } else {
      const p = poseOnSegment(seg, t);
      into.yaw = p.yaw;
      into.pitch = p.pitch;
    }
  }

  return {
    basePose(plan, t) {
      writeBase(plan, t, baseOut);
      return baseOut;
    },
    head(plan, t) {
      writeBase(plan, t, out);
      const tremor = tremorOffset(t, user, streams);
      if (tremorOnPitch) out.pitch += tremor;
      else out.yaw += tremor;
      if (noiseDeg !== 0) {
        const k = Math.round(t * 1000);
        out.yaw += noiseDeg * (2 * u01(streams.noise, k, 0) - 1);
        out.pitch += noiseDeg * (2 * u01(streams.noise, k, 1) - 1);
      }
      const clamped = clampToHeadRange(range, out);
      out.yaw = clamped.yaw;
      out.pitch = clamped.pitch;
      return out;
    },
  };
}
