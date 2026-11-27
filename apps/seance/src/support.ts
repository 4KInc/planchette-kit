/**
 * support.ts: how strongly the game shows the next target, and when it offers a longer dwell
 * (design.md, `support.ts`). A deterministic state machine, `stepSupport(state, input, now)`.
 * It never changes the dwell itself: `apply-dwell` is only an event, emitted only for `accept`.
 */
export const SEANCE_CONFIG = {
  /** Misses in a row (no Hit between) for level 1. */
  strongCueAfterMisses: 2,
  /** Misses in a row for level 2 and the Suggestion. */
  suggestAfterMisses: 4,
  /** Hits in a row to drop one level. */
  calmAfterHits: 3,
  /** The Suggestion is the current dwell plus this, on the 50 ms step, capped. */
  suggestedDwellStepMs: 300,
  /** The Profile's dwellTime range and the Settings step. */
  dwellMinMs: 400,
  dwellMaxMs: 3000,
  dwellStepMs: 50,
} as const;
export type SupportLevel = 0 | 1 | 2;
export interface SupportState {
  level: SupportLevel;
  missStreak: number;
  hitStreak: number;
  offeredThisRound: boolean;
  /** Open until answered; survives the end of the Round. */
  suggestion: { ms: number } | null;
}
export type SupportInput =
  | { readonly type: 'round-start' }
  | { readonly type: 'hit' }
  | { readonly type: 'miss'; readonly dwellMs: number }
  | { readonly type: 'accept' }
  | { readonly type: 'dismiss' };
export type SupportEvent =
  | { readonly type: 'level'; readonly level: SupportLevel }
  | { readonly type: 'suggest'; readonly ms: number }
  | { readonly type: 'apply-dwell'; readonly ms: number }
  | { readonly type: 'suggestion-closed' };
export function createSupport(): SupportState {
  return { level: 0, missStreak: 0, hitStreak: 0, offeredThisRound: false, suggestion: null };
}
export function cloneSupport(state: SupportState): SupportState {
  return { ...state, suggestion: state.suggestion === null ? null : { ...state.suggestion } };
}
/** The Suggestion for a current dwell: above it, on the step, never above the maximum. */
export function suggestedDwell(dwellMs: number): number {
  const c = SEANCE_CONFIG;
  return Math.min(c.dwellMaxMs, Math.ceil((dwellMs + c.suggestedDwellStepMs) / c.dwellStepMs) * c.dwellStepMs);
}
export function stepSupport(state: SupportState, input: SupportInput, _now: number): SupportEvent[] {
  const c = SEANCE_CONFIG;
  const events: SupportEvent[] = [];
  switch (input.type) {
    case 'round-start':
      state.missStreak = 0;
      state.hitStreak = 0;
      state.offeredThisRound = false;
      return events;
    case 'miss': {
      state.missStreak += 1;
      state.hitStreak = 0;
      const wanted: SupportLevel = state.missStreak >= c.suggestAfterMisses ? 2 : state.missStreak >= c.strongCueAfterMisses ? 1 : 0;
      if (wanted > state.level) {
        state.level = wanted;
        events.push({ type: 'level', level: wanted });
      }
      if (
        state.missStreak >= c.suggestAfterMisses &&
        state.suggestion === null &&
        !state.offeredThisRound &&
        input.dwellMs < c.dwellMaxMs
      ) {
        state.suggestion = { ms: suggestedDwell(input.dwellMs) };
        state.offeredThisRound = true;
        events.push({ type: 'suggest', ms: state.suggestion.ms });
      }
      return events;
    }
    case 'hit':
      state.missStreak = 0;
      state.hitStreak += 1;
      if (state.hitStreak >= c.calmAfterHits) {
        state.hitStreak = 0;
        if (state.level > 0) {
          state.level = (state.level - 1) as SupportLevel;
          events.push({ type: 'level', level: state.level });
        }
      }
      return events;
    case 'accept':
      if (state.suggestion === null) return events;
      events.push({ type: 'apply-dwell', ms: state.suggestion.ms });
      state.suggestion = null;
      events.push({ type: 'suggestion-closed' });
      return events;
    case 'dismiss':
      if (state.suggestion === null) return events;
      state.suggestion = null;
      events.push({ type: 'suggestion-closed' });
      return events;
  }
}
