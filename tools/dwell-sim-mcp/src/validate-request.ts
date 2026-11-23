/**
 * Request validation with stable error codes (design section 11, Task 14.2).
 *
 * Input is the zod-parsed tool input (defaults applied). Output is the core request or the first
 * problem found as `{ code, parameter, message, allowed? }`. Nothing here throws, reads a clock or
 * draws a random number.
 *
 * Fixed order: mode, users count, each user (preset name or custom range, then duplicate name),
 * layout (screen, target count, per target id then rect x, y, width, height, then at least one
 * selectable target), task (entry count, unknown ids, adjacent repeats; or eachTarget), trialsPerUser,
 * fps, analysisWindowS, seed. For `compare`: mode, users, layout A, layout B, LAYOUT_MISMATCH, task
 * (against layout A), then the shared scalars.
 */
import type { Profile } from "@planchette/skeleton";
import { checkSameTargetIds, type CompareRequest } from "./compare.js";
import { CUSTOM_RANGES, ENUM_PARAMS, TREMOR_OFF_HINT, type CustomParamName } from "./custom-ranges.js";
import { PRESET_NAMES } from "./presets.js";
import { resolveUser, type UserResolveError } from "./resolve-user.js";
import { expandTask } from "./task.js";
import type { CompareToolInput, SimulateToolInput } from "./tool-schemas.js";
import type { Layout, LayoutTarget, ResolvedUser, SimulateRequest, TaskSpec } from "./types.js";

export type ValidationErrorCode =
  | "UNKNOWN_PRESET"
  | "OUT_OF_RANGE"
  | "CAP_EXCEEDED"
  | "NOT_ALLOWED_VALUE"
  | "UNSUPPORTED_MODE"
  | "NO_SELECTABLE_TARGETS"
  | "UNKNOWN_TARGET"
  | "INVALID_LAYOUT"
  | "ADJACENT_REPEAT"
  | "LAYOUT_MISMATCH"
  | "UNKNOWN_PARAMETER";

export type Allowed = string[] | { min: number; max: number };

export interface ValidationError {
  code: ValidationErrorCode;
  parameter: string;
  message: string;
  allowed?: Allowed;
}

export type ValidationResult<T> = { ok: true; request: T } | { ok: false; error: ValidationError };

export const SUPPORTED_MODES: readonly string[] = ["head + dwell"];
export const ALLOWED_FPS = [15, 30, 60] as const;
export const USERS_RANGE = { min: 1, max: 12 } as const;
export const TRIALS_RANGE = { min: 1, max: 50 } as const;
export const TARGETS_RANGE = { min: 1, max: 100 } as const;
export const TASK_ENTRIES_RANGE = { min: 1, max: 500 } as const;
export const EACH_TARGET_RANGE = { min: 1, max: 100 } as const;
export const SEED_RANGE = { min: -2147483648, max: 2147483647 } as const;

type Range = { min: number; max: number };
type Failure = { ok: false; error: ValidationError };

const utf16 = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);

const OVERRIDE_NAMES: string[] = [
  ...Object.keys(CUSTOM_RANGES).filter((k) => k !== "analysisWindowS"),
  ...ENUM_PARAMS,
].sort(utf16);
const HEAD_DIRECTIONS = ["down", "left", "right", "up"];

function fail(code: ValidationErrorCode, parameter: string, message: string, allowed?: Allowed): Failure {
  const error: ValidationError = { code, parameter, message };
  if (allowed !== undefined) error.allowed = allowed;
  return { ok: false, error };
}

function outOfRange(parameter: string, range: Range, value: unknown, unit?: string): Failure {
  const u = unit ? ` ${unit}` : "";
  return fail(
    "OUT_OF_RANGE",
    parameter,
    `Parameter ${parameter} must be between ${range.min} and ${range.max}${u}; got ${String(value)}.`,
    { min: range.min, max: range.max },
  );
}

function capExceeded(parameter: string, range: Range, value: number): Failure {
  return fail(
    "CAP_EXCEEDED",
    parameter,
    `Parameter ${parameter} allows at most ${range.max}; got ${value}.`,
    { min: range.min, max: range.max },
  );
}

