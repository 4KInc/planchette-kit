// The list_users tool data: every preset with its values and sources, the custom ranges, the disclaimer.
// Built from the data modules only, so citations cannot drift from the numbers.
import { CUSTOM_RANGES } from "./custom-ranges.js";
import type { CustomParamName } from "./custom-ranges.js";
import { DISCLAIMER } from "./disclaimer.js";
import { FIGURES, REFERENCES } from "./figures.js";
import type { ParamSource } from "./figures.js";
import { PRESETS, PRESET_NAMES } from "./presets.js";
import type { UserParams } from "./presets.js";

/** A Figures table row (its label) with the reference number and the reference text, or "chosen: <reason>". */
export type ListedSource =
  | { row: string; ref: number; citation: string; note?: string }
  | string;
export interface ListedParameter {
  value: unknown;
  source: ListedSource;
}
export interface ListedUser {
  name: string;
  description: string;
  parameters: Record<string, ListedParameter>;
}
export interface ListedRange {
  min: number;
  max: number;
  unit: string;
}
export interface ListUsersResult {
  users: ListedUser[];
  customRanges: Record<string, ListedRange>;
  disclaimer: string;
}

function toListedSource(source: ParamSource): ListedSource {
  if (source.kind === "chosen") {
    return source.reason.startsWith("chosen") ? source.reason : `chosen: ${source.reason}`;
  }
  const row = FIGURES[source.row];
  const reference = REFERENCES[source.ref];
  const listed: { row: string; ref: number; citation: string; note?: string } = {
    row: row.label,
    ref: source.ref,
    citation: reference.citation,
  };
  if (source.note !== undefined) listed.note = source.note;
  return listed;
}

export function listUsers(): ListUsersResult {
  const users = PRESET_NAMES.map((name): ListedUser => {
    const preset = PRESETS[name];
    const parameters: Record<string, ListedParameter> = {};
    for (const key of Object.keys(preset.params) as (keyof UserParams)[]) {
      const sourced = preset.params[key];
      parameters[key] = { value: sourced.value, source: toListedSource(sourced.source) };
    }
    return { name: preset.name, description: preset.description, parameters };
  });
  const customRanges: Record<string, ListedRange> = {};
  for (const key of Object.keys(CUSTOM_RANGES) as CustomParamName[]) {
    const { min, max, unit } = CUSTOM_RANGES[key];
    customRanges[key] = { min, max, unit };
  }
  return { users, customRanges, disclaimer: DISCLAIMER };
}
