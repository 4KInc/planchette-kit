/**
 * The trial driver (design section 5). Part 1: the skeleton instance, the effective profile,
 * the listeners and the warm-up. Parts 2 and 3 (start of session, entries, classification,
 * results) extend `runTrial` by using the pieces below: `openTrial` builds everything,
 * `feedFrame` feeds one frame on the frame grid, `runWarmup` runs the warm-up and
 * `drainQueue` hands out the queued events in emission order.
 *
 * Everything is synchronous. Time is the frame grid `now = k * 1000 / fps`; there is no clock,
 * no random source and no await. The skeleton is used through its public API only.
 */
import { createPlanchette } from "@planchette/skeleton";
import type { Planchette, Profile, TimestampedSample } from "@planchette/skeleton";
import {
  activityOf,
  classify,
  classifyMiss,
  createClassifyState,
  notePointerMove,
  phaseAt,
  type ClassifyContext,
  type ClassifyState,
} from "./classify.js";
import type { GeometryContext } from "./geometry.js";
import { createHeadModel, type HeadModel, type SegmentPlan } from "./head-model.js";
import { planEntry, type EntryPlan, type PlanContext, type PlanStreams } from "./plan-entry.js";
import { planStart, type StartPlan } from "./plan-start.js";
import { Purpose, stream } from "./rng.js";
import type {
  Layout,
  Pose,
  RawEvent,
  ResolvedUser,
} from "./types.js";

/** The part of the trial a frame belongs to. */
export type FramePhase = "warmup" | "start" | "entry";

export interface TrialConfig {
  layout: Layout;
  profile: Partial<Profile>;
  user: ResolvedUser;
  mode: "head + dwell";
  task: readonly string[];
  fps: 15 | 30 | 60;
  analysisWindowMs: number;
  requestSeed: number;
  trialIndex: number;
  /** Tests count events independently of the classifier. */
  observers?: {
    onEvent?(e: RawEvent): void;
    /**
     * Called once per fed frame, from feedFrame, with the rotation exactly as fed to the engine.
     * `rotation` is the reused face rotation object: the observer must copy the two numbers.
     */
    onSample?(now: number, rotation: Pose, phase: FramePhase): void;
  };
}

import type { AccidentalRecord, StartEventRecord, TrialEntryResult, TrialResult } from "./metrics.js";

// The result types live in metrics.ts (design section 7); re-exported so existing imports keep working.
export type { AccidentalRecord, StartEventRecord, TrialEntryResult, TrialResult } from "./metrics.js";

/** Warning text when the centre step does not finish within its cap. */
export const WARNING_CENTRE_STEP_CAP = "centre-step-cap";

/** Warning text when the rest point lies outside the user's head range. */
export const WARNING_START_CLAMPED = "start-clamped";

/** Slots the queue starts with; it grows by whole slots in the rare case that more events arrive between two drains. */
const QUEUE_SLOTS = 64;

/**
 * A queue of events with pre-allocated slots. `push` overwrites a slot in place, so a frame
 * allocates nothing unless the queue grows.
 */
export interface EventQueue {
  slots: RawEvent[];
  length: number;
}

export function createEventQueue(): EventQueue {
  const slots: RawEvent[] = [];
  for (let i = 0; i < QUEUE_SLOTS; i++) slots.push({ kind: "select", now: 0 });
  return { slots, length: 0 };
}

export function pushEvent(
  q: EventQueue,
  kind: "select" | "cancel",
  targetId: string | undefined,
  now: number,
): RawEvent {
  if (q.length === q.slots.length) q.slots.push({ kind: "select", now: 0 });
  const slot = q.slots[q.length++];
  slot.kind = kind;
  slot.targetId = targetId;
  slot.now = now;
  return slot;
}

/**
 * Calls `fn` for each queued event in emission order and empties the queue. The event object
 * is a queue slot: it is overwritten by later events, so copy what must be kept.
 */
export function drainQueue(q: EventQueue, fn: (e: RawEvent) => void): void {
  // `fn` must not push to this queue; the engine only emits during `feedSamples`.
  const n = q.length;
  for (let i = 0; i < n; i++) fn(q.slots[i]);
  q.length = 0;
}

/** The profile fields the user's head range sets, per field, unless the caller set them. */
export function effectiveProfileInput(
  profile: Partial<Profile>,
  user: ResolvedUser,
): Partial<Profile> {
  const range = user.params.headRangeDeg;
  return {
    ...profile,
    mode: "head + dwell",
    calibrationRangeLeft: profile.calibrationRangeLeft ?? range.left,
    calibrationRangeRight: profile.calibrationRangeRight ?? range.right,
    calibrationRangeUp: profile.calibrationRangeUp ?? range.up,
    calibrationRangeDown: profile.calibrationRangeDown ?? range.down,
  };
}

