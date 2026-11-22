/**
 * `simulate` core (design sections 7 and 11). Takes a validated request with defaults already
 * applied, expands the task once, runs every user in request order and builds the result.
 * It applies no defaults and reads no clock, so the result has no wall-clock field.
 */
import type { Profile } from "@planchette/skeleton";
import { DISCLAIMER } from "./disclaimer.js";
import { round1, type TargetMetrics, type UserMetrics } from "./metrics.js";
import { runUser } from "./run-user.js";
import { expandTask, type TaskError } from "./task.js";
import type { Activity, AccidentalCause, SimulateRequest, TaskSpec, UserParams } from "./types.js";
import { buildWarnings } from "./warnings.js";

/**
 * Thrown for conditions the validator (Task 14) is meant to catch first. Task 14/15 maps
 * `ADJACENT_REPEAT` (with `taskError`) to the tool error of the same name and treats the other
 * codes as INTERNAL_ERROR.
 */
export type SimulateErrorCode = "ADJACENT_REPEAT" | "UNSUPPORTED_MODE" | "NO_TRIALS";

export class SimulateError extends Error {
  readonly code: SimulateErrorCode;
  readonly taskError?: TaskError;
  constructor(code: SimulateErrorCode, message: string, taskError?: TaskError) {
    super(message);
    this.name = "SimulateError";
    this.code = code;
    if (taskError) this.taskError = taskError;
  }
}

export interface SimulateUserOutput extends Omit<UserMetrics, "userName" | "perTarget"> {
  name: string;
  perTarget: TargetMetrics[];
}

export interface SimulateResult {
  seed: number;
  parameters: {
    mode: SimulateRequest["mode"];
    fps: SimulateRequest["fps"];
    analysisWindowS: number;
    trialsPerUser: number;
    task: TaskSpec;
    profile: Partial<Profile>;
    users: { name: string; params: UserParams; effectiveProfile: Profile }[];
  };
  users: SimulateUserOutput[];
  accidentalSelections: {
    user: string;
    trial: number;
    targetId: string | null;
    timeMs: number;
    activity: Activity;
    cause: AccidentalCause;
  }[];
  /** Always present; filled by Task 10.3. */
  suggestions: never[];
  warnings: string[];
  notes: string[];
  disclaimer: string;
}

function roundRate(row: TargetMetrics): TargetMetrics {
  return { ...row, accidentalPer100Intended: round1(row.accidentalPer100Intended) };
}

export function simulate(request: SimulateRequest): SimulateResult {
  // Temporary rule until Task 12.2 wires the scan driver.
  if (request.mode !== "head + dwell") {
    throw new SimulateError(
      "UNSUPPORTED_MODE",
      `simulate does not support mode "${request.mode}" yet: scan mode is not implemented (Task 12).`,
    );
  }
  if (request.trialsPerUser < 1) {
    throw new SimulateError("NO_TRIALS", "trialsPerUser must be at least 1: there is no effective profile to report without a trial.");
  }

  const expanded = expandTask(request.layout, request.task, request.seed);
  if (!expanded.ok) {
    throw new SimulateError(
      expanded.error.code,
      `Task entry ${expanded.error.index} repeats target "${expanded.error.targetId}" and the target has no autoRepeat.`,
      expanded.error,
    );
  }

  const paramUsers: SimulateResult["parameters"]["users"] = [];
  const users: SimulateUserOutput[] = [];
  const accidentalSelections: SimulateResult["accidentalSelections"] = [];
  const warningInput: { user: SimulateRequest["users"][number]; trials: { warnings: string[] }[] }[] = [];

  for (const user of request.users) {
    const run = runUser({
      layout: request.layout,
      profile: request.profile,
      user,
      mode: "head + dwell",
      task: expanded.ids,
      fps: request.fps,
      analysisWindowMs: request.analysisWindowS * 1000,
      requestSeed: request.seed,
      trials: request.trialsPerUser,
    });

    paramUsers.push({ name: user.name, params: user.params, effectiveProfile: run.trials[0].effectiveProfile });

    const { userName, perTarget, ...rest } = run.metrics;
    users.push({
      ...rest,
      name: userName,
      accidentalPer100Intended: round1(rest.accidentalPer100Intended),
      perTarget: perTarget.map(roundRate),
    });

    for (const trial of run.trials) {
      for (const a of trial.accidental) {
        accidentalSelections.push({
          user: user.name,
          trial: trial.trialIndex,
          targetId: a.targetId,
          timeMs: a.timeMs,
          activity: a.activity,
          cause: a.cause,
        });
      }
    }
    warningInput.push({ user, trials: run.trials });
  }

  const { warnings, notes } = buildWarnings({ layout: request.layout, mode: request.mode, users: warningInput });

  return {
    seed: request.seed,
    parameters: {
      mode: request.mode,
      fps: request.fps,
      analysisWindowS: request.analysisWindowS,
      trialsPerUser: request.trialsPerUser,
      task: request.task,
      profile: request.profile,
      users: paramUsers,
    },
    users,
    accidentalSelections,
    suggestions: [],
    warnings,
    notes,
    disclaimer: DISCLAIMER,
  };
}
