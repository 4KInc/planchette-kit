/**
 * Resolves a preset name or a custom user (base preset plus overrides) into a `ResolvedUser`
 * and derives its stable key (design sections 2 and 3).
 *
 * Error style: functions return a result value and never throw. `resolveUser` returns
 * `{ ok: true, user }` or `{ ok: false, error }`, where `error` is a `UserResolveError` with
 * fields ready to be mapped to MCP error codes in Task 14: `code`, the offending `parameter`
 * (a path such as `readingPauseLengthMs.min`), the rejected `value`, and, for range errors, the
 * allowed `min`, `max` and `unit`. The first problem found is reported, in a fixed order:
 * base preset, then override names in `CUSTOM_RANGES` order, then each value.
 *
 * Key: preset -> hash32 of the UTF-16 code units of the name. Custom user -> hash32 of the
 * UTF-16 code units of the canonical JSON (object keys sorted) of `[name, resolved params]`.
 * Keys depend on the user only, never on its position in a list.
 */

import { CUSTOM_RANGES, ENUM_PARAMS, type CustomParamName } from "./custom-ranges.js";
import { PRESET_NAMES, PRESETS, type PresetName } from "./presets.js";
import { hash32 } from "./rng.js";
import type { ResolvedUser, UserParams } from "./types.js";

export interface CustomUserInput {
  name: string;
  /** Preset to start from; default "steady". */
  base?: string;
  overrides?: CustomOverrides;
}

export interface CustomOverrides {
  throughputBitsPerS?: number;
  tremorFrequencyHz?: number;
  tremorPeakToPeakDeg?: number;
  tremorAxis?: "yaw" | "pitch";
  headRangeDeg?: { left?: number; right?: number; up?: number; down?: number };
  reactionTimeMs?: number;
  readingPauseChancePct?: number;
  readingPauseLengthMs?: { min: number; max: number };
  scatterCapDeg?: number;
  trackingNoiseDeg?: number;
}

export type UserInput = string | CustomUserInput;

export type UserErrorCode = "UNKNOWN_PRESET" | "UNKNOWN_PARAMETER" | "OUT_OF_RANGE" | "INVALID_VALUE";

export interface UserResolveError {
  code: UserErrorCode;
  /** Name or path of the offending parameter (or the preset name for UNKNOWN_PRESET). */
  parameter: string;
  value: unknown;
  /** Allowed range, present for OUT_OF_RANGE. */
  min?: number;
  max?: number;
  unit?: string;
  message: string;
}

export type ResolveUserResult =
  | { ok: true; user: ResolvedUser }
  | { ok: false; error: UserResolveError };

const DEFAULT_BASE: PresetName = "steady";
const HEAD_DIRECTIONS = ["left", "right", "up", "down"] as const;

function isPresetName(name: string): name is PresetName {
  return (PRESET_NAMES as readonly string[]).includes(name);
}

/** Hash of the UTF-16 code units of a string (length first, so prefixes differ). */
export function hashString(text: string): number {
  const units: number[] = [text.length];
  for (let i = 0; i < text.length; i++) units.push(text.charCodeAt(i));
  return hash32(...units);
}

/** JSON with object keys sorted at every level. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const body = Object.keys(record)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`);
    return `{${body.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Fresh copy of a preset's parameter values. */
export function presetParams(name: PresetName): UserParams {
  const p = PRESETS[name].params;
  return {
    throughputBitsPerS: p.throughputBitsPerS.value,
    tremorFrequencyHz: p.tremorFrequencyHz.value,
    tremorPeakToPeakDeg: p.tremorPeakToPeakDeg.value,
    tremorAxis: p.tremorAxis.value,
    tremorDriftFraction: p.tremorDriftFraction.value,
    headRangeDeg: { ...p.headRangeDeg.value },
    reactionTimeMs: p.reactionTimeMs.value,
    readingPauseChancePct: p.readingPauseChancePct.value,
    readingPauseLengthMs: { ...p.readingPauseLengthMs.value },
    trackingNoiseDeg: p.trackingNoiseDeg.value,
    scatterCapDeg: p.scatterCapDeg.value,
    scanReactionTimeMs: p.scanReactionTimeMs.value,
    scanLatePressChancePct: p.scanLatePressChancePct.value,
    scanPressDurationMs: p.scanPressDurationMs.value,
  };
}

function fail(error: UserResolveError): ResolveUserResult {
  return { ok: false, error };
}

