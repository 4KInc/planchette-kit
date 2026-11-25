import type { Profile } from "@planchette/skeleton";

/**
 * Typed, never-throwing localStorage access for the Board (design.md "Storage keys,
 * schema, and limits"). Every key stores `{ version, ...fields }`.
 */

export interface StorageResult<T> {
  readonly value: T;
  readonly usedDefault: boolean;
  readonly reason?: string;
}

/** The subset of `Storage` the Board uses, so tests can inject a stub. */
export type StorageLike = Pick<Storage, "getItem" | "setItem">;

// --- keys, versions, caps (design.md table) ---------------------------------

export const KEY_MESSAGE = "planchette-board:message";
export const KEY_HISTORY = "planchette-board:history";
export const KEY_QUICK_PHRASES = "planchette-board:quick-phrases";
export const KEY_SETTINGS = "planchette-board:settings";

export const SCHEMA_VERSION = 1;
export const MESSAGE_MAX_CHARS = 2000;
export const HISTORY_MAX_WORDS = 500;
export const QUICK_PHRASES_MAX = 100;
export const QUICK_PHRASE_MAX_CHARS = 500;

// --- value shapes -----------------------------------------------------------

export interface HistoryEntry {
  readonly word: string;
  readonly count: number;
  readonly lastSpokenAt: number;
}
export interface StoredQuickPhrase {
  readonly id: string;
  readonly text: string;
}
export interface StoredBoardSettings {
  readonly predictionSlotCount: number;
  readonly voiceURI: string;
  readonly speechRate: number;
  readonly filterOffensiveWords: boolean;
}
export interface StoredSettings {
  readonly profile: Partial<Profile>;
  readonly board: StoredBoardSettings;
}

// --- defaults (design.md "Data Models") --------------------------------------

export const DEFAULT_MESSAGE = "";
export const DEFAULT_HISTORY: readonly HistoryEntry[] = [];
export const DEFAULT_QUICK_PHRASES: readonly StoredQuickPhrase[] = [];
export const DEFAULT_SETTINGS: StoredSettings = {
  profile: {},
  board: { predictionSlotCount: 4, voiceURI: "", speechRate: 1.0, filterOffensiveWords: true },
};

// --- generic read/write -----------------------------------------------------

function defaultStorage(): StorageLike | undefined {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage;
  } catch {
    return undefined;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Reads `key`. Never throws: any failure returns `fallback` with `usedDefault: true`.
 * `migrate(raw, version)` receives the parsed object without its `version` field and
 * returns the typed value, or `undefined` to reject it. Without `migrate`, the parsed
 * object (minus `version`) is returned as is.
 */
export function readJSON<T>(
  key: string,
  schemaVersion: number,
  fallback: T,
  migrate?: (raw: unknown, version: number) => T | undefined,
  storage: StorageLike | undefined = defaultStorage(),
): StorageResult<T> {
  const bad = (reason: string): StorageResult<T> => ({ value: fallback, usedDefault: true, reason });
  let text: string | null;
  try {
    if (!storage) return bad("storage unavailable");
    text = storage.getItem(key);
  } catch {
    return bad("storage read failed");
  }
  if (text === null) return bad("missing");
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return bad("not an object");
    const { version, ...rest } = parsed;
    if (typeof version !== "number" || !Number.isFinite(version)) return bad("missing or invalid version");
    if (!migrate) {
      return version === schemaVersion ? { value: rest as T, usedDefault: false } : bad("unsupported version");
    }
    const migrated = migrate(rest, version);
    return migrated === undefined ? bad("invalid shape") : { value: migrated, usedDefault: false };
  } catch {
    return bad("corrupt data");
  }
}

/** Writes `{ version, ...value }`. Never throws; a failed write (e.g. quota) is dropped. */
export function writeJSON(
  key: string,
  schemaVersion: number,
  value: object,
  storage: StorageLike | undefined = defaultStorage(),
): void {
  try {
    storage?.setItem(key, JSON.stringify({ ...value, version: schemaVersion }));
  } catch {
    // Dropped on purpose: a storage failure must never interrupt the conversation.
  }
}

// --- message ----------------------------------------------------------------

export function readMessage(storage?: StorageLike): StorageResult<string> {
  const r = readJSON<{ message: string }>(
    KEY_MESSAGE,
    SCHEMA_VERSION,
    { message: DEFAULT_MESSAGE },
    (raw, version) =>
      version === SCHEMA_VERSION && isRecord(raw) && typeof raw.message === "string" && raw.message.length <= MESSAGE_MAX_CHARS
        ? { message: raw.message }
        : undefined,
    storage ?? defaultStorage(),
  );
  return { ...r, value: r.value.message };
}

/** Truncates silently to `MESSAGE_MAX_CHARS`. */
export function writeMessage(message: string, storage?: StorageLike): void {
  writeJSON(KEY_MESSAGE, SCHEMA_VERSION, { message: message.slice(0, MESSAGE_MAX_CHARS) }, storage ?? defaultStorage());
}

// --- history ----------------------------------------------------------------