function notInteger(parameter: string, value: unknown): Failure {
  return fail("NOT_ALLOWED_VALUE", parameter, `Parameter ${parameter} must be an integer; got ${String(value)}.`);
}

/** Count rule: below the minimum is OUT_OF_RANGE, above the cap is CAP_EXCEEDED, both with the real range. */
function checkCount(parameter: string, count: number, range: Range): Failure | undefined {
  if (count < range.min) return outOfRange(parameter, range, count);
  if (count > range.max) return capExceeded(parameter, range, count);
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Mode
// ---------------------------------------------------------------------------------------------

function checkMode(mode: string): Failure | undefined {
  if (SUPPORTED_MODES.includes(mode)) return undefined;
  return fail(
    "UNSUPPORTED_MODE",
    "mode",
    `Input mode "${mode}" is not supported. Supported modes: ${SUPPORTED_MODES.join(", ")}.`,
    [...SUPPORTED_MODES],
  );
}

// ---------------------------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------------------------

function mapUserError(index: number, e: UserResolveError, isBase: boolean): Failure {
  const userPath = `users[${index}]`;
  const path = `${userPath}.overrides.${e.parameter}`;
  switch (e.code) {
    case "UNKNOWN_PRESET": {
      const name = String(e.value);
      return fail(
        "UNKNOWN_PRESET",
        isBase ? `${userPath}.base` : userPath,
        `Unknown preset "${name}". Valid presets: ${PRESET_NAMES.join(", ")}.`,
        [...PRESET_NAMES],
      );
    }
    case "UNKNOWN_PARAMETER": {
      const direction = e.parameter.startsWith("headRangeDeg.");
      const list = direction ? HEAD_DIRECTIONS : OVERRIDE_NAMES;
      return fail(
        "UNKNOWN_PARAMETER",
        path,
        `Parameter ${path} cannot be overridden. Customisable: ${list.join(", ")}.`,
        [...list],
      );
    }
    case "OUT_OF_RANGE": {
      const range = { min: e.min ?? 0, max: e.max ?? 0 };
      if (e.parameter === "tremorFrequencyHz") {
        return fail(
          "OUT_OF_RANGE",
          path,
          `Parameter ${path} must be 0 (${TREMOR_OFF_HINT}) or between ${range.min} and ${range.max} ${e.unit ?? "Hz"}; got ${String(e.value)}.`,
          { min: range.min, max: range.max },
        );
      }
      return outOfRange(path, range, e.value, e.unit);
    }
    case "INVALID_VALUE": {
      if (e.parameter === "tremorAxis") {
        return fail(
          "NOT_ALLOWED_VALUE",
          path,
          `Parameter ${path} must be one of yaw, pitch; got ${String(e.value)}.`,
          ["yaw", "pitch"],
        );
      }
      if (e.parameter === "headRangeDeg") {
        return fail("NOT_ALLOWED_VALUE", path, `Parameter ${path} must be an object with left, right, up, down.`);
      }
      if (e.parameter === "readingPauseLengthMs") {
        return fail("NOT_ALLOWED_VALUE", path, `Parameter ${path} must be an object with min, max.`);
      }
      // NaN, Infinity or a non-number where a number is required: report the parameter's range.
      const base = e.parameter.split(".")[0] as CustomParamName;
      const r = CUSTOM_RANGES[base];
      return outOfRange(path, { min: r.min, max: r.max }, e.value, r.unit);
    }
  }
}

function checkUsers(users: SimulateToolInput["users"]): { ok: true; users: ResolvedUser[] } | Failure {
  const count = checkCount("users", users.length, USERS_RANGE);
  if (count) return count;
  const resolved: ResolvedUser[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < users.length; i++) {
    const input = users[i];
    const r = resolveUser(input);
    if (!r.ok) return mapUserError(i, r.error, typeof input !== "string" && r.error.parameter === "base");
    if (seen.has(r.user.name)) {
      return fail("NOT_ALLOWED_VALUE", `users[${i}]`, `Parameter users[${i}]: duplicate user name "${r.user.name}".`);
    }
    seen.add(r.user.name);
    resolved.push(r.user);
  }
  return { ok: true, users: resolved };
}

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------

type ToolLayout = SimulateToolInput["layout"];

function layoutProblem(path: string, reason: string): Failure {
  return fail("INVALID_LAYOUT", path, `Layout problem at ${path}: ${reason}.`);
}

function checkLayout(layout: ToolLayout, prefix: string): { ok: true; layout: Layout } | Failure {
  const root = `${prefix}layout`;
  for (const axis of ["width", "height"] as const) {
    const v = layout.screen[axis];
    if (!Number.isFinite(v) || v < 1) return layoutProblem(`${root}.screen.${axis}`, "screen size must be finite and ≥ 1");
  }
  const count = checkCount(`${root}.targets`, layout.targets.length, TARGETS_RANGE);
  if (count) return count;

  const ids = new Set<string>();
  const targets: LayoutTarget[] = [];
  for (let i = 0; i < layout.targets.length; i++) {
    const t = layout.targets[i];
    if (t.id === "") return layoutProblem(`${root}.targets[${i}].id`, "empty id");
    if (ids.has(t.id)) return layoutProblem(`${root}.targets[${i}].id`, "duplicate id");
    ids.add(t.id);
    const base = `${root}.targets[${JSON.stringify(t.id)}].rect`;
    if (!Number.isFinite(t.rect.x)) return layoutProblem(`${base}.x`, "not finite");
    if (!Number.isFinite(t.rect.y)) return layoutProblem(`${base}.y`, "not finite");
    for (const field of ["width", "height"] as const) {
      const v = t.rect[field];
      if (!Number.isFinite(v)) return layoutProblem(`${base}.${field}`, "not finite");
      if (v <= 0) return layoutProblem(`${base}.${field}`, `${field} must be > 0`);
    }
    targets.push({
      id: t.id,
      rect: { x: t.rect.x, y: t.rect.y, width: t.rect.width, height: t.rect.height },
      autoRepeat: t.autoRepeat ?? false,
      role: t.role ?? "default",
    });
  }
  if (!targets.some((t) => t.role !== "rest-area")) {
    return fail(
      "NO_SELECTABLE_TARGETS",
      `${root}.targets`,
      "The layout has no selectable targets (no targets, or only rest-area targets).",
    );
  }
  return { ok: true, layout: { screen: { width: layout.screen.width, height: layout.screen.height }, targets } };
}

// ---------------------------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------------------------

function adjacentRepeat(parameter: string, index: number, id: string): Failure {
  return fail(
    "ADJACENT_REPEAT",
    parameter,
    `Task entry ${index} repeats target "${id}" directly after entry ${index - 1}, and the target has no autoRepeat. Entries are numbered from zero.`,
  );
}

function checkTask(layout: Layout, task: SimulateToolInput["task"], seed: number): { ok: true; task: TaskSpec } | Failure {
  if (Array.isArray(task)) {
    const list: string[] = task;
    const count = checkCount("task", list.length, TASK_ENTRIES_RANGE);
    if (count) return count;
    const known = new Set(layout.targets.map((t) => t.id));
    const restAreas = new Set(layout.targets.filter((t) => t.role === "rest-area").map((t) => t.id));
    for (let i = 0; i < list.length; i++) {
      if (!known.has(list[i])) {
        return fail("UNKNOWN_TARGET", `task[${i}]`, `Task entry ${i} names target "${list[i]}", which is not in the layout.`);
      }
      if (restAreas.has(list[i])) {
        return fail("UNKNOWN_TARGET", `task[${i}]`, `Task entry ${i} names target "${list[i]}", which is a rest area and cannot be selected.`);
      }
    }
    const expanded = expandTask(layout, list, seed);
    if (!expanded.ok) return adjacentRepeat(`task[${expanded.error.index}]`, expanded.error.index, expanded.error.targetId);
    return { ok: true, task: [...list] };
  }

  const n = (task as { eachTarget: number }).eachTarget;
  const path = "task.eachTarget";
  if (!Number.isInteger(n)) return notInteger(path, n);
  if (n < EACH_TARGET_RANGE.min || n > EACH_TARGET_RANGE.max) return outOfRange(path, EACH_TARGET_RANGE, n);
  const selectable = layout.targets.filter((t) => t.role !== "rest-area").length;
  const total = n * selectable;
  if (total > TASK_ENTRIES_RANGE.max) return capExceeded(path, TASK_ENTRIES_RANGE, total);
  const expanded = expandTask(layout, { eachTarget: n }, seed);
  if (!expanded.ok) return adjacentRepeat(path, expanded.error.index, expanded.error.targetId);
  return { ok: true, task: { eachTarget: n } };
}

// ---------------------------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------------------------

function checkScalars(input: {
  trialsPerUser: number;
  fps: number;
  analysisWindowS: number;
  seed: number;
}): { ok: true; fps: SimulateRequest["fps"] } | Failure {
  const { trialsPerUser, fps, analysisWindowS, seed } = input;
  if (!Number.isInteger(trialsPerUser)) return notInteger("trialsPerUser", trialsPerUser);
  const trials = checkCount("trialsPerUser", trialsPerUser, TRIALS_RANGE);
  if (trials) return trials;

  if (fps !== 15 && fps !== 30 && fps !== 60) {
    return fail(
      "NOT_ALLOWED_VALUE",
      "fps",
      `Parameter fps must be one of ${ALLOWED_FPS.join(", ")}; got ${String(fps)}.`,
      ALLOWED_FPS.map(String),
    );
  }

  const w = CUSTOM_RANGES.analysisWindowS;
  if (!(analysisWindowS >= w.min && analysisWindowS <= w.max)) {
    return outOfRange("analysisWindowS", { min: w.min, max: w.max }, analysisWindowS, w.unit);
  }

  if (!Number.isInteger(seed)) return notInteger("seed", seed);
  if (seed < SEED_RANGE.min || seed > SEED_RANGE.max) return outOfRange("seed", SEED_RANGE, seed);
  return { ok: true, fps };
}

// ---------------------------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------------------------

export function validateSimulateRequest(input: SimulateToolInput): ValidationResult<SimulateRequest> {
  const mode = checkMode(input.mode);
  if (mode) return mode;
  const users = checkUsers(input.users);
  if (!users.ok) return users;
  const layout = checkLayout(input.layout, "");
  if (!layout.ok) return layout;
  const task = checkTask(layout.layout, input.task, input.seed);
  if (!task.ok) return task;
  const scalars = checkScalars(input);
  if (!scalars.ok) return scalars;
  return {
    ok: true,
    request: {
      layout: layout.layout,
      profile: (input.profile ?? {}) as Partial<Profile>,
      mode: "head + dwell",
      users: users.users,
      task: task.task,
      trialsPerUser: input.trialsPerUser,
      fps: scalars.fps,
      analysisWindowS: input.analysisWindowS,
      seed: input.seed,
    },
  };
}

export function validateCompareRequest(input: CompareToolInput): ValidationResult<CompareRequest> {
  const mode = checkMode(input.mode);
  if (mode) return mode;
  const users = checkUsers(input.users);
  if (!users.ok) return users;
  const layoutA = checkLayout(input.a.layout, "a.");
  if (!layoutA.ok) return layoutA;
  let layoutB: Layout | undefined;
  if (input.b.layout !== undefined) {
    const r = checkLayout(input.b.layout, "b.");
    if (!r.ok) return r;
    layoutB = r.layout;
    const mismatch = checkSameTargetIds(layoutA.layout, layoutB);
    if (mismatch) return fail("LAYOUT_MISMATCH", "b.layout", mismatch.message);
  }
  const task = checkTask(layoutA.layout, input.task, input.seed);
  if (!task.ok) return task;
  const scalars = checkScalars(input);
  if (!scalars.ok) return scalars;

  const a: CompareRequest["a"] = { layout: layoutA.layout, profile: (input.a.profile ?? {}) as Partial<Profile> };
  if (input.a.label !== undefined) a.label = input.a.label;
  const b: CompareRequest["b"] = { profile: (input.b.profile ?? {}) as Partial<Profile> };
  if (layoutB) b.layout = layoutB;
  if (input.b.label !== undefined) b.label = input.b.label;
  return {
    ok: true,
    request: {
      a,
      b,
      mode: "head + dwell",
      users: users.users,
      task: task.task,
      trialsPerUser: input.trialsPerUser,
      fps: scalars.fps,
      analysisWindowS: input.analysisWindowS,
      seed: input.seed,
    },
  };
}
