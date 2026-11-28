/**
 * board-link.ts: carrying the dwell time into the Board's saved settings (design.md, `board-link.ts`).
 * Séance writes the Board key only when `carryDwellToBoard` is called, which the Summary does only on
 * the person's press. The Board's reader accepts the record only if its whole shape is right, and
 * otherwise falls back to defaults, so a Carry never writes a partial record and never writes over one
 * it cannot read. All storage access is in try/catch and nothing here throws.
 * The shape is copied from apps/board/src/board-storage.ts and pinned by board-link.contract.test.ts.
 */
export const BOARD_KEY = 'planchette-board:settings';
const BOARD_VERSION = 1;
const DWELL_MIN = 400;
const DWELL_MAX = 3000;
const DWELL_STEP = 50;
/** The Board's four default fields, as it writes them when nothing is saved. */
const BOARD_DEFAULTS = { predictionSlotCount: 4, voiceURI: '', speechRate: 1, filterOffensiveWords: true } as const;
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type BoardRead =
  | { readonly state: 'none' }
  | { readonly state: 'ok'; readonly dwellMs: number | null; readonly raw: string }
  | { readonly state: 'unreadable' };
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function validRecord(parsed: unknown): parsed is Record<string, unknown> & { profile: Record<string, unknown> } {
  if (!isRecord(parsed) || parsed.version !== BOARD_VERSION || !isRecord(parsed.profile) || !isRecord(parsed.board)) return false;
  const b = parsed.board;
  return (
    typeof b.predictionSlotCount === 'number' && Number.isFinite(b.predictionSlotCount) &&
    typeof b.voiceURI === 'string' &&
    typeof b.speechRate === 'number' && Number.isFinite(b.speechRate) &&
    typeof b.filterOffensiveWords === 'boolean'
  );
}
export function readBoard(storage: StorageLike | undefined): BoardRead {
  let raw: string | null;
  try {
    if (storage === undefined) return { state: 'unreadable' };
    raw = storage.getItem(BOARD_KEY);
  } catch {
    return { state: 'unreadable' };
  }
  if (raw === null) return { state: 'none' };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!validRecord(parsed)) return { state: 'unreadable' };
    const d = parsed.profile.dwellTime;
    return { state: 'ok', dwellMs: typeof d === 'number' && Number.isFinite(d) ? d : null, raw };
  } catch {
    return { state: 'unreadable' };
  }
}
export function clampDwell(ms: number): number {
  const stepped = Math.round(ms / DWELL_STEP) * DWELL_STEP;
  return Math.min(DWELL_MAX, Math.max(DWELL_MIN, stepped));
}
export interface CarryRecord {
  readonly previousRaw: string | null;
  readonly writtenRaw: string;
  readonly dwellMs: number;
}
export type CarryResult =
  | { readonly ok: true; readonly record: CarryRecord }
  | { readonly ok: false; readonly reason: 'unreadable' | 'storage-failed' };
export function carryDwellToBoard(storage: StorageLike | undefined, dwellMs: number): CarryResult {
  const dwell = clampDwell(Number.isFinite(dwellMs) ? dwellMs : DWELL_MIN);
  const current = readBoard(storage);
  if (current.state === 'unreadable' || storage === undefined) return { ok: false, reason: 'unreadable' };
  let writtenRaw: string;
  let previousRaw: string | null;
  if (current.state === 'none') {
    previousRaw = null;
    writtenRaw = JSON.stringify({ profile: { dwellTime: dwell }, board: { ...BOARD_DEFAULTS }, version: BOARD_VERSION });
  } else {
    previousRaw = current.raw;
    const parsed = JSON.parse(current.raw) as { profile: Record<string, unknown> };
    parsed.profile.dwellTime = dwell;
    writtenRaw = JSON.stringify(parsed);
  }
  try {
    storage.setItem(BOARD_KEY, writtenRaw);
  } catch {
    return { ok: false, reason: 'storage-failed' };
  }
  return { ok: true, record: { previousRaw, writtenRaw, dwellMs: dwell } };
}
export type UndoResult = 'restored' | 'changed-since' | 'storage-failed';
/** Puts back what a Carry replaced, but only if the Board's record is still the one the Carry wrote. */
export function undoCarry(storage: StorageLike | undefined, record: CarryRecord): UndoResult {
  try {
    if (storage === undefined) return 'storage-failed';
    if (storage.getItem(BOARD_KEY) !== record.writtenRaw) return 'changed-since';
    if (record.previousRaw === null) storage.removeItem(BOARD_KEY);
    else storage.setItem(BOARD_KEY, record.previousRaw);
    return 'restored';
  } catch {
    return 'storage-failed';
  }
}
