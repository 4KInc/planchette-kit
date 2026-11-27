/** The 29 Board targets: the letters A to Z, YES, NO and GOODBYE. Test helper only. */
export const BOARD_TARGET_IDS: ReadonlySet<string> = new Set([
  ...'abcdefghijklmnopqrstuvwxyz'.split('').map((c) => `letter-${c}`),
  'yes',
  'no',
  'goodbye',
]);
