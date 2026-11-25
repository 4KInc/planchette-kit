/**
 * The fixed core-vocabulary grid.
 *
 * Words: the Universal Core vocabulary, Center for Literacy and Disability Studies,
 * UNC Chapel Hill, licensed under CC BY 4.0
 * (https://creativecommons.org/licenses/by/4.0/).
 * Source: https://www.med.unc.edu/healthsciences/clds/universal-core-vocabulary/
 * The list is used unchanged; only the grid placement below is ours.
 */

export interface CoreButton {
  readonly id: string; // kebab-case of the word, e.g. "finished"
  readonly label: string; // the word as shown and spoken
  readonly row: number; // 0-5
  readonly col: number; // 0-5
}

/**
 * The 36 Universal Core vocabulary words (CC BY 4.0, CLDS/UNC), in a fixed 6x6 grid.
 * Alphabetical (case-insensitive) row-major placement: deterministic, carer-predictable,
 * and stable because it is a literal array, never computed from frequency or state.
 */
export const CORE_VOCABULARY: readonly CoreButton[] = Object.freeze(
  [
    // row 0
    { id: 'all', label: 'all', row: 0, col: 0 },
    { id: 'can', label: 'can', row: 0, col: 1 },
    { id: 'different', label: 'different', row: 0, col: 2 },
    { id: 'do', label: 'do', row: 0, col: 3 },
    { id: 'finished', label: 'finished', row: 0, col: 4 },
    { id: 'get', label: 'get', row: 0, col: 5 },
    // row 1
    { id: 'go', label: 'go', row: 1, col: 0 },
    { id: 'good', label: 'good', row: 1, col: 1 },
    { id: 'he', label: 'he', row: 1, col: 2 },
    { id: 'help', label: 'help', row: 1, col: 3 },
    { id: 'here', label: 'here', row: 1, col: 4 },
    { id: 'i', label: 'I', row: 1, col: 5 },
    // row 2
    { id: 'in', label: 'in', row: 2, col: 0 },
    { id: 'it', label: 'it', row: 2, col: 1 },
    { id: 'like', label: 'like', row: 2, col: 2 },
    { id: 'look', label: 'look', row: 2, col: 3 },
    { id: 'make', label: 'make', row: 2, col: 4 },
    { id: 'more', label: 'more', row: 2, col: 5 },
    // row 3
    { id: 'not', label: 'not', row: 3, col: 0 },
    { id: 'on', label: 'on', row: 3, col: 1 },
    { id: 'open', label: 'open', row: 3, col: 2 },
    { id: 'put', label: 'put', row: 3, col: 3 },
    { id: 'same', label: 'same', row: 3, col: 4 },
    { id: 'she', label: 'she', row: 3, col: 5 },
    // row 4
    { id: 'some', label: 'some', row: 4, col: 0 },
    { id: 'stop', label: 'stop', row: 4, col: 1 },
    { id: 'that', label: 'that', row: 4, col: 2 },
    { id: 'turn', label: 'turn', row: 4, col: 3 },
    { id: 'up', label: 'up', row: 4, col: 4 },
    { id: 'want', label: 'want', row: 4, col: 5 },
    // row 5
    { id: 'what', label: 'what', row: 5, col: 0 },
    { id: 'when', label: 'when', row: 5, col: 1 },
    { id: 'where', label: 'where', row: 5, col: 2 },
    { id: 'who', label: 'who', row: 5, col: 3 },
    { id: 'why', label: 'why', row: 5, col: 4 },
    { id: 'you', label: 'you', row: 5, col: 5 },
  ].map((b): CoreButton => Object.freeze(b)),
);