function checkNumber(parameter: string, value: unknown, name: CustomParamName): UserResolveError | undefined {
  const r = CUSTOM_RANGES[name];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { code: "INVALID_VALUE", parameter, value, message: `${parameter} must be a finite number` };
  }
  if (value < r.min || value > r.max) {
    return {
      code: "OUT_OF_RANGE",
      parameter,
      value,
      min: r.min,
      max: r.max,
      unit: r.unit,
      message: `${parameter} = ${value} is outside ${r.min}..${r.max} ${r.unit}`,
    };
  }
  return undefined;
}

const OVERRIDE_NAMES: readonly string[] = [
  ...Object.keys(CUSTOM_RANGES).filter((k) => k !== "analysisWindowS"),
  ...ENUM_PARAMS,
];

function applyOverrides(params: UserParams, overrides: Record<string, unknown>): UserResolveError | undefined {
  for (const key of Object.keys(overrides)) {
    if (!OVERRIDE_NAMES.includes(key)) {
      return { code: "UNKNOWN_PARAMETER", parameter: key, value: overrides[key], message: `${key} is not a customisable parameter` };
    }
  }
  for (const key of OVERRIDE_NAMES) {
    const value = overrides[key];
    if (value === undefined) continue;
    if (key === "tremorAxis") {
      if (value !== "yaw" && value !== "pitch") {
        return { code: "INVALID_VALUE", parameter: key, value, message: "tremorAxis must be yaw or pitch" };
      }
      params.tremorAxis = value;
    } else if (key === "headRangeDeg") {
      if (value === null || typeof value !== "object") {
        return { code: "INVALID_VALUE", parameter: key, value, message: "headRangeDeg must be an object" };
      }
      const dirs = value as Record<string, unknown>;
      for (const d of Object.keys(dirs)) {
        if (!(HEAD_DIRECTIONS as readonly string[]).includes(d)) {
          return { code: "UNKNOWN_PARAMETER", parameter: `${key}.${d}`, value: dirs[d], message: `${key}.${d} is not a direction` };
        }
      }
      for (const d of HEAD_DIRECTIONS) {
        if (dirs[d] === undefined) continue;
        const err = checkNumber(`${key}.${d}`, dirs[d], "headRangeDeg");
        if (err) return err;
        params.headRangeDeg[d] = dirs[d] as number;
      }
    } else if (key === "readingPauseLengthMs") {
      if (value === null || typeof value !== "object") {
        return { code: "INVALID_VALUE", parameter: key, value, message: "readingPauseLengthMs must be an object with min and max" };
      }
      const len = value as { min?: unknown; max?: unknown };
      const minErr = checkNumber(`${key}.min`, len.min, "readingPauseLengthMs");
      if (minErr) return minErr;
      const maxErr = checkNumber(`${key}.max`, len.max, "readingPauseLengthMs");
      if (maxErr) return maxErr;
      const lo = len.min as number;
      const hi = len.max as number;
      if (lo > hi) {
        const r = CUSTOM_RANGES.readingPauseLengthMs;
        return {
          code: "OUT_OF_RANGE",
          parameter: `${key}.min`,
          value: lo,
          min: r.min,
          max: hi,
          unit: r.unit,
          message: `${key}.min = ${lo} is above ${key}.max = ${hi}`,
        };
      }
      params.readingPauseLengthMs = { min: lo, max: hi };
    } else {
      const err = checkNumber(key, value, key as CustomParamName);
      if (err) return err;
      (params as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return undefined;
}

/** Resolve a preset name or a custom user. */
export function resolveUser(input: UserInput): ResolveUserResult {
  if (typeof input === "string") {
    if (!isPresetName(input)) {
      return fail({
        code: "UNKNOWN_PRESET",
        parameter: input,
        value: input,
        message: `unknown preset "${input}"; known presets: ${PRESET_NAMES.join(", ")}`,
      });
    }
    return { ok: true, user: { name: input, key: hashString(input), params: presetParams(input) } };
  }

  const base = input.base ?? DEFAULT_BASE;
  if (!isPresetName(base)) {
    return fail({
      code: "UNKNOWN_PRESET",
      parameter: "base",
      value: base,
      message: `unknown base preset "${base}"; known presets: ${PRESET_NAMES.join(", ")}`,
    });
  }
  const params = presetParams(base);
  const err = applyOverrides(params, (input.overrides ?? {}) as Record<string, unknown>);
  if (err) return fail(err);
  return {
    ok: true,
    user: { name: input.name, key: hashString(canonicalJson([input.name, params])), params },
  };
}
