/**
 * Helpers for Property 6 (longer dwell, fewer reading-pause accidents). A pure helper, not a test.
 *
 * Builds an open-loop camera stream from a list of stays on targets and runs it through the real
 * skeleton engine (`createPlanchette`, `feedSamples`) in 'head + dwell' mode. Only the skeleton's
 * public API is used. There is no clock and no random source: sample times are fixed.
 *
 * Time model. Stay times are in stream time, in ms, from 0. A start-up centre step (still head at
 * the centre pose) runs first, at negative times, so stream time 0 is free for the first stay.
 * For each stay the stream has, in this order:
 *  - a lost-face frame (a camera sample with no faces) at `start - 1`, so the smoother resets and
 *    the pointer jumps onto the pose of the stay;
 *  - face samples with the head posed at the centre of the stay's rectangle at `start`,
 *    `start + stepMs`, ... while earlier than `end`, and one at `end`;
 *  - a lost-face frame at `end + 1`: the gap, which ends the stay at once.
 * With every gap between stays at least 3 ms, the lost-face frames fall at distinct times.
 * With `stepMs <= 100` the dwell engine counts the whole stay, so a stay of length L = end - start
 * has accumulated exactly L at its last sample.
 *
 * Targets are the distinct rectangles of the stays, registered as `t0`, `t1`, ... in order of first
 * use, without `autoRepeat`. Rectangles must not overlap (the first registered wins a hit test).
 */
import { createPlanchette, pointToRotation } from "@planchette/skeleton";
import type { Profile, Rect, ScreenSize, TimestampedSample } from "@planchette/skeleton";

export interface Stay {
  rect: Rect;
  /** Time of the first on-target sample (ms, at least 0). */
  start: number;
  /** Time of the last on-target sample (ms, at least `start`). */
  end: number;
}

export interface StayStreamOptions {
  screen: ScreenSize;
  profile: Partial<Profile>;
  stays: readonly Stay[];
  /** Interval between on-target samples in ms. Default 33. At most 100. */
  stepMs?: number;
}

export interface SelectRecord {
  targetId: string;
  now: number;
}

export interface StayRun {
  /** Every `select` event, in emission order. */
  selects: SelectRecord[];
  /** Every `cancel` event, in emission order (none are expected). */
  cancels: { now: number; targetId?: string }[];
  /** For each select, the index of the stay with `start <= now <= end`, or null when none contains it. */
  stayOfSelect: (number | null)[];
  /** The sorted indices of the stays that produced at least one select. */
  selectedStays: number[];
  /** The profile as the skeleton clamped it. */
  effectiveProfile: Profile;
}

/** Interval of the start-up centre frames (ms). */
const CENTRE_STEP_MS = 20;

/** The id each distinct rectangle gets, by order of first use. */
function rectKey(r: Rect): string {
  return `${r.x},${r.y},${r.width},${r.height}`;
}

/** The pointer pixel of a stay: the centre of its rectangle. */
export function stayPoint(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * The face samples of the stays (lost-face frames included), in stream time. `rotationFor` maps a
 * rectangle to the head pose that puts the pointer on its centre.
 */
export function buildStaySamples(
  stays: readonly Stay[],
  rotationFor: (rect: Rect) => { yaw: number; pitch: number },
  stepMs = 33,
): TimestampedSample[] {
  if (!(stepMs > 0 && stepMs <= 100)) throw new Error("p6-stream: stepMs must be in (0, 100]");
  const out: TimestampedSample[] = [];
  let last = -Infinity;
  const lost = (now: number): void => {
    out.push({ now, source: "camera", faces: [] });
    last = now;
  };
  for (const [i, s] of stays.entries()) {
    if (!(s.start >= 0 && s.end >= s.start)) throw new Error(`p6-stream: stay ${i} has a bad time range`);
    if (!(s.start - 1 > last)) throw new Error(`p6-stream: stay ${i} starts too soon after the previous stay`);
    lost(s.start - 1);
    const rotation = rotationFor(s.rect);
    const face = { bbox: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.4 }, rotation };
    for (let t = s.start; t < s.end; t += stepMs) out.push({ now: t, source: "camera", faces: [face] });
    out.push({ now: s.end, source: "camera", faces: [face] });
    last = s.end;
    lost(s.end + 1);
  }
  return out;
}

/**
 * Runs the stays through a new engine and returns the selects, the stay each select belongs to, and
 * the effective profile. The engine is destroyed before returning.
 */
export function runStays(opts: StayStreamOptions): StayRun {
  const { screen, stays } = opts;
  const pl = createPlanchette({
    screen,
    profile: { ...opts.profile, mode: "head + dwell" },
    inputs: false,
    trackingIndicator: false,
  });
  try {
    const ids = new Map<string, string>();
    for (const s of stays) {
      const key = rectKey(s.rect);
      if (!ids.has(key)) {
        const id = `t${ids.size}`;
        ids.set(key, id);
        pl.registerTarget(id, s.rect, { autoRepeat: false });
      }
    }
    const selects: SelectRecord[] = [];
    const cancels: { now: number; targetId?: string }[] = [];
    let centreDone = false;
    pl.addEventListener("select", (e) => selects.push({ targetId: e.detail.targetId, now: e.detail.now }));
    pl.addEventListener("cancel", (e) => cancels.push({ ...e.detail }));
    pl.addEventListener("calibration-step", (e) => {
      if (e.detail.run === "centre" && e.detail.step === "done") centreDone = true;
    });

    // The start-up centre step: a still head at the centre pose, at negative times.
    const eff0 = pl.getProfile();
    const warmupMs = eff0.calibrationStepTimeout + 2000;
    const centreFace = { bbox: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.4 }, rotation: { yaw: 0, pitch: 0 } };
    for (let t = -warmupMs; t < -CENTRE_STEP_MS && !centreDone; t += CENTRE_STEP_MS) {
      pl.feedSamples([{ now: t, source: "camera", faces: [centreFace] }]);
    }
    if (!centreDone) throw new Error("p6-stream: the centre step did not finish");
    selects.length = 0;
    cancels.length = 0;

    const eff = pl.getProfile();
    const samples = buildStaySamples(
      stays,
      (rect) => pointToRotation(eff, screen, { yaw: 0, pitch: 0 }, stayPoint(rect)),
      opts.stepMs ?? 33,
    );
    pl.feedSamples(samples);

    const stayOfSelect = selects.map((e) => {
      const i = stays.findIndex((s) => e.now >= s.start && e.now <= s.end);
      return i < 0 ? null : i;
    });
    const selectedStays = [...new Set(stayOfSelect.filter((i): i is number => i !== null))].sort((a, b) => a - b);
    return { selects, cancels, stayOfSelect, selectedStays, effectiveProfile: eff };
  } finally {
    pl.destroy();
  }
}
