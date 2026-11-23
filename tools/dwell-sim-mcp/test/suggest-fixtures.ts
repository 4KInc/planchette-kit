import type { Profile } from "@planchette/skeleton";
import type { GeometryContext } from "../src/geometry.js";
import type { AccidentalRecord, TrialEntryResult, TrialResult } from "../src/metrics.js";
import type { SuggestUser } from "../src/suggest.js";
import type { AccidentalCause, Layout, LayoutTarget } from "../src/types.js";

export const SCREEN = { width: 1001, height: 601 };

export function geometry(headRange: number, calibration = 10): GeometryContext {
  return {
    profile: {
      headGain: 1,
      headDeadZone: 0,
      calibrationRangeLeft: calibration,
      calibrationRangeRight: calibration,
      calibrationRangeUp: calibration,
      calibrationRangeDown: calibration,
    },
    screen: SCREEN,
    headRange: { left: headRange, right: headRange, up: headRange, down: headRange },
  };
}

export const FULL = geometry(10);
/** Reaches x 250..750, y 150..450 only. */
export const SMALL = geometry(5);

export function target(
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 50,
  role: LayoutTarget["role"] = "default",
): LayoutTarget {
  return { id, rect: { x, y, width, height }, autoRepeat: false, role };
}

export function layoutOf(...targets: LayoutTarget[]): Layout {
  return { screen: SCREEN, targets };
}

export type MissCause = TrialEntryResult["missCause"];

export interface TrialSpec {
  accidental?: ReadonlyArray<{ target: string | null; cause: AccidentalCause }>;
  misses?: ReadonlyArray<{ target: string; cause: MissCause }>;
  starts?: ReadonlyArray<string | null>;
}

export function trial(userName: string, spec: TrialSpec, trialIndex = 0): TrialResult {
  const accidental: AccidentalRecord[] = (spec.accidental ?? []).map((a, i) => ({
    targetId: a.target,
    timeMs: i,
    activity: "waiting",
    cause: a.cause,
    entry: i,
  }));
  const entries: TrialEntryResult[] = (spec.misses ?? []).map((m, i) => ({
    entry: i,
    targetId: m.target,
    outcome: "miss",
    timeToSelectMs: null,
    missCause: m.cause,
  }));
  return {
    userName,
    trialIndex,
    entries,
    accidental,
    startEvents: (spec.starts ?? []).map((id, i) => ({ targetId: id, timeMs: i })),
    warnings: [],
    effectiveProfile: {} as Profile,
  };
}

export function user(name: string, trials: TrialResult[], geo: GeometryContext = FULL): SuggestUser {
  return { name, trials, geometry: geo };
}

export function repeat<T>(n: number, v: T): T[] {
  return Array.from({ length: n }, () => v);
}
