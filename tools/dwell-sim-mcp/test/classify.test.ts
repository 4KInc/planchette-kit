import { describe, expect, it } from "vitest";
import {
  LAG_ALLOWANCE_MS,
  activityOf,
  classify,
  classifyMiss,
  createClassifyState,
  edgeDist,
  notePointerMove,
  phaseAt,
  type ClassifyContext,
} from "../src/classify.js";
import { toPx } from "../src/geometry.js";
import { insideRect } from "../src/plan-entry.js";
import type { RawEvent } from "../src/types.js";
import {
  ctxFor,
  geometry,
  hold,
  layout,
  mkPlan,
  move,
  pxPose,
  quiet,
  shaky,
  standardPlan,
  startNoRest,
} from "./classify-fixtures.js";

const select = (targetId: string, now: number): RawEvent => ({ kind: "select", targetId, now });
const run = (ctx: ClassifyContext, plan: ReturnType<typeof standardPlan> | null, e: RawEvent) =>
  classify(ctx, e, plan, createClassifyState());

describe("phaseAt and the activity label table", () => {
  const plan = standardPlan();
  it("returns the phase of the segment with t0 <= t < t1, the last phase from its end", () => {
    expect(phaseAt(plan, 1000)).toBe("waiting");
    expect(phaseAt(plan, 1499)).toBe("waiting");
    expect(phaseAt(plan, 1500)).toBe("moving");
    expect(phaseAt(plan, 2500)).toBe("holding");
    expect(phaseAt(plan, 99999)).toBe("holding");
  });
  it("a plan with no segments, or a time before the start plan, is start-of-session", () => {
    expect(phaseAt(startNoRest, 5)).toBe("start-of-session");
    expect(phaseAt({ segments: [hold(200, 500, pxPose(500, 500), "waiting")] }, 0)).toBe("waiting");
  });
  it("maps every phase to its label", () => {
    expect(activityOf("start-of-session")).toBe("waiting");
    expect(activityOf("waiting")).toBe("waiting");
    expect(activityOf("moving")).toBe("moving");
    expect(activityOf("reading-pause")).toBe("reading pause");
    expect(activityOf("holding")).toBe("holding on the aim point");
  });
});

describe("start-of-session events", () => {
  it("warm-up, reaction wait and start movement are start-of-session, whatever else would match", () => {
    const ctx = ctxFor(shaky);
    const plan = standardPlan();
    for (const now of [100, 300, 700, 999]) {
      expect(run(ctx, plan, select("goal", now))).toEqual({
        category: "start-of-session",
        activity: "waiting",
        cause: "start",
      });
    }
    expect(run(ctx, null, { kind: "cancel", now: 900 })).toEqual({
      category: "start-of-session",
      activity: "waiting",
      cause: "start",
    });
  });
  it("without a rest area the start plan has zero length: the event at tEnd is already an entry event", () => {
    const ctx = ctxFor(quiet, startNoRest);
    const plan = standardPlan();
    expect(run(ctx, null, select("mid", 999)).category).toBe("start-of-session");
    expect(run(ctx, plan, select("mid", 1000))).toEqual({
      category: "accidental",
      activity: "waiting",
      cause: "waiting",
    });
  });
});