/** Simulated ms the warm-up may run: the step timeout plus one second (design section 5, safety cap). */
export function warmupCapMs(eff: Pick<Profile, "calibrationStepTimeout">): number {
  return eff.calibrationStepTimeout + 1000;
}

/** Everything one trial owns. Nothing here is shared with another trial. */
export interface TrialDriver {
  cfg: TrialConfig;
  pl: Planchette;
  /** The profile as the skeleton clamped it (`getProfile()` after `setProfile`). */
  eff: Profile;
  queue: EventQueue;
  classifyState: ClassifyState;
  head: HeadModel;
  /**
   * Built once, after the warm-up, from the centre the engine captured (design section 4.1, D2).
   * Before `runWarmup` returns it holds the zero-centre placeholder.
   */
  geometry: GeometryContext;
  /** `result.centre` of the centre step's done event; (0, 0) when null or when the step never finished. */
  centre: Pose;
  streams: PlanStreams;
  frameMs: number;
  /** The next frame index; frame `k` has `now = k * frameMs`. */
  k: number;
  /** True once the `calibration-step` event with run 'centre' and step 'done' has arrived. */
  centreDone: boolean;
  /** Frame time of that event, or the cap when it never came. Set by `runWarmup`. */
  tDone: number;
  warnings: string[];
  /** Start-of-session events (warm-up included), in emission order. */
  startEvents: StartEventRecord[];
  /** One result per task entry, in entry order (filled by `runEntries`). */
  entries: TrialEntryResult[];
  /** Accidental selections in emission order (filled by `runEntries`). */
  accidental: AccidentalRecord[];
  /** The entry plans, in entry order (filled by `runEntries`; one object per entry, not per frame). */
  plans: EntryPlan[];
  /** The reused sample and its one-element batch. */
  sample: TimestampedSample;
  batch: TimestampedSample[];
  /** The face inside `sample`, mutated in place. */
  face: { bbox: { cx: number; cy: number; w: number; h: number }; rotation: { yaw: number; pitch: number } };
  /** `cfg.observers?.onSample`, resolved once per trial. */
  onSample: ((now: number, rotation: Pose, phase: FramePhase) => void) | undefined;
}

/** The pose plan of the warm-up: no segments, so the base pose is the centre. */
const WARMUP_PLAN: SegmentPlan = { segments: [] };

/**
 * A new skeleton instance for this trial, with the effective profile, the targets and the
 * listeners. The listeners are attached here, before any sample is fed.
 */
export function openTrial(cfg: TrialConfig): TrialDriver {
  const { layout, user } = cfg;
  const pl = createPlanchette({
    screen: layout.screen,
    profile: effectiveProfileInput(cfg.profile, user),
    inputs: false,
    trackingIndicator: false,
  });
  pl.setProfile(effectiveProfileInput(cfg.profile, user));
  const eff = pl.getProfile();
  for (const t of layout.targets) {
    pl.registerTarget(t.id, t.rect, { autoRepeat: t.autoRepeat, role: t.role });
  }

  const queue = createEventQueue();
  const classifyState = createClassifyState();
  const onEvent = cfg.observers?.onEvent;

  const face = {
    bbox: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.4 },
    rotation: { yaw: 0, pitch: 0 },
  };
  const sample: TimestampedSample = { now: 0, source: "camera", faces: [face] };

  const driver: TrialDriver = {
    cfg,
    pl,
    eff,
    queue,
    classifyState,
    head: createHeadModel(user.params, {
      phase: stream(cfg.requestSeed, user.key, cfg.trialIndex, Purpose.TremorPhase),
      drift: stream(cfg.requestSeed, user.key, cfg.trialIndex, Purpose.TremorDriftKnot),
      noise: stream(cfg.requestSeed, user.key, cfg.trialIndex, Purpose.TrackingNoise),
    }),
    geometry: { profile: eff, screen: layout.screen, headRange: user.params.headRangeDeg, centre: { yaw: 0, pitch: 0 } },
    centre: { yaw: 0, pitch: 0 },
    streams: {
      aim: stream(cfg.requestSeed, user.key, cfg.trialIndex, Purpose.Aim),
      readingChance: stream(cfg.requestSeed, user.key, cfg.trialIndex, Purpose.ReadingPauseChance),
      readingLength: stream(cfg.requestSeed, user.key, cfg.trialIndex, Purpose.ReadingPauseLength),
      start: stream(cfg.requestSeed, user.key, cfg.trialIndex, Purpose.Start),
    },
    frameMs: 1000 / cfg.fps,
    k: 0,
    centreDone: false,
    tDone: 0,
    warnings: [],
    startEvents: [],
    entries: [],
    accidental: [],
    plans: [],
    sample,
    batch: [sample],
    face,
    onSample: cfg.observers?.onSample,
  };

  pl.addEventListener("select", (e) => {
    const slot = pushEvent(queue, "select", e.detail.targetId, e.detail.now);
    if (onEvent !== undefined) onEvent(slot);
  });
  pl.addEventListener("cancel", (e) => {
    const slot = pushEvent(queue, "cancel", e.detail.targetId, e.detail.now);
    if (onEvent !== undefined) onEvent(slot);
  });
  pl.addEventListener("pointer-move", (e) => {
    notePointerMove(classifyState, e.detail.x, e.detail.y);
  });
  pl.addEventListener("calibration-step", (e) => {
    if (e.detail.run === "centre" && e.detail.step === "done") {
      driver.centreDone = true;
      const c = e.detail.result?.centre;
      driver.centre = c === null || c === undefined ? { yaw: 0, pitch: 0 } : { yaw: c.yaw, pitch: c.pitch };
    }
  });
  return driver;
}