function isHistoryEntry(e: unknown): e is HistoryEntry {
  return (
    isRecord(e) &&
    typeof e.word === "string" &&
    e.word !== "" &&
    typeof e.count === "number" &&
    Number.isFinite(e.count) &&
    typeof e.lastSpokenAt === "number" &&
    Number.isFinite(e.lastSpokenAt)
  );
}

export function readHistory(storage?: StorageLike): StorageResult<readonly HistoryEntry[]> {
  const r = readJSON<{ words: readonly HistoryEntry[] }>(
    KEY_HISTORY,
    SCHEMA_VERSION,
    { words: DEFAULT_HISTORY },
    (raw, version) =>
      version === SCHEMA_VERSION &&
      isRecord(raw) &&
      Array.isArray(raw.words) &&
      raw.words.length <= HISTORY_MAX_WORDS &&
      raw.words.every(isHistoryEntry)
        ? { words: raw.words.map((e: HistoryEntry) => ({ word: e.word, count: e.count, lastSpokenAt: e.lastSpokenAt })) }
        : undefined,
    storage ?? defaultStorage(),
  );
  return { ...r, value: r.value.words };
}

/** Keeps the `HISTORY_MAX_WORDS` most recently spoken entries (least-recently-spoken evicted first). */
export function writeHistory(words: readonly HistoryEntry[], storage?: StorageLike): void {
  const kept =
    words.length > HISTORY_MAX_WORDS
      ? [...words].sort((a, b) => b.lastSpokenAt - a.lastSpokenAt).slice(0, HISTORY_MAX_WORDS)
      : words;
  writeJSON(KEY_HISTORY, SCHEMA_VERSION, { words: kept }, storage ?? defaultStorage());
}

// --- quick phrases ----------------------------------------------------------

function isStoredPhrase(p: unknown): p is StoredQuickPhrase {
  return isRecord(p) && typeof p.id === "string" && typeof p.text === "string" && p.text.length <= QUICK_PHRASE_MAX_CHARS;
}

export function readQuickPhrases(storage?: StorageLike): StorageResult<readonly StoredQuickPhrase[]> {
  const r = readJSON<{ phrases: readonly StoredQuickPhrase[] }>(
    KEY_QUICK_PHRASES,
    SCHEMA_VERSION,
    { phrases: DEFAULT_QUICK_PHRASES },
    (raw, version) =>
      version === SCHEMA_VERSION &&
      isRecord(raw) &&
      Array.isArray(raw.phrases) &&
      raw.phrases.length <= QUICK_PHRASES_MAX &&
      raw.phrases.every(isStoredPhrase)
        ? { phrases: raw.phrases.map((p: StoredQuickPhrase) => ({ id: p.id, text: p.text })) }
        : undefined,
    storage ?? defaultStorage(),
  );
  return { ...r, value: r.value.phrases };
}

/**
 * The list is ordered oldest first, so when it exceeds `QUICK_PHRASES_MAX` the oldest
 * (first) entries are evicted. Each text is truncated to `QUICK_PHRASE_MAX_CHARS`.
 */
export function writeQuickPhrases(phrases: readonly StoredQuickPhrase[], storage?: StorageLike): void {
  const kept = phrases
    .slice(Math.max(0, phrases.length - QUICK_PHRASES_MAX))
    .map((p) => ({ id: p.id, text: p.text.slice(0, QUICK_PHRASE_MAX_CHARS) }));
  writeJSON(KEY_QUICK_PHRASES, SCHEMA_VERSION, { phrases: kept }, storage ?? defaultStorage());
}

// --- settings ---------------------------------------------------------------

function isStoredSettings(raw: unknown): raw is StoredSettings {
  if (!isRecord(raw) || !isRecord(raw.profile) || !isRecord(raw.board)) return false;
  const b = raw.board;
  return (
    typeof b.predictionSlotCount === "number" &&
    Number.isFinite(b.predictionSlotCount) &&
    typeof b.voiceURI === "string" &&
    typeof b.speechRate === "number" &&
    Number.isFinite(b.speechRate) &&
    typeof b.filterOffensiveWords === "boolean"
  );
}

/** Shape check only; range clamping and Profile validation belong to board-settings.ts / importProfile. */
export function readSettings(storage?: StorageLike): StorageResult<StoredSettings> {
  return readJSON<StoredSettings>(
    KEY_SETTINGS,
    SCHEMA_VERSION,
    DEFAULT_SETTINGS,
    (raw, version) =>
      version === SCHEMA_VERSION && isStoredSettings(raw)
        ? {
            profile: raw.profile,
            board: {
              predictionSlotCount: raw.board.predictionSlotCount,
              voiceURI: raw.board.voiceURI,
              speechRate: raw.board.speechRate,
              filterOffensiveWords: raw.board.filterOffensiveWords,
            },
          }
        : undefined,
    storage ?? defaultStorage(),
  );
}

export function writeSettings(settings: StoredSettings, storage?: StorageLike): void {
  writeJSON(KEY_SETTINGS, SCHEMA_VERSION, settings, storage ?? defaultStorage());
}
