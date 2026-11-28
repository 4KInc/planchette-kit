/**
 * summary.ts: the figures of the Summary and the rule for offering Carry (design.md, `summary.ts`).
 * Pure. The wording lives in messages.ts; this file only works out numbers.
 */
import type { InputMode } from '@planchette/skeleton';
import type { RoundState } from './round.js';
export interface SummaryData {
  readonly completed: boolean;
  /** Letters standing; the whole text if the Round completed. */
  readonly spelled: string;
  readonly letters: number;
  readonly steps: number;
  /** Round time in seconds, one decimal. */
  readonly seconds: number;
  readonly misses: number;
  readonly takenBack: number;
  readonly dwellMs: number;
  readonly mode: InputMode;
}
export function summarise(round: RoundState, context: { readonly dwellMs: number; readonly mode: InputMode }): SummaryData {
  const { message } = round;
  const completed = round.status === 'complete';
  const spelled =
    completed ? message.text : message.kind === 'word' ? message.text.slice(0, round.index) : round.index > 0 ? message.text : '';
  const ms = round.endedAt === -1 ? 0 : Math.max(0, round.endedAt - round.startedAt);
  return {
    completed,
    spelled,
    letters: round.index,
    steps: message.steps.length,
    seconds: Math.round(ms / 100) / 10,
    misses: round.misses,
    takenBack: round.takenBack,
    dwellMs: context.dwellMs,
    mode: context.mode,
  };
}
/** Requirement 5 AC 1: the Round completed, in head + dwell all the way, and the Board key is readable. */
export function canOfferCarry(
  round: RoundState,
  context: { readonly mode: InputMode; readonly modeChangedDuringRound: boolean; readonly boardReadable: boolean },
): boolean {
  return round.status === 'complete' && context.mode === 'head + dwell' && !context.modeChangedDuringRound && context.boardReadable;
}
