/**
 * Regression tests for the two Property 7 counterexamples of the diagnosis (fast-check seeds 199 and
 * 295, D4). Each is the shrunk case from the generator of the first version of 8.9.
 *
 * Both cases give different outcomes at 15 and 60 fps (one run selects the target, the other misses
 * it), but that is not a frame-rate effect: the planned aim of the entry (`plans[0].aimPx`) lies
 * OUTSIDE its intended target. The truncated scatter can put the aim up to about 0.73 W from the
 * centre, so a target that is too small for the scatter makes the entry a legitimate miss or a lucky
 * select depending on small timing differences. They therefore violate the assumption "the planned
 * aim of each entry lies inside its intended target", which Property 7 now enforces with `fc.pre`.
 *
 * The old B2 sizing measured the cap only in +yaw and +pitch from the head-centre pose. With a head
 * range of 3 degrees on the left (seed 199) or on every side (seed 295), the pointer moves much more
 * per degree on the other sides, so the targets were far too small. The new sizing (`sdCapPx`, four
 * directions, dead zone included) asks for much larger targets than these cases have.
 *
 * The values are the shrunk counterexamples that the first generator printed for P7_SEED=199 and
 * P7_SEED=295, pinned.
 *
 * **Validates: Requirements 2.2, 2.3, 7.4**
 */
import { describe, expect, it } from "vitest";
import { insideRect, type EntryPlan } from "../src/plan-entry.js";
import { openTrial, runEntries, runStartOfSession, runWarmup, type TrialConfig } from "../src/run-trial.js";
import { ANALYSIS_WINDOW_MS, aimsInside, sdCapPx } from "./p7-helpers.js";

type CaseCfg = Omit<TrialConfig, "fps">;

const seed199: CaseCfg = {
  "layout": {
    "screen": {
      "width": 1282,
      "height": 963
    },
    "targets": [
      {
        "id": "t0",
        "rect": {
          "x": 323,
          "y": 2,
          "width": 298,
          "height": 298
        },
        "autoRepeat": false,
        "role": "default"
      },
      {
        "id": "rest",
        "rect": {
          "x": 964,
          "y": 7,
          "width": 298,
          "height": 298
        },
        "autoRepeat": false,
        "role": "rest-area"
      }
    ]
  },
  "profile": {
    "headGain": 1.0358858301691782,
    "dwellTime": 404,
    "graceTime": 363,
    "postSelectionPause": 209,
    "headDeadZone": 5.107635352108298e-75
  },
  "user": {
    "name": "custom-664",
    "key": 1922647323,
    "params": {
      "throughputBitsPerS": 0.3189577759957808,
      "tremorFrequencyHz": 4.34530076698524e-84,
      "tremorPeakToPeakDeg": 0,
      "tremorAxis": "yaw",
      "tremorDriftFraction": 0.2,
      "headRangeDeg": {
        "left": 3,
        "right": 46.241115691193144,
        "up": 44.70394055337219,
        "down": 3.0000000000000036
      },
      "reactionTimeMs": 1070,
      "readingPauseChancePct": 0,
      "readingPauseLengthMs": {
        "min": 2999.999999999997,
        "max": 2999.9999999999995
      },
      "trackingNoiseDeg": 0,
      "scatterCapDeg": 2.9999999817460776,
      "scanReactionTimeMs": 500,
      "scanLatePressChancePct": 10,
      "scanPressDurationMs": 150
    }
  },
  "mode": "head + dwell",
  "task": [
    "t0"
  ],
  "analysisWindowMs": ANALYSIS_WINDOW_MS,
  "requestSeed": 320924240,
  "trialIndex": 0
};

