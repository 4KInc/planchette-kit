/**
 * Property 5: Same random draws when comparing (design, Correctness Properties; Testing Strategy item 5).
 *
 * Part 1: configurations A and B differ only in a non-empty subset of the five timing fields
 * (`dwellTime`, `graceTime`, `postSelectionPause`, `autoRepeatInterval`, `smoothingStrength`). Every value
 * is drawn from the skeleton's clamp range for its field, `clampProfile` in
 * `skeleton/src/engine/profile.ts` lines 234-237 and 233: dwellTime 400..3000, graceTime 0..500,
 * postSelectionPause 200..3000, autoRepeatInterval 500..3000, smoothingStrength 0..1. The defaults
 * (1000, 150, 500, 1000, 0.5) are drawn too, with weight 1 in 6, so "equal to the default" is covered.
 * Both runs are driven with `openTrial` / `runWarmup` / `runStartOfSession` / `runEntries`, with the
 * `observers.onSample` hook (head samples, warm-up included; the rotation object is reused, so the two
 * numbers are copied) and `observers.onEvent` (the event slot is reused, so the fields are copied).
 *
 * (a) Cut-off. The first index `i` in `onEvent` order where `(kind, targetId, now)` differs between the two
 *     lists, or, if one list is a prefix of the other, the first extra event. When the two events at `i` have
 *     different `now`, the EARLIER `now` is the cut-off time (the first moment the runs can diverge; this is the
 *     stricter reading). The sample sequences must be equal element by element (now, yaw, pitch, phase) for
 *     every frame with `now` <= the cut-off `now` (the cut-off frame, inclusive; frame index =
 *     round(now / frameMs)). Not the frame after it: the cut-off frame is fed before its event exists, but the
 *     next frame can already be under a different entry in one run, because an entry may resolve before its
 *     move ends (design section 5, section 9). With identical event lists, every common sample is compared.
 *     Frames exist at `now = index * frameMs`.
 * (b) Aim. `(zx, zy) = (ttn(u01(aim, k, 0)), ttn(u01(aim, k, 1)))`, recomputed in the test with
 *     `stream(seed, user.key, trial, Purpose.Aim)`, is equal for A and B. This holds by construction (same
 *     inputs, a pure function); it is asserted so that a change of the key derivation shows up. The real check
 *     is that `plans[k].aim` is equal between A and B, for the plans of the run (`d.plans`) and for a plan
 *     built in the test with `planEntry(planCtx, k, 0, ZERO)` for EVERY task entry on each side (the aim does
 *     not depend on `tEntry` or `p0`). Each aim also equals `sampleAim` on the test-built Aim stream.
 *
 * Part 2: A and B differ in head gain, dead zone or screen size (a non-empty subset). The new screen keeps the
 * rects and contains every rect by construction (width >= max(x + width), height >= max(y + height)), so there
 * is no `fc.pre` and the discard rate is 0. Only the draw keys (the seeds of the four plan streams) and the
 * recomputed `(zx, zy)` per entry are asserted equal, plus that both runs plan exactly `task.length` entries,
 * entry `k` of both runs having `entry === k` and `targetId === task[k]`. The samples are not compared.
 *
 * Tests use fast-check only for randomness; no `Math.random` and no clock.
 *
 * **Property 5: Same random draws when comparing**
 * **Validates: Requirements 5.1, 5.7, 5.8**
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Profile } from "@planchette/skeleton";
import { layoutArb, profileArb, resolvedUserArb, taskArb } from "./arbitraries.js";
import { planEntry } from "../src/plan-entry.js";
import { Purpose, stream, u01 } from "../src/rng.js";
import {
  openTrial,
  runEntries,
  runStartOfSession,
  runWarmup,
  type FramePhase,
  type TrialConfig,
} from "../src/run-trial.js";
import { sampleAim, ttn } from "../src/scatter.js";
import { expandTask } from "../src/task.js";
import type { Layout, Pose, ResolvedUser } from "../src/types.js";

const ZERO: Pose = { yaw: 0, pitch: 0 };
const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

type TimingField = "dwellTime" | "graceTime" | "postSelectionPause" | "autoRepeatInterval" | "smoothingStrength";
const TIMING_FIELDS: readonly TimingField[] = [
  "dwellTime",
  "graceTime",
  "postSelectionPause",
  "autoRepeatInterval",
  "smoothingStrength",
];
type Timing = Record<TimingField, number>;

/** Defaults of the skeleton (`defaultProfile`): 1000, 150, 500, 1000, 0.5. */
const DEFAULT_TIMING: Timing = {
  dwellTime: 1000,
  graceTime: 150,
  postSelectionPause: 500,
  autoRepeatInterval: 1000,
  smoothingStrength: 0.5,
};