/** Feeds the sample for `pose` at time `now`: one `feedSamples` call, no allocation. */
export function feedFrame(d: TrialDriver, pose: Pose, now: number, phase: FramePhase): void {
  d.face.rotation.yaw = pose.yaw;
  d.face.rotation.pitch = pose.pitch;
  d.sample.now = now;
  // After the rotation is set, before the engine sees it (design section 5).
  if (d.onSample !== undefined) d.onSample(now, d.face.rotation, phase);
  d.pl.feedSamples(d.batch);
}

/**
 * The warm-up (Req 1 AC 3, 5): still at the centre pose, tremor and noise on, until the
 * `calibration-step` centre/done event or the cap. Events stay in the queue; the caller
 * classifies them as start-of-session events. Leaves `k` at the first frame after the warm-up
 * and sets `tDone`.
 */
export function runWarmup(d: TrialDriver): void {
  const cap = warmupCapMs(d.eff);
  while (!d.centreDone && d.k * d.frameMs <= cap) {
    const now = d.k * d.frameMs;
    feedFrame(d, d.head.head(WARMUP_PLAN, now), now, "warmup");
    d.k++;
  }
  if (d.centreDone) {
    d.tDone = (d.k - 1) * d.frameMs;
  } else {
    d.tDone = cap;
    d.warnings.push(WARNING_CENTRE_STEP_CAP);
  }
  // D2: the geometry is built once, here, with the captured centre. Every later consumer (start
  // plan, entry plans, aims, reachable rectangle, classification) reads `d.geometry`.
  d.geometry = { ...d.geometry, centre: d.centre };
}

/** What the entry loop (part 3) needs from the start of session. */
export interface StartOfSession {
  startPlan: StartPlan;
  /** `startPlan.endPose`: p0 of entry 0. */
  endPose: Pose;
  /** `startPlan.tEnd`: the time entry 0 starts. */
  tEntry: number;
  /** The next frame index to feed: the first frame at or after `tEntry`. */
  nextFrame: number;
  /** The plan context for `planEntry`. */
  planCtx: PlanContext;
  /** The classifier context, with `startPlan` set. */
  classifyCtx: ClassifyContext;
}

/**
 * The start of session (design section 5, step 2, and 4.7a). Call after `runWarmup`.
 * Plans from `tDone`, records the events queued by the warm-up directly, then feeds
 * `head(startPlan, now)` on the frame grid for every frame with `now < tEnd`, classifying
 * the events of each frame in emission order. The frame at `tEnd` is not fed here: it
 * belongs to entry 0. Every event is recorded in `d.startEvents`.
 */
export function runStartOfSession(d: TrialDriver): StartOfSession {
  const { cfg } = d;
  const planCtx: PlanContext = {
    geometry: d.geometry,
    layout: cfg.layout,
    task: cfg.task,
    user: cfg.user.params,
    analysisWindowMs: cfg.analysisWindowMs,
    streams: d.streams,
  };
  const startPlan = planStart(planCtx, d.tDone);
  if (startPlan.clamped) d.warnings.push(WARNING_START_CLAMPED);
  const classifyCtx: ClassifyContext = {
    geometry: d.geometry,
    layout: cfg.layout,
    user: cfg.user.params,
    graceTimeMs: d.eff.graceTime,
    startPlan,
    headModel: d.head,
  };
  // Events of the warm-up (queued before the start plan exists, up to and including the
  // centre/done frame) are start-of-session events by definition (design section 5 and
  // section 6). They are recorded directly as start events, activity 'waiting' and cause
  // 'start', and do not go through `classify`: with no rest area `now == tEnd` for an event
  // at `tDone`, which `classify` would not treat as before the end of the start of session.
  const recordWarmup = (e: RawEvent): void => {
    d.startEvents.push({ targetId: e.targetId ?? null, timeMs: e.now });
  };
  // Events of the start-of-session frames (`now < tEnd`) go through `classify`.
  const recordStart = (e: RawEvent): void => {
    const c = classify(classifyCtx, e, null, d.classifyState);
    if (c.category !== "start-of-session") {
      throw new Error("run-trial: an event of the start of session was not classified as one");
    }
    d.startEvents.push({ targetId: e.targetId ?? null, timeMs: e.now });
  };

  drainQueue(d.queue, recordWarmup);
  while (d.k * d.frameMs < startPlan.tEnd) {
    const now = d.k * d.frameMs;
    feedFrame(d, d.head.head(startPlan, now), now, "start");
    d.k++;
    drainQueue(d.queue, recordStart);
  }
  return {
    startPlan,
    endPose: startPlan.endPose,
    tEntry: startPlan.tEnd,
    nextFrame: d.k,
    planCtx,
    classifyCtx,
  };
}

