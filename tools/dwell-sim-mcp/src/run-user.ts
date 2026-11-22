/**
 * The user runner (design section 5 and the module overview: "run-user.ts (users x trials)").
 *
 * Runs `runTrial` once for every trial index `0..trials - 1` of one resolved user and
 * aggregates the results with `aggregateUser`. The user key and the trial index reach the draw
 * streams through `TrialConfig` (design section 3), so the result of one user depends on that
 * user's own key, never on which other users are in the request. Each `runTrial` call opens a
 * new skeleton instance and destroys it.
 *
 * The task is already expanded: design section 4.8 builds it once per request from
 * `stream(seed, 0, 0, TaskOrder)`, so every user and trial shares it.
 */
import { aggregateUser, type TrialResult, type UserMetrics } from "./metrics.js";
import { runTrial, type TrialConfig } from "./run-trial.js";

/** A `TrialConfig` without the trial index, plus the number of trials to run. */
export type RunUserConfig = Omit<TrialConfig, "trialIndex"> & {
  /** Trials per user (`trialsPerUser` of the request); a non-negative integer. */
  trials: number;
};

export interface RunUserResult {
  /** The aggregated metrics of the user (design section 7). */
  metrics: UserMetrics;
  /** The raw trial results in trial order: accidental lists, start events, warnings, profile. */
  trials: TrialResult[];
}

export function runUser(cfg: RunUserConfig): RunUserResult {
  const { trials: count, ...base } = cfg;
  const trials: TrialResult[] = [];
  for (let trialIndex = 0; trialIndex < count; trialIndex++) {
    trials.push(runTrial({ ...base, trialIndex }));
  }
  return { metrics: aggregateUser(cfg.user.name, trials, cfg.layout), trials };
}