const seed295: CaseCfg = {
  "layout": {
    "screen": {
      "width": 1284,
      "height": 1072
    },
    "targets": [
      {
        "id": "t0",
        "rect": {
          "x": 872,
          "y": 1025,
          "width": 396,
          "height": 40
        },
        "autoRepeat": false,
        "role": "default"
      },
      {
        "id": "t1",
        "rect": {
          "x": 2,
          "y": 4,
          "width": 424,
          "height": 55
        },
        "autoRepeat": false,
        "role": "default"
      },
      {
        "id": "t2",
        "rect": {
          "x": 27,
          "y": 542,
          "width": 122,
          "height": 42
        },
        "autoRepeat": false,
        "role": "default"
      },
      {
        "id": "t3",
        "rect": {
          "x": 800,
          "y": 162,
          "width": 40,
          "height": 371
        },
        "autoRepeat": false,
        "role": "default"
      },
      {
        "id": "rest",
        "rect": {
          "x": 945,
          "y": 2,
          "width": 48,
          "height": 402
        },
        "autoRepeat": false,
        "role": "rest-area"
      }
    ]
  },
  "profile": {
    "headGain": 1.9916799540174934,
    "dwellTime": 403,
    "graceTime": 118,
    "postSelectionPause": 284,
    "headDeadZone": 1.4999999999999991
  },
  "user": {
    "name": "custom-987",
    "key": 3658396286,
    "params": {
      "throughputBitsPerS": 0.7181129147491019,
      "tremorFrequencyHz": 3e-323,
      "tremorPeakToPeakDeg": 0,
      "tremorAxis": "pitch",
      "tremorDriftFraction": 0.2,
      "headRangeDeg": {
        "left": 3,
        "right": 3,
        "up": 3,
        "down": 3
      },
      "reactionTimeMs": 1491,
      "readingPauseChancePct": 0,
      "readingPauseLengthMs": {
        "min": 0,
        "max": 0
      },
      "trackingNoiseDeg": 0,
      "scatterCapDeg": 0.6266776012994844,
      "scanReactionTimeMs": 500,
      "scanLatePressChancePct": 10,
      "scanPressDurationMs": 150
    }
  },
  "mode": "head + dwell",
  "task": [
    "t0"
  ],
  "analysisWindowMs": ANALYSIS_WINDOW_MS,
  "requestSeed": 470915485,
  "trialIndex": 0
};

/** The entry plans and the captured centre of a run at `fps`. */
function runAt(cfg: CaseCfg, fps: 15 | 60): { plans: EntryPlan[]; centre: { yaw: number; pitch: number } } {
  const d = openTrial({ ...cfg, fps });
  try {
    runWarmup(d);
    const s = runStartOfSession(d);
    runEntries(d, s);
    return { plans: [...d.plans], centre: d.centre };
  } finally {
    d.pl.destroy();
  }
}

const OLD_MIN_SIDE = { seed199: 298, seed295: 40 };

function check(name: "seed199" | "seed295", cfg: CaseCfg, aim: { x: number; y: number }, newMinSide: number): void {
  const rect = cfg.layout.targets.find((t) => t.id === "t0")!.rect;
  for (const fps of [15, 60] as const) {
    const run = runAt(cfg, fps);
    // The centre is (0, 0), as sdCapPx assumes (tremor and noise are 0).
    expect(run.centre).toEqual({ yaw: 0, pitch: 0 });
    // After D2 the planned aim of entry 0 is this pixel at both frame rates, and it is outside t0.
    expect(run.plans[0].aimPx).toEqual(aim);
    expect(insideRect(rect, run.plans[0].aimPx)).toBe(false);
    // So the case violates the aim assumption: Property 7 discards it with `fc.pre`.
    expect(aimsInside(cfg, run.plans)).toBe(false);
  }
  // The new B2 sizing asks for a larger side than the case's target has (and than the old sizing asked for).
  const sd = sdCapPx(cfg.layout.screen, cfg.profile, cfg.user);
  expect(Math.ceil(6 * sd + 40)).toBe(newMinSide);
  expect(newMinSide).toBeGreaterThan(OLD_MIN_SIDE[name]);
  expect(Math.min(rect.width, rect.height)).toBeLessThan(newMinSide);
}

describe("Property 7 regression", () => {
  it("seed 199: aim (293, 150) is left of t0 (x from 323); the new B2 sizing needs 3886 px", () => {
    check("seed199", seed199, { x: 293, y: 150 }, 3886);
  });
  it("seed 295: aim (996, 1066) is one pixel below t0 (y up to 1064); the new B2 sizing needs 3244 px", () => {
    check("seed295", seed295, { x: 996, y: 1066 }, 3244);
  });
});
