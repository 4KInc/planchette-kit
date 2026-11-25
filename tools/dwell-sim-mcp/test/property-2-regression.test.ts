import { describe, expect, it } from "vitest";
import { openTrial, runEntries, runStartOfSession, runWarmup, type TrialConfig } from "../src/run-trial.js";
import {
  buildCase,
  longestCrossing,
  longestNonIntendedStay,
  moveEndMs,
  nonIntendedStays,
  trackStays,
} from "./property-2-helpers.js";

/**
 * Regression cases of Property 2 found by the FC_SEED sweep (seeds 572, 33, 587; 533 is the same pattern as 587).
 * Each `OLD_*` config is the counterexample of the old generator, verbatim (including its dwellTime).
 *
 * Two defects of the old test:
 * 1. `buildCase` planned entry k from the previous `aim`, but the driver starts entry k at `basePose(plan_{k-1}, t_select)`.
 *    When the previous target was selected before its planned move ended, that pose is mid-move, so the path and its
 *    crossings differ (seed 572: 0 ms planned vs 636-637 ms (1 ms sampling) in the real plan, with dwell 400 ms: a pass-over on t0).
 *    The new generator chooses dwellTime >= (move end - planned entry into the target) + L + F as well, so every entry
 *    resolves during its holding phase and p0 = aim holds.
 * 2. The measured stay (first pointer-move inside to first pointer-move outside) overcounted by up to one frame
 *    (seed 33: 466.7 ms measured against dwell 459, true stay 400 ms at 15 fps). The stay is now last in-target frame
 *    minus first in-target frame.
 */
const OLD_572: TrialConfig = {"layout": {"screen": {"width": 1597, "height": 888}, "targets": [{"id": "t0", "rect": {"x": 401, "y": 98, "width": 194, "height": 109}, "autoRepeat": false, "role": "default"}, {"id": "t1", "rect": {"x": 801, "y": 25, "width": 194, "height": 109}, "autoRepeat": false, "role": "default"}, {"id": "t2", "rect": {"x": 2, "y": 75, "width": 194, "height": 109}, "autoRepeat": false, "role": "default"}, {"id": "rest", "rect": {"x": 801, "y": 446, "width": 194, "height": 109}, "autoRepeat": false, "role": "rest-area"}]}, "profile": {"headGain": 1, "headDeadZone": 1.499999999999997, "graceTime": 5, "postSelectionPause": 1551, "dwellTime": 400}, "user": {"name": "custom-94", "key": 1209555379, "params": {"throughputBitsPerS": 0.3, "tremorFrequencyHz": 1, "tremorPeakToPeakDeg": 0, "tremorAxis": "pitch", "tremorDriftFraction": 0.2, "headRangeDeg": {"left": 24.731475045012985, "right": 4, "up": 4, "down": 11.155532196560772}, "reactionTimeMs": 500, "readingPauseChancePct": 0, "readingPauseLengthMs": {"min": 0, "max": 5e-324}, "trackingNoiseDeg": 0, "scatterCapDeg": 0.10000000000000023, "scanReactionTimeMs": 500, "scanLatePressChancePct": 10, "scanPressDurationMs": 150}}, "mode": "head + dwell", "task": ["t1", "t2"], "fps": 15, "requestSeed": 14, "trialIndex": 5, "analysisWindowMs": 17288} as unknown as TrialConfig;
const OLD_33: TrialConfig = {"layout": {"screen": {"width": 1599, "height": 889}, "targets": [{"id": "t0", "rect": {"x": 535, "y": 464, "width": 302, "height": 169}, "autoRepeat": false, "role": "default"}, {"id": "t1", "rect": {"x": 1068, "y": 59, "width": 302, "height": 252}, "autoRepeat": false, "role": "default"}, {"id": "t2", "rect": {"x": 97, "y": 659, "width": 411, "height": 169}, "autoRepeat": false, "role": "default"}, {"id": "rest", "rect": {"x": 1068, "y": 447, "width": 302, "height": 169}, "autoRepeat": false, "role": "rest-area"}]}, "profile": {"headGain": 1, "headDeadZone": 2.0732177207565897e-186, "graceTime": 394, "postSelectionPause": 2760, "dwellTime": 459}, "user": {"name": "custom-0", "key": 3689966665, "params": {"throughputBitsPerS": 0.3, "tremorFrequencyHz": 0, "tremorPeakToPeakDeg": 0, "tremorAxis": "yaw", "tremorDriftFraction": 0.2, "headRangeDeg": {"left": 58.932239480356714, "right": 33.324340541569725, "up": 53.90722936283677, "down": 31.59579244557544}, "reactionTimeMs": 500, "readingPauseChancePct": 0, "readingPauseLengthMs": {"min": 0, "max": 0}, "trackingNoiseDeg": 0, "scatterCapDeg": 1.3139957368968649, "scanReactionTimeMs": 500, "scanLatePressChancePct": 10, "scanPressDurationMs": 150}}, "mode": "head + dwell", "task": ["t1", "t2"], "fps": 15, "requestSeed": 806909877, "trialIndex": 19, "analysisWindowMs": 16599} as unknown as TrialConfig;
const OLD_587: TrialConfig = {"layout": {"screen": {"width": 970, "height": 539}, "targets": [{"id": "t0", "rect": {"x": 673, "y": 293, "width": 224, "height": 204}, "autoRepeat": false, "role": "default"}, {"id": "t1", "rect": {"x": 357, "y": 272, "width": 260, "height": 159}, "autoRepeat": false, "role": "default"}, {"id": "t2", "rect": {"x": 100, "y": 428, "width": 220, "height": 107}, "autoRepeat": false, "role": "default"}, {"id": "rest", "rect": {"x": 652, "y": 2, "width": 313, "height": 231}, "autoRepeat": false, "role": "rest-area"}]}, "profile": {"headGain": 1, "headDeadZone": 2.51163730846973e-19, "graceTime": 120, "postSelectionPause": 2876, "dwellTime": 400}, "user": {"name": "custom-369", "key": 1561792629, "params": {"throughputBitsPerS": 0.3000000000000004, "tremorFrequencyHz": 13.088326831689152, "tremorPeakToPeakDeg": 0, "tremorAxis": "yaw", "tremorDriftFraction": 0.2, "headRangeDeg": {"left": 60, "right": 36.13703822203904, "up": 36.29169737651491, "down": 36.86930864323586}, "reactionTimeMs": 453.11074825772545, "readingPauseChancePct": 0, "readingPauseLengthMs": {"min": 6.5476366292700475e-133, "max": 6.279548179345861e-26}, "trackingNoiseDeg": 0, "scatterCapDeg": 1.9105371889295004, "scanReactionTimeMs": 500, "scanLatePressChancePct": 10, "scanPressDurationMs": 150}}, "mode": "head + dwell", "task": ["t0", "t2"], "fps": 30, "requestSeed": 4294967293, "trialIndex": 3, "analysisWindowMs": 16421} as unknown as TrialConfig;

