import type { ImportResult, Planchette, Profile } from '@planchette/skeleton';
import type { StorageResult, StoredBoardSettings, StoredSettings } from './board-storage.js';

/**
 * Board settings model (design.md "Data Models", "Design levers used" lever 1).
 * Pure: no DOM, no storage access. The profile part of an export goes through the
 * skeleton's public `exportProfile` / `importProfile`, which live on a Planchette
 * instance, so callers pass one in (or any object with those methods).
 */

export const SLOT_COUNT_MIN = 2;
export const SLOT_COUNT_MAX = 8;
export const SPEECH_RATE_MIN = 0.5;
export const SPEECH_RATE_MAX = 2.0;
export const DEFAULT_SLOT_COUNT = 4;
export const DEFAULT_SPEECH_RATE = 1.0;
export const BOARD_DEFAULT_DWELL_TIME = 1400;

export interface BoardOnlySettings {
  readonly voiceURI: string; // '' = first local-service voice
  readonly speechRate: number; // 0.5-2.0, default 1.0
  readonly filterOffensiveWords: boolean; // default true; a non-boolean imports as true
}
export interface BoardProfileFields {
  readonly predictionSlotCount: number; // 2-8, default 4
}
export type BoardSettingsValues = BoardOnlySettings & BoardProfileFields;

export interface BoardExport {
  readonly version: 1;
  readonly profile: Partial<Profile>;
  readonly board: BoardSettingsValues;
}

export interface BoardImportResult {
  readonly value: BoardExport;
  /** Human-readable list of every field that was clamped, defaulted, or ignored. */
  readonly changes: string[];
}

/** The part of a Planchette instance this module needs. */
export type ProfileIO = Pick<Planchette, 'getProfile' | 'exportProfile' | 'importProfile'>;

// Compile-time check that the stored shape and the exported shape agree.
const _sameShape: (b: BoardSettingsValues) => StoredBoardSettings = (b) => b;
void _sameShape;

export const DEFAULT_BOARD_SETTINGS: BoardSettingsValues = {
  predictionSlotCount: DEFAULT_SLOT_COUNT,
  voiceURI: '',
  speechRate: DEFAULT_SPEECH_RATE,
  filterOffensiveWords: true,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function describe(v: unknown): string {
  let t: string | undefined;
  try {
    t = JSON.stringify(v);
  } catch {
    t = undefined;
  }
  if (typeof t !== 'string') return v === null ? 'null' : typeof v;
  return t.length > 40 ? `${t.slice(0, 40)}…` : t;
}

function readClampedNumber(
  raw: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  def: number,
  integer: boolean,
  changes: string[],
): number {
  if (!(key in raw)) {
    changes.push(`${key}: missing — using default`);
    return def;
  }
  const v = raw[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    changes.push(`${key}: invalid value ${describe(v)} — using default`);
    return def;
  }
  const n = integer ? Math.round(v) : v;
  const clamped = Math.min(max, Math.max(min, n));
  if (clamped !== v) changes.push(`${key}: ${describe(v)} adjusted to ${clamped} (allowed ${min}-${max})`);
  return clamped;
}

/** Validates the `board` part of an export, clamping or defaulting and reporting each change. */
export function sanitiseBoardSettings(raw: unknown, changes: string[] = []): BoardSettingsValues {
  if (!isRecord(raw)) {
    changes.push('board: missing or not an object — using defaults');
    return { ...DEFAULT_BOARD_SETTINGS };
  }
  const predictionSlotCount = readClampedNumber(
    raw, 'predictionSlotCount', SLOT_COUNT_MIN, SLOT_COUNT_MAX, DEFAULT_SLOT_COUNT, true, changes,
  );
  const speechRate = readClampedNumber(
    raw, 'speechRate', SPEECH_RATE_MIN, SPEECH_RATE_MAX, DEFAULT_SPEECH_RATE, false, changes,
  );
  let voiceURI = DEFAULT_BOARD_SETTINGS.voiceURI;
  if (!('voiceURI' in raw)) changes.push('voiceURI: missing — using default');
  else if (typeof raw.voiceURI !== 'string') changes.push(`voiceURI: invalid value ${describe(raw.voiceURI)} — using default`);
  else voiceURI = raw.voiceURI;
  let filterOffensiveWords = true;
  if (!('filterOffensiveWords' in raw)) changes.push('filterOffensiveWords: missing — using default (true)');
  else if (typeof raw.filterOffensiveWords !== 'boolean') {
    changes.push(`filterOffensiveWords: invalid value ${describe(raw.filterOffensiveWords)} — using default (true)`);
  } else filterOffensiveWords = raw.filterOffensiveWords;
  return { predictionSlotCount, voiceURI, speechRate, filterOffensiveWords };
}

/** Serialises the profile (via the skeleton) together with the Board settings. */
export function exportBoardSettings(io: Pick<Planchette, 'exportProfile'>, board: BoardSettingsValues): string {
  const profile = JSON.parse(io.exportProfile()) as Partial<Profile>;
  const out: BoardExport = { version: 1, profile, board };
  return JSON.stringify(out);
}

/**
 * Parses an export. The profile part goes through the skeleton's `importProfile`
 * (which also applies it to the instance); the Board part is clamped or defaulted.
 * Never throws.
 */
export function importBoardSettings(io: ProfileIO, json: string): BoardImportResult {
  const changes: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    parsed = undefined;
  }
  if (!isRecord(parsed)) {
    changes.push('not a settings file: the settings are unchanged except the Board settings, which use defaults');
    return {
      value: { version: 1, profile: io.getProfile(), board: { ...DEFAULT_BOARD_SETTINGS } },
      changes,
    };
  }
  let profile: Partial<Profile>;
  if (isRecord(parsed.profile)) {
    const r: ImportResult = io.importProfile(JSON.stringify(parsed.profile));
    profile = r.profile;
    changes.push(...r.changes);
  } else {
    changes.push('profile: missing or not an object — the profile is unchanged');
    profile = io.getProfile();
  }
  const board = sanitiseBoardSettings(parsed.board, changes);
  return { value: { version: 1, profile, board }, changes };
}

/**
 * The profile to pass to the first `setProfile`. A saved or imported profile is
 * returned unchanged, whatever its `dwellTime`. Only when nothing was saved
 * (`usedDefault: true`) does the Board apply its own 1400 ms default dwell time.
 */
export function resolveInitialProfile(saved: StorageResult<StoredSettings>): Partial<Profile> {
  return saved.usedDefault ? { dwellTime: BOARD_DEFAULT_DWELL_TIME } : saved.value.profile;
}
