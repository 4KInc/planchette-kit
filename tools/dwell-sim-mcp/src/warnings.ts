import { WARNING_CENTRE_STEP_CAP, WARNING_START_CLAMPED } from "./run-trial.js";
import type { TrialResult } from "./run-trial.js";
import type { Layout, ResolvedUser, SimulateRequest } from "./types.js";

/** Layout warning code: no rest-area target (design section 7). */
export const NO_REST_AREA = "NO_REST_AREA";
/** Layout warning code: no cancel-role target. */
export const NO_CANCEL_TARGET = "NO_CANCEL_TARGET";
/** Note code: a user's tremor is above what the smoothing is tuned for. */
export const TREMOR_ABOVE_TUNED = "TREMOR_ABOVE_TUNED";

/** Tremor above this many degrees peak to peak gets a note. Exactly this value gives none. */
export const TREMOR_TUNED_DEG = 1;

/** Trial warning codes in the order they are listed for one user. */
const TRIAL_WARNING_CODES: readonly string[] = [WARNING_START_CLAMPED, WARNING_CENTRE_STEP_CAP];

/** One user and the warnings of each of that user's trials. */
export interface UserTrialWarnings {
  user: Pick<ResolvedUser, "name" | "params">;
  trials: readonly Pick<TrialResult, "warnings">[];
}

export interface WarningsInput {
  layout: Layout;
  mode: SimulateRequest["mode"];
  /** In request order. */
  users: readonly UserTrialWarnings[];
}

export interface WarningsResult {
  warnings: string[];
  notes: string[];
}

/**
 * Builds the top-level `warnings` and `notes` arrays (design section 7).
 * Warnings: layout warnings (head + dwell only), then aggregated trial warnings.
 * Notes: one tremor note per user above the tuned amount (head + dwell only).
 */
export function buildWarnings(input: WarningsInput): WarningsResult {
  const warnings: string[] = [];
  const notes: string[] = [];

  if (input.mode === "head + dwell") {
    if (!input.layout.targets.some((t) => t.role === "rest-area")) {
      warnings.push(
        `${NO_REST_AREA}: the layout has no rest-area target. Accessibility rule: every layout has a rest area.`,
      );
    }
    if (!input.layout.targets.some((t) => t.role === "cancel")) {
      warnings.push(
        `${NO_CANCEL_TARGET}: the layout has no cancel-role target. Accessibility rule: head-pointer layouts place a cancel target.`,
      );
    }
  }

  for (const { user, trials } of input.users) {
    const amount = user.params.tremorPeakToPeakDeg;
    // Only head + dwell: the note concerns the head-pointer smoothing, which scan does not use.
    if (input.mode === "head + dwell" && amount > TREMOR_TUNED_DEG) {
      notes.push(
        `${TREMOR_ABOVE_TUNED}: user ${user.name} has tremor ${amount}° peak to peak, above the ${TREMOR_TUNED_DEG}° the smoothing is tuned for.`,
      );
    }
    for (const code of TRIAL_WARNING_CODES) {
      const count = trials.filter((t) => t.warnings.includes(code)).length;
      if (count > 0) {
        warnings.push(`${code}: user ${user.name}, ${count} of ${trials.length} trials`);
      }
    }
  }

  return { warnings, notes };
}