/** One value of a timing field: inside the clamp range, or exactly the default (1 in 6). */
function timingValue(field: TimingField, range: fc.Arbitrary<number>): fc.Arbitrary<number> {
  return fc.oneof({ weight: 5, arbitrary: range }, { weight: 1, arbitrary: fc.constant(DEFAULT_TIMING[field]) });
}

const timingArb: fc.Arbitrary<Timing> = fc.record({
  dwellTime: timingValue("dwellTime", fc.integer({ min: 400, max: 3000 })),
  graceTime: timingValue("graceTime", fc.integer({ min: 0, max: 500 })),
  postSelectionPause: timingValue("postSelectionPause", fc.integer({ min: 200, max: 3000 })),
  autoRepeatInterval: timingValue("autoRepeatInterval", fc.integer({ min: 500, max: 3000 })),
  smoothingStrength: timingValue("smoothingStrength", fc.double({ min: 0, max: 1, noNaN: true })),
});

interface Common {
  layout: Layout;
  user: ResolvedUser;
  /** Expanded task. */
  task: string[];
  fps: 15 | 30 | 60;
  analysisWindowMs: number;
  requestSeed: number;
  trialIndex: number;
}

const commonArb: fc.Arbitrary<Common> = fc
  .tuple(fc.boolean(), resolvedUserArb())
  .chain(([autoRepeat, user]) =>
    layoutArb({ minTargets: 1, maxTargets: 5, includeAutoRepeat: autoRepeat }).chain((layout) =>
      fc
        .tuple(
          taskArb(layout, { maxLength: 5, maxEach: 2 }),
          fc.constantFrom<15 | 30 | 60>(15, 30, 60),
          fc.integer({ min: 2000, max: 6000 }),
          fc.integer({ min: -(2 ** 31), max: 2 ** 31 - 1 }),
          fc.integer({ min: 0, max: 4 }),
        )
        .map(([spec, fps, analysisWindowMs, requestSeed, trialIndex]): Common => {
          const expanded = expandTask(layout, spec, requestSeed);
          if (!expanded.ok) throw new Error("taskArb produced an invalid task");
          return { layout, user, task: expanded.ids, fps, analysisWindowMs, requestSeed, trialIndex };
        }),
    ),
  );

// ---------------------------------------------------------------------------
// One run, recorded
// ---------------------------------------------------------------------------

interface SampleRec {
  now: number;
  yaw: number;
  pitch: number;
  phase: FramePhase;
}
interface EventRec {
  kind: "select" | "cancel";
  targetId: string | undefined;
  now: number;
}
interface Recorded {
  frameMs: number;
  samples: SampleRec[];
  events: EventRec[];
  /** `d.plans[k].aim` of the run. */
  planAims: Pose[];
  planEntries: { entry: number; targetId: string }[];
  /** Aim of `planEntry(planCtx, k, 0, ZERO)` for every task entry. */
  builtAims: Pose[];
  /** Aim of `sampleAim` on the test-built Aim stream, for every task entry. */
  sampledAims: Pose[];
  seeds: { aim: number; readingChance: number; readingLength: number; start: number };
}

