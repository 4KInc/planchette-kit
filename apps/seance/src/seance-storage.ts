/**
 * seance-storage.ts: Séance's own saved Profile (Requirement 8). The key holds the Profile only:
 * no Round, count, time, Message or Support level is ever stored. Reads never throw and fall back to
 * the defaults; a failed write is dropped (the page keeps working).
 */
import type { Profile } from '@planchette/skeleton';
import type { StorageLike as BoardStorageLike } from './board-link.js';
export const KEY_SEANCE = 'planchette-seance:settings';
const VERSION = 1;
/** Séance's default dwell time when nothing was saved: the Board's default, confirmed by the layout gate. */
export const SEANCE_DEFAULT_DWELL_TIME = 2100;
export type SeanceStorage = Pick<BoardStorageLike, 'getItem' | 'setItem'>;
export interface SeanceProfileRead {
  readonly profile: Partial<Profile>;
  readonly usedDefault: boolean;
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export function readSeanceProfile(storage: SeanceStorage | undefined): SeanceProfileRead {
  const fallback: SeanceProfileRead = { profile: {}, usedDefault: true };
  try {
    const raw = storage?.getItem(KEY_SEANCE);
    if (raw === null || raw === undefined) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== VERSION || !isRecord(parsed.profile)) return fallback;
    return { profile: parsed.profile as Partial<Profile>, usedDefault: false };
  } catch {
    return fallback;
  }
}
export function writeSeanceProfile(storage: SeanceStorage | undefined, profile: Partial<Profile>): boolean {
  try {
    if (storage === undefined) return false;
    storage.setItem(KEY_SEANCE, JSON.stringify({ version: VERSION, profile }));
    return true;
  } catch {
    return false;
  }
}
/** The Profile to pass to the first `setProfile`: the saved one unchanged, or the 2100 ms default when nothing was saved. */
export function resolveInitialProfile(read: SeanceProfileRead): Partial<Profile> {
  return read.usedDefault ? { dwellTime: SEANCE_DEFAULT_DWELL_TIME } : read.profile;
}