describe("intended", () => {
  const ctx = ctxFor(quiet);
  it("select on the aimed target while holding", () => {
    expect(run(ctx, standardPlan(), select("goal", 3000))).toEqual({ category: "intended", activity: "holding on the aim point" });
  });
  it("select on the aimed target while moving once the planned position is inside it", () => {
    const plan = standardPlan();
    const q = toPx(geometry, ctx.headModel.basePose(plan, 2300));
    expect(insideRect(layout.targets[0]!.rect, q)).toBe(true);
    expect(run(ctx, plan, select("goal", 2300))).toEqual({ category: "intended", activity: "moving" });
  });
  it("cancel-role aim: a cancel with the matching targetId is intended", () => {
    const plan = standardPlan({ targetId: "cancel", role: "cancel", aim: pxPose(850, 150) });
    expect(run(ctx, plan, { kind: "cancel", targetId: "cancel", now: 3000 }).category).toBe("intended");
  });
  it("a select on the aimed cancel-role target is not intended", () => {
    const plan = standardPlan({ targetId: "cancel", role: "cancel", aim: pxPose(850, 150) });
    expect(run(ctx, plan, select("cancel", 3000))).toMatchObject({ category: "accidental", cause: "other" });
  });
  it("an unattributed cancel is never intended, even with tremor on", () => {
    const plan = standardPlan({ targetId: "cancel", role: "cancel", aim: pxPose(850, 150) });
    for (const c of [ctxFor(quiet), ctxFor(shaky)]) {
      expect(run(c, plan, { kind: "cancel", now: 3000 })).toEqual({
        category: "accidental",
        activity: "holding on the aim point",
        cause: "other",
      });
    }
  });
  it("a select on another target while holding is not intended", () => {
    expect(run(ctx, standardPlan(), select("mid", 3000))).toMatchObject({ category: "accidental" });
  });
});

