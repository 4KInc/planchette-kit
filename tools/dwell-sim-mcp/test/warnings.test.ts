import { describe, expect, it } from "vitest";
import { PRESETS } from "../src/presets.js";
import { WARNING_CENTRE_STEP_CAP, WARNING_START_CLAMPED } from "../src/run-trial.js";
import type { Layout, LayoutTarget, UserParams } from "../src/types.js";
import {
  NO_CANCEL_TARGET,
  NO_REST_AREA,
  TREMOR_ABOVE_TUNED,
  buildWarnings,
  type UserTrialWarnings,
} from "../src/warnings.js";

const target = (id: string, role: LayoutTarget["role"]): LayoutTarget => ({
  id,
  role,
  autoRepeat: false,
  rect: { x: 0, y: 0, width: 100, height: 100 },
});

const layoutOf = (...roles: LayoutTarget["role"][]): Layout => ({
  screen: { width: 1000, height: 800 },
  targets: roles.map((r, i) => target(`t${i}`, r)),
});

const FULL = layoutOf("default", "rest-area", "cancel");

function user(name: string, tremor = 0, warnings: string[][] = []): UserTrialWarnings {
  const params: UserParams = { ...flat(), tremorPeakToPeakDeg: tremor };
  return { user: { name, params }, trials: warnings.map((w) => ({ warnings: w })) };
}

function flat(): UserParams {
  const p = PRESETS.steady.params;
  return {
    throughputBitsPerS: p.throughputBitsPerS.value,
    tremorFrequencyHz: p.tremorFrequencyHz.value,
    tremorPeakToPeakDeg: p.tremorPeakToPeakDeg.value,
    tremorAxis: p.tremorAxis.value,
    tremorDriftFraction: p.tremorDriftFraction.value,
    headRangeDeg: p.headRangeDeg.value,
    reactionTimeMs: p.reactionTimeMs.value,
    readingPauseChancePct: p.readingPauseChancePct.value,
    readingPauseLengthMs: p.readingPauseLengthMs.value,
    trackingNoiseDeg: p.trackingNoiseDeg.value,
    scatterCapDeg: p.scatterCapDeg.value,
    scanReactionTimeMs: p.scanReactionTimeMs.value,
    scanLatePressChancePct: p.scanLatePressChancePct.value,
    scanPressDurationMs: p.scanPressDurationMs.value,
  };
}

const run = (layout: Layout, mode: "head + dwell" | "scan", users: UserTrialWarnings[]) =>
  buildWarnings({ layout, mode, users });

describe("layout warnings", () => {
  it("a full layout gives none in head + dwell", () => {
    expect(run(FULL, "head + dwell", [user("a")]).warnings).toEqual([]);
  });

  it("missing rest area gives only NO_REST_AREA, naming the role", () => {
    const { warnings } = run(layoutOf("default", "cancel"), "head + dwell", [user("a")]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.startsWith(`${NO_REST_AREA}:`)).toBe(true);
    expect(warnings[0]).toContain("rest-area");
  });

  it("missing cancel gives only NO_CANCEL_TARGET, naming the role", () => {
    const { warnings } = run(layoutOf("default", "rest-area"), "head + dwell", [user("a")]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.startsWith(`${NO_CANCEL_TARGET}:`)).toBe(true);
    expect(warnings[0]).toContain("cancel");
  });

  it("missing both gives both, rest area first", () => {
    const { warnings } = run(layoutOf("default"), "head + dwell", [user("a")]);
    expect(warnings.map((w) => w.split(":")[0])).toEqual([NO_REST_AREA, NO_CANCEL_TARGET]);
  });

  it("an empty target list gives both", () => {
    expect(run(layoutOf(), "head + dwell", []).warnings).toHaveLength(2);
  });

  it("never appear in scan mode", () => {
    expect(run(layoutOf("default"), "scan", [user("a")]).warnings).toEqual([]);
    expect(run(layoutOf(), "scan", [user("a")]).warnings).toEqual([]);
  });
});

