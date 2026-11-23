/**
 * Property 7: Frame rate (design, Correctness Properties).
 *
 * Tremor, tracking noise, reading pauses and autoRepeat are off, and the input-core P15 boundary
 * conditions hold: B1 (stays), B2 (target size), B4 (reaction time) and B5 (no autoRepeat).
 *
 * How the boundary conditions are enforced:
 * - B5: `layoutArb` without `includeAutoRepeat` (every target has autoRepeat false).
 * - B4: the profile (so `postSelectionPause`) is drawn first; then the custom user's `reactionTimeMs`
 *   is drawn from [max(150, postSelectionPause), 1500] and PINNED through `fixed.reactionTimeMs`
 *   (see `reactionArb` for the bug of the earlier version). The test asserts B4 for every request.
 * - Tremor, noise, reading pauses: pinned to 0 through `customUserArb({ fixed })`.
 * - B2: the profile, user and screen are drawn first. The scatter cap is converted to px with the
 *   skeleton's own mapping (`sdCapPx` in p7-helpers.ts: largest of the four directions +-yaw, +-pitch,
 *   measured from the head centre and from the dead-zone edge, so the dead zone is included, with the
 *   centre (0, 0) that the engine captures when tremor and noise are 0) and `layoutArb` gets
 *   `minSide = ceil(6 * SDcap_px + 40)`; a precondition then rejects the (rare) layouts whose grid
 *   cells were too small to give every target (rest area and cancel target included) that size.
 * - D4 (aim assumption): the planned aim of each entry (`plans[k].aimPx`, both runs) lies inside its
 *   intended target (half-open). The truncated scatter can put the aim up to about 0.73 W from the
 *   centre, so a missed aim is a legitimate miss, not a frame-rate effect. Enforced with `fc.pre`
 *   inside the property; the discard rate is printed.
 * - B1: the stay on the intended target is the hold until selection, so it is not constrained. Every
 *   other stay is measured on the plans the trial itself used (the `EntryPlan`s `planEntry` made,
 *   read from the 60 fps driver): the base pose (no tremor, no noise, so it is the pointer path) is
 *   sampled every 1 ms from the plan's `tEntry` to the time the entry ended, and every maximal
 *   interval inside a non-intended target is a stay. A precondition requires each stay to be shorter
 *   than `dwellTime - 67` or longer than `dwellTime + postSelectionPause + 134`. The analysis window
 *   is 60 s, so no entry runs into its deadline because of a frame-rate difference.
 *
 * Assertions: same ordered intended selections at 15 and 60 fps; and, for every selected entry at both
 * fps, select - arrival - gaps = ceil(dwellTime / F) * F, with arrival = max(first frame of the earliest
 * in-target run chained to the selecting run through sampled off-target gaps of at most graceTime, first
 * frame at or after the end of the preceding post-selection pause) and gaps = the sampled gap time inside
 * that chain (see `analyseStay`). B6 (`fc.pre`, both traces): every sampled off-target gap on the
 * intended target differs from graceTime by more than one 15 fps frame. Printed, not asserted: the largest |tts15 - tts60| and the largest single-entry
 * D = |(arrival15 - tMove0_15) - (arrival60 - tMove0_60)|.
 *
 * **Validates: Requirements 2.2, 2.3, 7.4**
 */
import { appendFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { layoutArb, profileArb, customUserArb, taskArb } from "./arbitraries.js";
import { toPx } from "../src/geometry.js";
import { ANALYSIS_WINDOW_MS, aimsInside, b6Holds, expectIdentity, sdCapPx, traced, type CaseCfg, type Traced } from "./p7-helpers.js";
import { insideRect } from "../src/plan-entry.js";
import { resolveUser } from "../src/resolve-user.js";
import {
  openTrial,
  runEntries,
  runStartOfSession,
  runWarmup,
  type TrialConfig,
  type TrialEntryResult,
} from "../src/run-trial.js";
import type { Layout } from "../src/types.js";

const B1_LOW = 67;
const B1_HIGH = 134;

interface Case {
  cfg: CaseCfg;
  minSide: number;
}

/**
 * The B4 bug in the previous generator: `customUserArb({ ranges: { reactionTimeMs } })` builds
 * `fc.record(model, { requiredKeys })` where only pinned (`fixed`) fields are required. A ranged
 * field is therefore an OPTIONAL key: fast-check often leaves it out, the user keeps the base
 * preset's reaction time and the range is ignored (e.g. reaction 500 with pause 1196). Here the
 * reaction time is drawn in the test and pinned through `fixed`, so the key is always present.
 */
const reactionArb = (pause: number): fc.Arbitrary<number> => fc.integer({ min: Math.max(150, pause), max: 1500 });

const PINNED_OFF = { tremorPeakToPeakDeg: 0, trackingNoiseDeg: 0, readingPauseChancePct: 0 } as const;

const baseCaseArb: fc.Arbitrary<Case> = fc
  .tuple(
    profileArb({ postSelectionPause: { min: 200, max: 1500 } }),
    fc.record({ width: fc.integer({ min: 1280, max: 1920 }), height: fc.integer({ min: 720, max: 1080 }) }),
    fc.integer({ min: 0, max: 2 ** 31 - 1 }),
  )
  .chain(([profile, screen, requestSeed]) => {
    const pause = profile.postSelectionPause as number;
    return reactionArb(pause).chain((reaction) =>
      customUserArb({ fixed: { ...PINNED_OFF, reactionTimeMs: reaction } }).chain((input) => {
        const r = resolveUser(input);
        if (!r.ok) throw new Error(`invalid user: ${r.error.message}`);
        const user = r.user;
        const minSide = Math.ceil(6 * sdCapPx(screen, profile, user) + 40);
        return layoutArb({ screen, minSide, minTargets: 1, maxTargets: 4 }).chain((layout: Layout) =>
          taskArb(layout, { maxLength: 4, includeCancel: false, form: "list" }).map(
            (task): Case => ({
              minSide,
              cfg: {
                layout,
                profile,
                user,
                mode: "head + dwell",
                task: task as string[],
                analysisWindowMs: ANALYSIS_WINDOW_MS,
                requestSeed,
                trialIndex: 0,
              },
            }),
          ),
        );
      }),
    );
  });

/** Stays on non-intended targets, in ms, over all entries of the 60 fps run. */
function nonIntendedStays(cfg: TrialConfig): number[] {
  const d = openTrial(cfg);
  try {
    runWarmup(d);
    const s = runStartOfSession(d);
    runEntries(d, s);
    const stays: number[] = [];
    d.plans.forEach((plan, k) => {
      const res = d.entries[k];
      const tEnd =
        k + 1 < d.plans.length
          ? d.plans[k + 1].tEntry
          : plan.tMove0 + (res.timeToSelectMs ?? ANALYSIS_WINDOW_MS);
      for (const t of cfg.layout.targets) {
        if (t.id === plan.targetId) continue;
        let start = -1;
        for (let ms = plan.tEntry; ms <= tEnd; ms += 1) {
          const p = toPx(d.geometry, d.head.basePose(plan, ms));
          if (insideRect(t.rect, p)) {
            if (start < 0) start = ms;
          } else if (start >= 0) {
            stays.push(ms - start);
            start = -1;
          }
        }
        if (start >= 0) stays.push(tEnd - start);
      }
    });
    return stays;
  } finally {
    d.pl.destroy();
  }
}

/** B1, B2 and B4 for one generated request. */
function preconditions({ cfg, minSide }: Case): void {
  const dwell = cfg.profile.dwellTime as number;
  const pause = cfg.profile.postSelectionPause as number;
  // B4 holds by construction; assert it for every generated request.
  expect(cfg.user.params.reactionTimeMs, "B4: reactionTimeMs >= postSelectionPause").toBeGreaterThanOrEqual(pause);
  // B2 backstop: every target big enough.
  fc.pre(cfg.layout.targets.every((t) => t.rect.width >= minSide && t.rect.height >= minSide));
  // B1 on every non-intended stay.
  const stays = nonIntendedStays({ ...cfg, fps: 60 });
  fc.pre(stays.every((s) => s < dwell - B1_LOW || s > dwell + pause + B1_HIGH));
}

const selected = (r: Traced): TrialEntryResult[] => r.entries.filter((e) => e.outcome === "selected");

/** |tts15 - tts60| per selected entry (paired by position; the lists are compared separately). */
function diffs(t15: Traced, t60: Traced): { entry: number; targetId: string; diff: number; a: number; b: number }[] {
  const s60 = selected(t60);
  return selected(t15)
    .filter((_, i) => i < s60.length)
    .map((e, i) => ({
      entry: e.entry,
      targetId: e.targetId,
      a: e.timeToSelectMs as number,
      b: s60[i].timeToSelectMs as number,
      diff: Math.abs((e.timeToSelectMs as number) - (s60[i].timeToSelectMs as number)),
    }));
}

describe("Property 7: frame rate", () => {
  it("15 fps and 60 fps give the same intended selections and tts - arrival = ceil(dwellTime / F) * F", () => {
    let executions = 0;
    let calls = 0;
    let discardedB1B2 = 0;
    let discardedAim = 0;
    let discardedB6 = 0;
    let largestTts = 0;
    let largestD = 0;
    const result = fc.check(
      fc.property(baseCaseArb, (c) => {
        calls++;
        try {
          preconditions(c);
        } catch (e) {
          if (String((e as Error)?.constructor?.name) === "PreconditionFailure") discardedB1B2++;
          throw e;
        }
        const t15 = traced({ ...c.cfg, fps: 15 });
        const t60 = traced({ ...c.cfg, fps: 60 });
        // D4 assumption: the planned aim of each entry (both runs) lies inside its intended target.
        if (!(aimsInside(c.cfg, t15.plans) && aimsInside(c.cfg, t60.plans))) {
          discardedAim++;
          fc.pre(false);
        }
        // B6: no sampled off-target gap on the intended target within `B6_MARGIN_MS` of graceTime, in either trace.
        const grace = c.cfg.profile.graceTime as number;
        if (![t15, t60].every((t) => t.checks.every((ch) => b6Holds(ch.allGaps, grace)))) {
          discardedB6++;
          fc.pre(false);
        }
        executions++;
        // Assertion 1.
        expect(selected(t15).map((e) => [e.entry, e.targetId])).toEqual(selected(t60).map((e) => [e.entry, e.targetId]));
        // Assertion 2.
        expectIdentity(c.cfg, t15, t60);
        // Reported only.
        for (const x of diffs(t15, t60)) largestTts = Math.max(largestTts, x.diff);
        t15.checks.forEach((a, i) => {
          const b = t60.checks[i];
          const D = Math.abs(a.arrival! - a.tMove0 - (b.arrival! - b.tMove0));
          largestD = Math.max(largestD, D);
        });
      }),
      { numRuns: 100, maxSkipsPerRun: 1000, ...(process.env.P7_SEED ? { seed: Number(process.env.P7_SEED) } : {}) },
    );
    const line =
      `[property 7] runs = ${result.numRuns}, executions = ${executions}, largest |tts15 - tts60| = ${largestTts.toFixed(3)} ms, ` +
        `largest single-entry D = ${largestD.toFixed(3)} ms, ` +
        `calls = ${calls}, discarded by B1/B2 = ${discardedB1B2}, by the aim assumption = ${discardedAim}, by B6 = ${discardedB6} ` +
        `(aim ${((100 * discardedAim) / Math.max(1, calls - discardedB1B2)).toFixed(1)}% of the cases that passed B1/B2; ` +
        `B6 ${((100 * discardedB6) / Math.max(1, calls - discardedB1B2 - discardedAim)).toFixed(1)}% of the cases that passed B1/B2 and aim; ` +
        `B1/B2 ${((100 * discardedB1B2) / Math.max(1, calls)).toFixed(1)}% of all calls; ` +
        `${((100 * (discardedB1B2 + discardedAim)) / Math.max(1, calls)).toFixed(1)}% of all calls), failed = ${result.failed}` +
        (result.failed ? `\n  counterexample: ${JSON.stringify(result.counterexample?.[0])}\n  ${String(result.errorInstance)}` : "");
    console.log(line);
    if (process.env.P7_LOG_FILE) appendFileSync(process.env.P7_LOG_FILE, `seed=${process.env.P7_SEED ?? "random"} ${line}\n`);
    expect(result.failed, String(result.errorInstance)).toBe(false);
  }, 900_000);
});