describe("the seven accidental causes", () => {
  it("waiting: an event on the aimed target during the entry's reaction wait", () => {
    expect(run(ctxFor(quiet), standardPlan(), select("goal", 1200))).toEqual({
      category: "accidental",
      activity: "waiting",
      cause: "waiting",
    });
  });

  it("reading-pause: on the paused target, up to graceTime + 500 ms after the pause ends", () => {
    const at = pxPose(450, 500);
    const plan = mkPlan(
      [
        hold(1000, 1500, pxPose(500, 500), "waiting"),
        move(1500, 1800, pxPose(500, 500), at),
        hold(1800, 2000, at, "reading-pause"),
        move(2000, 2500, at, pxPose(850, 500)),
        hold(2500, 10000, pxPose(850, 500), "holding"),
      ],
      { pauses: [{ targetId: "mid", t0: 1800, t1: 2000 }] },
    );
    const ctx = ctxFor(quiet);
    expect(LAG_ALLOWANCE_MS).toBe(500);
    expect(run(ctx, plan, select("mid", 1900))).toEqual({ category: "accidental", activity: "reading pause", cause: "reading-pause" });
    // last ms inside the window: 2000 + 150 + 500 - 1, phase is already moving
    expect(run(ctx, plan, select("mid", 2649))).toMatchObject({ activity: "holding on the aim point", cause: "reading-pause" });
    expect(run(ctx, plan, select("mid", 2650))).toMatchObject({ cause: "other" });
    // another target is not covered by the pause
    expect(run(ctx, plan, select("rep", 1900))).toMatchObject({ cause: "other" });
  });

  it("repeat: the second event on an autoRepeat target with no pointer-move out of its rect", () => {
    const ctx = ctxFor(quiet);
    const plan1 = standardPlan();
    const plan2 = mkPlan(
      [hold(4000, 4500, pxPose(850, 500), "waiting"), hold(4500, 10000, pxPose(850, 500), "holding")],
      { entry: 1 },
    );
    const state = createClassifyState();
    const first = classify(ctx, select("rep", 3000), plan1, state);
    expect(first).toMatchObject({ category: "accidental", cause: "other" });
    notePointerMove(state, 150, 150); // inside rep: still no exit
    expect(classify(ctx, select("rep", 4100), plan2, state)).toEqual({
      category: "accidental",
      activity: "waiting",
      cause: "repeat", // wins over `waiting`
    });
  });
  it("repeat: a pointer-move that left the rect between the two events ends the repeat", () => {
    const ctx = ctxFor(quiet);
    const plan2 = mkPlan([hold(4000, 4500, pxPose(850, 500), "waiting"), hold(4500, 10000, pxPose(850, 500), "holding")], { entry: 1 });
    const state = createClassifyState();
    classify(ctx, select("rep", 3000), standardPlan(), state);
    notePointerMove(state, 600, 600);
    notePointerMove(state, 150, 150);
    expect(classify(ctx, select("rep", 4100), plan2, state)).toMatchObject({ cause: "waiting" });
  });
  it("repeat: the previous event must be on the same target", () => {
    const ctx = ctxFor(quiet);
    const state = createClassifyState();
    classify(ctx, select("mid", 3000), standardPlan(), state);
    expect(classify(ctx, select("rep", 3100), standardPlan(), state)).toMatchObject({ cause: "other" });
  });

  it("tremor-at-edge: planned position 5 px outside the target and tremor on (pass-over without tremor)", () => {
    const plan = mkPlan([
      hold(1000, 1500, pxPose(505, 500), "waiting"),
      move(1500, 2500, pxPose(505, 500), pxPose(506, 500)),
      hold(2500, 10000, pxPose(506, 500), "holding"),
    ]);
    expect(run(ctxFor(shaky), plan, select("mid", 2000))).toEqual({
      category: "accidental",
      activity: "moving",
      cause: "tremor-at-edge",
    });
    expect(run(ctxFor(quiet), plan, select("mid", 2000))).toMatchObject({ cause: "pass-over" });
  });

  it("early-on-intended-target: aimed target, still moving, planned position outside and far from the edge", () => {
    // planned x ~ 675 at t = 2000, 125 px from the goal; ampPx is 16
    const plan = standardPlan();
    expect(run(ctxFor(quiet), plan, select("goal", 2000))).toEqual({
      category: "accidental",
      activity: "moving",
      cause: "early-on-intended-target",
    });
    expect(run(ctxFor(shaky), plan, select("goal", 2000))).toMatchObject({ cause: "early-on-intended-target" });
  });
  it("early on the intended target within ampPx of its edge is tremor-at-edge, not early", () => {
    const plan = mkPlan([
      hold(1000, 1500, pxPose(780, 500), "waiting"),
      move(1500, 2500, pxPose(780, 500), pxPose(790, 500)),
      hold(2500, 10000, pxPose(850, 500), "holding"),
    ]);
    expect(run(ctxFor(shaky), plan, select("goal", 2000))).toMatchObject({ cause: "tremor-at-edge" });
    expect(run(ctxFor(quiet), plan, select("goal", 2000))).toMatchObject({ cause: "early-on-intended-target" });
  });

  it("pass-over: another target, moving, tremor off", () => {
    expect(run(ctxFor(quiet), standardPlan(), select("mid", 2000))).toEqual({
      category: "accidental",
      activity: "moving",
      cause: "pass-over",
    });
  });

  it("other: another target while holding on the aim point", () => {
    expect(run(ctxFor(quiet), standardPlan(), select("mid", 3000))).toEqual({
      category: "accidental",
      activity: "holding on the aim point",
      cause: "other",
    });
  });
});