function record(common: Common, layout: Layout, profile: Partial<Profile>): Recorded {
  const samples: SampleRec[] = [];
  const events: EventRec[] = [];
  const cfg: TrialConfig = {
    layout,
    profile,
    user: common.user,
    mode: "head + dwell",
    task: common.task,
    fps: common.fps,
    analysisWindowMs: common.analysisWindowMs,
    requestSeed: common.requestSeed,
    trialIndex: common.trialIndex,
    observers: {
      // The rotation and the event slot are reused objects: copy the numbers.
      onSample(now, rotation, phase) {
        samples.push({ now, yaw: rotation.yaw, pitch: rotation.pitch, phase });
      },
      onEvent(e) {
        events.push({ kind: e.kind, targetId: e.targetId, now: e.now });
      },
    },
  };
  const d = openTrial(cfg);
  try {
    runWarmup(d);
    const s = runStartOfSession(d);
    runEntries(d, s);
    const aimStream = stream(common.requestSeed, common.user.key, common.trialIndex, Purpose.Aim);
    const builtAims: Pose[] = [];
    const sampledAims: Pose[] = [];
    common.task.forEach((id, k) => {
      builtAims.push(planEntry(s.planCtx, k, 0, ZERO).aim);
      const rect = layout.targets.find((t) => t.id === id)!.rect;
      sampledAims.push(sampleAim(d.geometry, rect, common.user.params.scatterCapDeg, aimStream, k));
    });
    return {
      frameMs: d.frameMs,
      samples,
      events,
      planAims: d.plans.map((p) => ({ yaw: p.aim.yaw, pitch: p.aim.pitch })),
      planEntries: d.plans.map((p) => ({ entry: p.entry, targetId: p.targetId })),
      builtAims,
      sampledAims,
      seeds: {
        aim: d.streams.aim.seed,
        readingChance: d.streams.readingChance.seed,
        readingLength: d.streams.readingLength.seed,
        start: d.streams.start.seed,
      },
    };
  } finally {
    d.pl.destroy();
  }
}

/** `(zx, zy)` per entry, recomputed from the stream key the way the design writes it. */
function recomputeZ(common: Common): [number, number][] {
  const aim = stream(common.requestSeed, common.user.key, common.trialIndex, Purpose.Aim);
  return common.task.map((_, k) => [ttn(u01(aim, k, 0)), ttn(u01(aim, k, 1))]);
}

/** The first differing event (see the file header), or null when the lists are identical. */
function cutOff(a: EventRec[], b: EventRec[]): { index: number; now: number } | null {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i].kind !== b[i].kind || a[i].targetId !== b[i].targetId || a[i].now !== b[i].now) {
      return { index: i, now: Math.min(a[i].now, b[i].now) };
    }
  }
  if (a.length !== b.length) return { index: n, now: (a.length > b.length ? a : b)[n].now };
  return null;
}