/**
 * The entry loop (design section 5, step 3, and section 6). Call after `runStartOfSession`.
 *
 * Each frame feeds `head(plan, now)` once, then the queued events are classified in emission
 * order under the plan in force at that event. The first intended event resolves the entry
 * and, if another entry follows, plans it at once at this frame's `now` from `basePose(plan,
 * now)`; the remaining events of the frame are classified under the new plan and recorded
 * with its index. An intended event after the last entry resolved is recorded as an
 * accidental selection with cause 'other' (the entry resolves once). The deadline frame
 * (first frame with `now >= plan.deadline`) is fed and drained first, so an intended event on
 * it wins; only then is the miss recorded. No frame is fed after the last entry resolves.
 */
export function runEntries(d: TrialDriver, s: StartOfSession): void {
  const task = d.cfg.task;
  if (task.length === 0) return;
  const { planCtx, classifyCtx } = s;
  const last = task.length - 1;
  const q = d.queue;
  let entry = 0;
  let plan = planEntry(planCtx, 0, s.tEntry, s.endPose);
  d.plans.push(plan);
  let finished = false;

  while (!finished) {
    const now = d.k * d.frameMs;
    feedFrame(d, d.head.head(plan, now), now, "entry");
    d.k++;
    let advanced = false;
    const n = q.length;
    for (let i = 0; i < n; i++) {
      const ev = q.slots[i];
      const c = classify(classifyCtx, ev, plan, d.classifyState);
      if (c.category === "intended" && !finished) {
        d.entries.push({
          entry: plan.entry,
          targetId: plan.targetId,
          outcome: "selected",
          timeToSelectMs: ev.now - plan.tMove0,
          missCause: null,
        });
        advanced = true;
        if (entry < last) {
          // Design section 6 wins: switch plans now, from the base pose at this frame's time.
          const p0 = d.head.basePose(plan, now);
          entry++;
          plan = planEntry(planCtx, entry, now, { yaw: p0.yaw, pitch: p0.pitch });
          d.plans.push(plan);
        } else {
          finished = true;
        }
      } else if (c.category === "intended") {
        // Same frame, after the last entry resolved: it cannot resolve the entry again.
        d.accidental.push({
          targetId: ev.targetId ?? null,
          timeMs: ev.now,
          activity: activityOf(phaseAt(plan, ev.now)),
          cause: "other",
          entry: plan.entry,
        });
      } else if (c.category === "accidental") {
        d.accidental.push({
          targetId: ev.targetId ?? null,
          timeMs: ev.now,
          activity: c.activity,
          cause: c.cause,
          entry: plan.entry,
        });
      } else {
        // An event at or after tEnd is never a start-of-session event.
        throw new Error("run-trial: an entry event was classified as start-of-session");
      }
    }
    q.length = 0;
    if (!advanced && now >= plan.deadline) {
      d.entries.push({
        entry: plan.entry,
        targetId: plan.targetId,
        outcome: "miss",
        timeToSelectMs: null,
        missCause: classifyMiss(classifyCtx, plan),
      });
      if (entry < last) {
        const p0 = d.head.basePose(plan, now);
        entry++;
        plan = planEntry(planCtx, entry, now, { yaw: p0.yaw, pitch: p0.pitch });
        d.plans.push(plan);
      } else {
        finished = true;
      }
    }
  }
}

/**
 * Runs one trial: instance, profile, warm-up, start of session and the entries. Ends with
 * `destroy()`.
 */
export function runTrial(cfg: TrialConfig): TrialResult {
  const d = openTrial(cfg);
  try {
    runWarmup(d);
    const s = runStartOfSession(d);
    runEntries(d, s);
    return {
      userName: cfg.user.name,
      trialIndex: cfg.trialIndex,
      entries: d.entries,
      accidental: d.accidental,
      startEvents: d.startEvents,
      warnings: d.warnings,
      effectiveProfile: d.eff,
      centre: d.centre,
    };
  } finally {
    d.pl.destroy();
  }
}