describe("tremor note", () => {
  it("exactly 1 degree gives no note", () => {
    expect(run(FULL, "head + dwell", [user("a", 1)]).notes).toEqual([]);
  });

  it("above 1 degree gives one note naming the user and the amount", () => {
    const { notes } = run(FULL, "head + dwell", [user("strong-head-tremor", 1.6)]);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.startsWith(`${TREMOR_ABOVE_TUNED}:`)).toBe(true);
    expect(notes[0]).toContain("strong-head-tremor");
    expect(notes[0]).toContain("1.6");
  });

  it("one note per user above 1, in request order, skipping others", () => {
    const { notes } = run(FULL, "head + dwell", [user("b", 2), user("quiet", 0.46), user("a", 1.01)]);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain("user b");
    expect(notes[1]).toContain("user a");
  });

  it("is not given in scan mode, even above 1 degree", () => {
    expect(run(FULL, "scan", [user("a", 2)]).notes).toEqual([]);
  });
});

describe("aggregated trial warnings", () => {
  it("counts trials per user and code", () => {
    const trials = Array.from({ length: 10 }, () => [WARNING_START_CLAMPED]);
    const { warnings } = run(FULL, "head + dwell", [user("small-range", 0, trials)]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.startsWith(`${WARNING_START_CLAMPED}:`)).toBe(true);
    expect(warnings[0]).toContain("small-range");
    expect(warnings[0]).toContain("10 of 10 trials");
  });

  it("counts only the trials that raised it", () => {
    const { warnings } = run(FULL, "head + dwell", [
      user("a", 0, [[WARNING_CENTRE_STEP_CAP], [], [WARNING_CENTRE_STEP_CAP]]),
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("2 of 3 trials");
  });

  it("a duplicate warning inside one trial counts that trial once", () => {
    const { warnings } = run(FULL, "head + dwell", [user("a", 0, [[WARNING_START_CLAMPED, WARNING_START_CLAMPED]])]);
    expect(warnings[0]).toContain("1 of 1 trials");
  });

  it("orders by user in request order, then start-clamped before centre-step-cap", () => {
    const { warnings } = run(layoutOf("default"), "head + dwell", [
      user("second", 0, [[WARNING_CENTRE_STEP_CAP, WARNING_START_CLAMPED]]),
      user("first", 0, [[WARNING_CENTRE_STEP_CAP]]),
    ]);
    expect(warnings.map((w) => w.split(":")[0])).toEqual([
      NO_REST_AREA,
      NO_CANCEL_TARGET,
      WARNING_START_CLAMPED,
      WARNING_CENTRE_STEP_CAP,
      WARNING_CENTRE_STEP_CAP,
    ]);
    expect(warnings[2]).toContain("second");
    expect(warnings[3]).toContain("second");
    expect(warnings[4]).toContain("first");
  });

  it("gives no entry for a user without warnings", () => {
    const { warnings } = run(FULL, "head + dwell", [user("clean", 0, [[], []]), user("dirty", 0, [[WARNING_START_CLAMPED]])]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("dirty");
  });

  it("ignores unknown trial warning codes", () => {
    expect(run(FULL, "head + dwell", [user("a", 0, [["something-else"]])]).warnings).toEqual([]);
  });

  it("is also aggregated in scan mode", () => {
    const { warnings } = run(FULL, "scan", [user("a", 0, [[WARNING_CENTRE_STEP_CAP]])]);
    expect(warnings).toHaveLength(1);
  });
});

describe("shape", () => {
  it("always returns arrays of strings that start with a code and a colon", () => {
    const empty = run(FULL, "scan", []);
    expect(empty).toEqual({ warnings: [], notes: [] });

    const r = run(layoutOf(), "head + dwell", [
      user("a", 3, [[WARNING_START_CLAMPED, WARNING_CENTRE_STEP_CAP]]),
    ]);
    const all = [...r.warnings, ...r.notes];
    expect(all.length).toBe(5);
    for (const s of all) {
      expect(typeof s).toBe("string");
      expect(s).toMatch(/^[A-Za-z_-]+: /);
    }
  });
});