describe("design section 6 decisions 5 to 10", () => {
  const nearMid = () =>
    mkPlan([
      hold(1000, 1500, pxPose(505, 500), "waiting"),
      move(1500, 2500, pxPose(505, 500), pxPose(506, 500)),
      hold(2500, 10000, pxPose(506, 500), "holding"),
    ]);

  it("5: a0 > 0 with f = 0 and n = 0 is off, so no tremor-at-edge and ampPx is 1 px", () => {
    const off = { ...quiet, tremorPeakToPeakDeg: 2, tremorFrequencyHz: 0 };
    expect(run(ctxFor(off), nearMid(), select("mid", 2000))).toMatchObject({ cause: "pass-over" });
  });
  it("5: noise alone turns it on, and the reach is n converted to px", () => {
    const noisy = { ...quiet, trackingNoiseDeg: 0.4 }; // 10 px per axis, ampPx = 1 + 10 * sqrt2
    expect(run(ctxFor(noisy), nearMid(), select("mid", 2000))).toMatchObject({ cause: "tremor-at-edge" });
  });

  it("6: without a pointer-move the P half is skipped; with one near the edge it applies", () => {
    const plan = mkPlan([
      hold(1000, 1500, pxPose(700, 500), "waiting"),
      hold(1500, 10000, pxPose(700, 500), "holding"),
    ]);
    const ctx = ctxFor(shaky);
    const none = createClassifyState();
    expect(classify(ctx, select("mid", 3000), plan, none)).toMatchObject({ cause: "other" });
    const seen = createClassifyState();
    notePointerMove(seen, 505, 500);
    expect(classify(ctx, select("mid", 3000), plan, seen)).toMatchObject({ cause: "tremor-at-edge" });
    const far = createClassifyState();
    notePointerMove(far, 700, 500);
    expect(classify(ctx, select("mid", 3000), plan, far)).toMatchObject({ cause: "other" });
  });

  it("7: miss cause tremor-at-edge uses edgeDist(aimPx, rect) <= ampPx(aim pose)", () => {
    const ctx = ctxFor(shaky);
    const hold0 = () => [hold(1000, 1500, pxPose(500, 500), "waiting")];
    const edge = mkPlan(hold0(), { aim: pxPose(810, 500) });
    expect(classifyMiss(ctx, edge)).toBe("tremor-at-edge"); // 10 px inside x = 800, ampPx 16
    const far = mkPlan(hold0(), { aim: pxPose(850, 500) });
    expect(classifyMiss(ctx, far)).toBe("other"); // 50 px from the edge
    expect(classifyMiss(ctxFor(quiet), edge)).toBe("other");
  });
  it("7: a target outside the reachable rectangle is unreachable, before the other causes", () => {
    const small = { ...geometry, headRange: { left: 10, right: 10, up: 10, down: 10 } };
    const ctx = ctxFor({ ...shaky, headRangeDeg: small.headRange }, undefined, small);
    const plan = mkPlan([hold(1000, 1500, pxPose(500, 500), "waiting")], { aim: pxPose(750, 500) });
    expect(classifyMiss(ctx, plan)).toBe("unreachable"); // reachable x is 250..750; goal starts at 800
  });

  it("8: the intended inside test is half-open and agrees with plan-entry's helper", () => {
    const goal = layout.targets[0]!.rect; // x 800..900, y 450..550
    const at = (x: number, y: number) =>
      mkPlan([hold(1000, 1500, pxPose(x, y), "waiting"), move(1500, 2500, pxPose(x, y), pxPose(x, y)), hold(2500, 10000, pxPose(x, y), "holding")]);
    const ctx = ctxFor(quiet);
    const cases: Array<[number, number, boolean]> = [
      [800, 500, true],
      [900, 500, false],
      [850, 450, true],
      [850, 550, false],
    ];
    for (const [x, y, inside] of cases) {
      expect(insideRect(goal, { x, y })).toBe(inside);
      const c = run(ctx, at(x, y), select("goal", 2000));
      expect(c.category).toBe(inside ? "intended" : "accidental");
    }
  });

  it("9: edgeDist is 0 on the boundary and continuous across it", () => {
    const r = { x: 10, y: 20, width: 30, height: 40 };
    expect(edgeDist({ x: 10, y: 30 }, r)).toBe(0);
    expect(edgeDist({ x: 40, y: 60 }, r)).toBe(0);
    expect(edgeDist({ x: 25, y: 20 }, r)).toBe(0);
    expect(edgeDist({ x: 43, y: 64 }, r)).toBe(5); // 3-4-5 from the corner
    expect(edgeDist({ x: 15, y: 40 }, r)).toBe(5); // inside: nearest edge is the left one
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
      const eps = 1e-6;
      const onEdge = { x: dx === 1 ? 40 : dx === -1 ? 10 : 25, y: dy === 1 ? 60 : dy === -1 ? 20 : 40 };
      const out = edgeDist({ x: onEdge.x + dx * eps, y: onEdge.y + dy * eps }, r);
      const inn = edgeDist({ x: onEdge.x - dx * eps, y: onEdge.y - dy * eps }, r);
      expect(out).toBeCloseTo(eps, 9);
      expect(inn).toBeCloseTo(eps, 9);
    }
  });

  it("10: repeat state starts at the start plan's tEnd; a start-of-session event is never the previous event", () => {
    const ctx = ctxFor(quiet);
    const state = createClassifyState();
    expect(classify(ctx, select("rep", 600), standardPlan(), state).category).toBe("start-of-session");
    expect(state.prevTargetId).toBeNull();
    // first entry event, in the reaction wait: not a repeat
    expect(classify(ctx, select("rep", 1100), standardPlan(), state)).toMatchObject({ cause: "waiting" });
  });
  it("10: an event with no targetId is never repeat and never tremor-at-edge", () => {
    const ctx = ctxFor(shaky);
    const state = createClassifyState();
    notePointerMove(state, 505, 500);
    const plan = nearMid();
    for (const now of [1200, 2000, 3000]) {
      const c = classify(ctx, { kind: "cancel", now }, plan, state);
      expect(c.category).toBe("accidental");
      expect(c).not.toMatchObject({ cause: "repeat" });
      expect(c).not.toMatchObject({ cause: "tremor-at-edge" });
    }
    // after an event on an autoRepeat target, a no-id event does not match it either
    classify(ctx, select("rep", 3000), plan, state);
    expect(classify(ctx, { kind: "cancel", now: 3100 }, plan, state)).not.toMatchObject({ cause: "repeat" });
  });
});

