/**
 * The fixed letter board (Spell mode): 6 columns x 5 rows.
 *
 * The 26 letters in English single-letter frequency order, placed in plain row-major
 * order from (0,0). Row 4 is Q (4,0), Z (4,1), Space (4,2), Backspace (4,3).
 * Cells (4,4) and (4,5) are empty: no key, no target.
 * Frequency order is a deliberate trade-off (Requirement 3 AC 3): frequent letters are
 * reached sooner by scanning and head-pointer dwell, at the cost of not being alphabetic.
 */

export interface LetterKey {
  readonly id: string; // 'letter-e', 'letter-t', ... | 'space' | 'backspace'
  readonly label: string; // 'E', 'T', ... | 'Space' | '⌫ Backspace'
  readonly row: number; // 0-4
  readonly col: number; // 0-5
}

import { messages } from './messages.js';

const COLUMNS = 6;
const FREQUENCY_ORDER = 'ETAOINSHRDLCUMWFGYPBVKJXQZ';

const KEYS: LetterKey[] = [
  ...[...FREQUENCY_ORDER].map((ch, i) => ({
    id: `letter-${ch.toLowerCase()}`,
    label: ch,
    row: Math.floor(i / COLUMNS),
    col: i % COLUMNS,
  })),
  { id: 'space', label: messages.letterBoard.space, row: 4, col: 2 },
  { id: 'backspace', label: messages.letterBoard.backspace, row: 4, col: 3 },
];

/** 28 keys; a literal, deterministic layout, never computed from state. Deeply frozen. */
export const LETTER_BOARD: readonly LetterKey[] = Object.freeze(
  KEYS.map((k): LetterKey => Object.freeze(k)),
);