/** First mismatch between two sample lists over the frames with `now` <= `limitNow` (inclusive), or null. */
function firstSampleMismatch(a: SampleRec[], b: SampleRec[], limitNow: number): string | null {
  const n = Math.min(a.length, b.length);
  for (let j = 0; j < n; j++) {
    const x = a[j];
    const y = b[j];
    if (x.now > limitNow && y.now > limitNow) break;
    if (x.now !== y.now || x.yaw !== y.yaw || x.pitch !== y.pitch || x.phase !== y.phase) {
      return `sample ${j}: A = ${JSON.stringify(x)}, B = ${JSON.stringify(y)}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Part 1
// ---------------------------------------------------------------------------

interface Part1Case {
  common: Common;
  base: Partial<Profile>;
  a: Timing;
  b: Timing;
  subset: TimingField[];
}

const part1Arb: fc.Arbitrary<Part1Case> = fc
  .tuple(commonArb, profileArb(), timingArb, timingArb, fc.subarray([...TIMING_FIELDS], { minLength: 1 }))
  .map(([common, base, a, b, subset]) => ({ common, base, a, b, subset }));

describe("Property 5: Same random draws when comparing", () => {
  it("part 1: timing fields only: same head samples up to the first differing event, same aims", () => {
    let executions = 0;
    let identicalEvents = 0;
    let withCutOff = 0;
    let comparedTotal = 0;
    let longestCompared = 0;
    let cutNonTrivial = 0;
    let cutIndexSum = 0;
    let cutIndexMax = 0;
    const result = fc.check(
      fc.property(part1Arb, (c) => {
        // B equals A except in the subset.
        const timingB: Timing = { ...c.a };
        for (const f of c.subset) timingB[f] = c.b[f];
        const runA = record(c.common, c.common.layout, { ...c.base, ...c.a });
        const runB = record(c.common, c.common.layout, { ...c.base, ...timingB });
        executions++;

        // (a) Samples for every frame with now <= the cut-off event's now (cut-off frame inclusive).
        const cut = cutOff(runA.events, runB.events);
        const limitNow = cut === null ? Number.POSITIVE_INFINITY : cut.now;
        const mismatch = firstSampleMismatch(runA.samples, runB.samples, limitNow);
        expect(mismatch, `head samples differ before the cut-off (cut = ${JSON.stringify(cut)}): ${mismatch}`).toBeNull();
        let compared = 0;
        while (
          compared < Math.min(runA.samples.length, runB.samples.length) &&
          runA.samples[compared].now <= limitNow
        ) compared++;
        comparedTotal += compared;
        longestCompared = Math.max(longestCompared, compared);
        if (cut === null) identicalEvents++;
        else {
          withCutOff++;
          const idx = Math.round(cut.now / runA.frameMs);
          cutIndexSum += idx;
          cutIndexMax = Math.max(cutIndexMax, idx);
          if (cut.now > 0 && compared > 1) cutNonTrivial++;
        }

        // (b) Aim: (zx, zy) per entry (equal by construction), plans[k].aim equal between A and B.
        const zA = recomputeZ(c.common);
        const zB = recomputeZ(c.common);
        expect(zB).toEqual(zA);
        expect(runB.planAims.length).toBeGreaterThan(0);
        const common = Math.min(runA.planAims.length, runB.planAims.length);
        for (let k = 0; k < common; k++) {
          expect(runB.planAims[k], `plans[${k}].aim of the runs`).toEqual(runA.planAims[k]);
        }
        expect(runB.builtAims, "planEntry(ctx, k, 0, ZERO).aim for every entry").toEqual(runA.builtAims);
        expect(runA.sampledAims, "A: plan aim is sampleAim on the Aim stream").toEqual(runA.builtAims);
        expect(runB.sampledAims, "B: plan aim is sampleAim on the Aim stream").toEqual(runB.builtAims);
        // The aims of the runs are the aims of the built plans.
        for (let k = 0; k < common; k++) expect(runA.planAims[k]).toEqual(runA.builtAims[k]);
      }),
      { numRuns: NUM_RUNS },
    );
    console.log(
      `[property 5, part 1] runs = ${result.numRuns}, executions = ${executions}, discards (fc.pre) = 0 (none used, discard rate 0%), ` +
        `event lists identical = ${identicalEvents}, with a cut-off = ${withCutOff} (non-trivial: ${cutNonTrivial}), ` +
        `cut-off frame index: mean = ${(cutIndexSum / Math.max(1, withCutOff)).toFixed(1)}, max = ${cutIndexMax}, ` +
        `samples compared per run: mean = ${(comparedTotal / Math.max(1, executions)).toFixed(0)}, max = ${longestCompared}, ` +
        `failed = ${result.failed}` +
        (result.failed ? `\n  counterexample: ${JSON.stringify(result.counterexample?.[0])}\n  ${String(result.errorInstance)}` : ""),
    );
    expect(result.failed, String(result.errorInstance)).toBe(false);
  }, 900_000);

  // -------------------------------------------------------------------------
  // Part 2
  // -------------------------------------------------------------------------

  type Changed = "headGain" | "headDeadZone" | "screen";

  const part2Arb = fc
    .tuple(
      commonArb,
      profileArb(),
      profileArb(),
      fc.subarray<Changed>(["headGain", "headDeadZone", "screen"], { minLength: 1 }),
    )
    .chain(([common, pa, pb, changed]) => {
      // A screen that contains every rect, by construction.
      const maxRight = Math.max(...common.layout.targets.map((t) => t.rect.x + t.rect.width));
      const maxBottom = Math.max(...common.layout.targets.map((t) => t.rect.y + t.rect.height));
      return fc
        .tuple(
          fc.integer({ min: maxRight, max: maxRight + 1500 }),
          fc.integer({ min: maxBottom, max: maxBottom + 1000 }),
        )
        .map(([width, height]) => ({ common, pa, pb, changed, screenB: { width, height } }));
    });

  it("part 2: gain, dead zone or screen size: same draw keys and (zx, zy), entries planned consistently", () => {
    let executions = 0;
    let screenChanged = 0;
    let screenDiffers = 0;
    let samplesDiffer = 0;
    const result = fc.check(
      fc.property(part2Arb, ({ common, pa, pb, changed, screenB }) => {
        const profileB: Partial<Profile> = { ...pa };
        if (changed.includes("headGain")) profileB.headGain = pb.headGain;
        if (changed.includes("headDeadZone")) profileB.headDeadZone = pb.headDeadZone;
        const layoutB: Layout = changed.includes("screen") ? { ...common.layout, screen: screenB } : common.layout;
        // By construction: the new screen contains every rect.
        for (const t of layoutB.targets) {
          expect(t.rect.x + t.rect.width).toBeLessThanOrEqual(layoutB.screen.width);
          expect(t.rect.y + t.rect.height).toBeLessThanOrEqual(layoutB.screen.height);
        }
        const runA = record(common, common.layout, pa);
        const runB = record({ ...common }, layoutB, profileB);
        executions++;
        if (changed.includes("screen")) {
          screenChanged++;
          if (layoutB.screen.width !== common.layout.screen.width || layoutB.screen.height !== common.layout.screen.height) {
            screenDiffers++;
          }
        }
        if (firstSampleMismatch(runA.samples, runB.samples, Number.POSITIVE_INFINITY) !== null) samplesDiffer++;

        // Draw keys.
        expect(runB.seeds).toEqual(runA.seeds);
        // (zx, zy) recomputed from the key: equal (by construction), finite and inside (-3, 3).
        const zA = recomputeZ(common);
        const zB = recomputeZ(common);
        expect(zB).toEqual(zA);
        for (const [zx, zy] of zA) {
          expect(Math.abs(zx)).toBeLessThan(3);
          expect(Math.abs(zy)).toBeLessThan(3);
        }
        // Entries planned: every entry is planned once in each run, with the same index and target.
        expect(runA.planEntries.length).toBe(common.task.length);
        expect(runB.planEntries.length).toBe(common.task.length);
        const n = Math.min(runA.planEntries.length, runB.planEntries.length);
        for (let k = 0; k < n; k++) {
          expect(runA.planEntries[k]).toEqual({ entry: k, targetId: common.task[k] });
          expect(runB.planEntries[k]).toEqual({ entry: k, targetId: common.task[k] });
        }
      }),
      { numRuns: NUM_RUNS },
    );
    console.log(
      `[property 5, part 2] runs = ${result.numRuns}, executions = ${executions}, discards (fc.pre) = 0 (screen contains every rect by construction), ` +
        `screen in the changed subset = ${screenChanged} (size actually different: ${screenDiffers}), ` +
        `head samples differ between A and B (not asserted) = ${samplesDiffer}, failed = ${result.failed}` +
        (result.failed ? `\n  counterexample: ${JSON.stringify(result.counterexample?.[0])}\n  ${String(result.errorInstance)}` : ""),
    );
    expect(result.failed, String(result.errorInstance)).toBe(false);
  }, 900_000);
});