describe("miss causes (post-release fix: aim-outside-target)", () => {
  const holdAt = () => [hold(1000, 1500, pxPose(500, 500), "waiting")];
  const missAt = (x: number, y: number) => mkPlan(holdAt(), { aim: pxPose(x, y) }); // goal is x 800..900, y 450..550
  const small = { ...geometry, headRange: { left: 10, right: 10, up: 10, down: 10 } };

  it("one example per miss cause", () => {
    expect(classifyMiss(ctxFor(quiet), missAt(850, 500))).toBe("other");
    expect(classifyMiss(ctxFor(shaky), missAt(810, 500))).toBe("tremor-at-edge");
    expect(classifyMiss(ctxFor(quiet), missAt(700, 500))).toBe("aim-outside-target");
    expect(classifyMiss(ctxFor({ ...shaky, headRangeDeg: small.headRange }, undefined, small), missAt(850, 500))).toBe("unreachable");
  });
  it("an aim outside the rect on a reachable target with tremor off is aim-outside-target, not other", () => {
    expect(classifyMiss(ctxFor(quiet), missAt(600, 500))).toBe("aim-outside-target");
  });
  it("an unreachable target whose aim is also outside is unreachable", () => {
    const ctx = ctxFor({ ...shaky, headRangeDeg: small.headRange }, undefined, small);
    expect(classifyMiss(ctx, missAt(750, 500))).toBe("unreachable");
  });
  it("an aim outside the rect near the edge with tremor on is aim-outside-target, not tremor-at-edge", () => {
    expect(classifyMiss(ctxFor(shaky), missAt(795, 500))).toBe("aim-outside-target"); // 5 px outside, ampPx 16
  });
  it("is half-open: left and top edges are inside, right and bottom edges are outside", () => {
    const ctx = ctxFor(quiet);
    expect(classifyMiss(ctx, missAt(800, 500))).toBe("other");
    expect(classifyMiss(ctx, missAt(850, 450))).toBe("other");
    expect(classifyMiss(ctx, missAt(900, 500))).toBe("aim-outside-target");
    expect(classifyMiss(ctx, missAt(850, 550))).toBe("aim-outside-target");
  });
});