function run(cfg: TrialConfig) {
  const d = openTrial(cfg);
  const stays = trackStays(d);
  try {
    runWarmup(d);
    const s = runStartOfSession(d);
    runEntries(d, s);
    return { entries: d.entries, accidental: d.accidental, plans: d.plans, stays, geometry: d.geometry, frameMs: d.frameMs };
  } finally {
    d.pl.destroy();
  }
}

/** The generator's config for the layout/user/task of an old counterexample (its dwellTime dropped). */
function rebuilt(old: TrialConfig) {
  const { dwellTime: _dwell, ...profile } = old.profile;
  const { analysisWindowMs: _w, profile: _p, ...rest } = old;
  return buildCase({ ...rest, profile });
}

function expectClean(cfg: TrialConfig): ReturnType<typeof run> {
  const r = run(cfg);
  expect(r.entries.map((e) => e.outcome)).toEqual(cfg.task.map(() => "selected"));
  expect(r.accidental).toEqual([]);
  r.entries.forEach((e, i) => {
    expect(r.plans[i].tMove0 + (e.timeToSelectMs as number)).toBeGreaterThanOrEqual(moveEndMs(r.plans[i]) - 1e-6);
  });
  return r;
}

/** Longest crossing of a non-intended selectable target over the plans the driver really used. */
function realCrossing(cfg: TrialConfig, r: ReturnType<typeof run>): number {
  let best = 0;
  r.plans.forEach((p) => {
    const others = cfg.layout.targets.filter((t) => t.role !== "rest-area" && t.id !== p.targetId);
    best = Math.max(best, longestCrossing(p.segments, others, r.geometry));
  });
  return best;
}

describe("Property 2 regressions", () => {
  it("seed 572: old dwell 400 ms passes over t0 (planned crossing 0 ms, real 636-637 ms); the new generator gives a longer dwell and a clean run", () => {
    const old = run(OLD_572);
    expect(old.accidental.some((a) => a.cause === "pass-over" && a.targetId === "t0")).toBe(true);
    const oldBuilt = rebuilt(OLD_572);
    expect(oldBuilt.crossing).toBe(0);
    expect(realCrossing(OLD_572, old)).toBe(637);
    expect(oldBuilt.cfg.profile.dwellTime as number).toBeGreaterThan(400);
    expect(oldBuilt.overClamp).toBe(false);
    expectClean(oldBuilt.cfg);
  });

  it("seed 33: the old stay measure overcounted by one frame; the true stay is below dwell 459 ms", () => {
    const r = run(OLD_33);
    const longest = longestNonIntendedStay(nonIntendedStays(r.stays, OLD_33.task), OLD_33.task)!;
    const stay = longest.endMs - longest.startMs;
    // The old measure ended the stay at the first pointer-move outside the rect: one frame later.
    expect(stay + r.frameMs).toBeCloseTo(466.6667, 3);
    expect(stay).toBeCloseTo(400, 3);
    expect(OLD_33.profile.dwellTime as number - stay).toBeGreaterThan(0);
    expect(r.accidental).toEqual([]);
    expectClean(rebuilt(OLD_33).cfg);
  });

  it("seed 587: old dwell 400 ms passes over t1 (planned crossing 0 ms); the new generator gives a longer dwell and a clean run", () => {
    const old = run(OLD_587);
    expect(old.accidental.some((a) => a.cause === "pass-over" && a.targetId === "t1")).toBe(true);
    const built = rebuilt(OLD_587);
    expect(built.crossing).toBe(0);
    expect(built.cfg.profile.dwellTime as number).toBeGreaterThan(400);
    expectClean(built.cfg);
  });
});
