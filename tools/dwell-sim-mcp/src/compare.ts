/**
 * `compare` core (design section 9). Runs two configurations with the same users, seed, user
 * keys, trial indices and one expanded task, pairs the trials and returns only the compare
 * shape. It applies no defaults except b's layout, and reads no clock.
 */
import type { Profile } from "@planchette/skeleton";
import { DISCLAIMER } from "./disclaimer.js";
import { pairTrials, summarizePairs, type ComparePair, type PairMetrics } from "./pairing.js";
import { runUser, type RunUserConfig } from "./run-user.js";
import { SimulateError } from "./simulate.js";
import { expandTask } from "./task.js";
import type { Layout, ResolvedUser, SimulateRequest, TaskSpec, UserParams } from "./types.js";
import { buildWarnings } from "./warnings.js";

export const COMPARE_STATEMENT = "These counts are not a test of statistical significance.";

export interface CompareRequest {
  a: { layout: Layout; profile?: Partial<Profile>; label?: string };
  /** `b.layout` defaults to `a.layout`. */
  b: { layout?: Layout; profile?: Partial<Profile>; label?: string };
  mode: SimulateRequest["mode"];
  users: ResolvedUser[];
  task: TaskSpec;
  trialsPerUser: number;
  fps: SimulateRequest["fps"];
  analysisWindowS: number;
  seed: number;
}

export interface CompareSideParameters {
  label?: string;
  layout: Layout;
  profile: Partial<Profile>;
  effectiveProfiles: { user: string; effectiveProfile: Profile }[];
}

export interface CompareResult {
  seed: number;
  parameters: {
    shared: {
      mode: SimulateRequest["mode"];
      fps: SimulateRequest["fps"];
      analysisWindowS: number;
      trialsPerUser: number;
      task: TaskSpec;
      users: { name: string; params: UserParams }[];
    };
    a: CompareSideParameters;
    b: CompareSideParameters;
  };
  metrics: PairMetrics;
  pairs: ComparePair[];
  statement: string;
  warnings: string[];
  notes: string[];
  disclaimer: string;
}

const utf16 = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);

/**
 * Compares the target ids only (not rects, roles or flags). Returns a `LAYOUT_MISMATCH`
 * error listing the symmetric difference, sorted in UTF-16 order and joined with ", ", or
 * null when the id sets are equal.
 */
export function checkSameTargetIds(a: Layout, b: Layout): SimulateError | null {
  const idsA = new Set(a.targets.map((t) => t.id));
  const idsB = new Set(b.targets.map((t) => t.id));
  const differing: string[] = [];
  for (const id of idsA) if (!idsB.has(id)) differing.push(id);
  for (const id of idsB) if (!idsA.has(id)) differing.push(id);
  if (differing.length === 0) return null;
  differing.sort(utf16);
  return new SimulateError(
    "LAYOUT_MISMATCH",
    `The two layouts must have the same target ids; differing: ${differing.join(", ")}.`,
  );
}

/** A's strings first (unprefixed when B has the same string), then B's remaining strings. */
function mergeSides(a: readonly string[], b: readonly string[]): string[] {
  const inA = new Set(a);
  const inB = new Set(b);
  const out: string[] = [];
  for (const s of a) out.push(inB.has(s) ? s : `A: ${s}`);
  for (const s of b) if (!inA.has(s)) out.push(`B: ${s}`);
  return out;
}

export function compare(request: CompareRequest): CompareResult {
  // Temporary rule until Task 12 wires the scan driver.
  if (request.mode !== "head + dwell") {
    throw new SimulateError(
      "UNSUPPORTED_MODE",
      `compare does not support mode "${request.mode}" yet: scan mode is not implemented (Task 12).`,
    );
  }
  const layoutA = request.a.layout;
  const layoutB = request.b.layout ?? request.a.layout;
  const mismatch = checkSameTargetIds(layoutA, layoutB);
  if (mismatch) throw mismatch;
  if (request.trialsPerUser < 1) {
    throw new SimulateError("NO_TRIALS", "trialsPerUser must be at least 1: there is no effective profile to report without a trial.");
  }

  // The task is expanded once, from a's layout, and shared by both sides (design section 9).
  const expanded = expandTask(layoutA, request.task, request.seed);
  if (!expanded.ok) {
    throw new SimulateError(
      expanded.error.code,
      `Task entry ${expanded.error.index} repeats target "${expanded.error.targetId}" and the target has no autoRepeat.`,
      expanded.error,
    );
  }

  const profileA = request.a.profile ?? {};
  const profileB = request.b.profile ?? {};

  const runSide = (layout: Layout, profile: Partial<Profile>) => {
    const results = request.users.map((user) => {
      const config: RunUserConfig = {
        layout,
        profile,
        user,
        mode: "head + dwell",
        task: expanded.ids,
        fps: request.fps,
        analysisWindowMs: request.analysisWindowS * 1000,
        requestSeed: request.seed,
        trials: request.trialsPerUser,
      };
      return runUser(config);
    });
    const { warnings, notes } = buildWarnings({
      layout,
      mode: request.mode,
      users: request.users.map((user, i) => ({ user, trials: results[i].trials })),
    });
    return { results, warnings, notes };
  };

  const sideA = runSide(layoutA, profileA);
  const sideB = runSide(layoutB, profileB);

  const names = request.users.map((u) => u.name);
  const pairs = pairTrials(
    names,
    sideA.results.map((r) => r.trials),
    sideB.results.map((r) => r.trials),
  );

  // Mirrors simulate.ts: the effective profile of a user is that of the user's first trial.
  const side = (
    label: string | undefined,
    layout: Layout,
    profile: Partial<Profile>,
    results: typeof sideA.results,
  ): CompareSideParameters => ({
    ...(label === undefined ? {} : { label }),
    layout: structuredClone(layout),
    profile,
    effectiveProfiles: request.users.map((u, i) => ({ user: u.name, effectiveProfile: results[i].trials[0].effectiveProfile })),
  });

  return {
    seed: request.seed,
    parameters: {
      shared: {
        mode: request.mode,
        fps: request.fps,
        analysisWindowS: request.analysisWindowS,
        trialsPerUser: request.trialsPerUser,
        task: request.task,
        users: request.users.map((u) => ({ name: u.name, params: u.params })),
      },
      a: side(request.a.label, layoutA, profileA, sideA.results),
      b: side(request.b.label, layoutB, profileB, sideB.results),
    },
    metrics: summarizePairs(pairs),
    pairs,
    statement: COMPARE_STATEMENT,
    warnings: mergeSides(sideA.warnings, sideB.warnings),
    notes: mergeSides(sideA.notes, sideB.notes),
    disclaimer: DISCLAIMER,
  };
}
