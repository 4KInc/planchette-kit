/**
 * spirit-messages.ts: the bundled Messages and the chooser (design.md, `spirit-messages.ts`).
 * Pure: no clock, no `Math.random`, no DOM. The words were written for this project: single common
 * English words, 3 to 6 letters, A to Z only, never two identical letters side by side (a selection
 * happens once per stay on a target, so a double letter would need the pointer to leave and come back).
 */
export type MessageKind = 'word' | 'answer' | 'farewell';
export interface Message {
  readonly id: string;
  readonly kind: MessageKind;
  /** What the spirit spells, for example 'MOTH', 'YES' or 'GOODBYE'. */
  readonly text: string;
  /** The Board-target id of each Step, in order: 'letter-m', 'letter-o', ... or 'yes'. */
  readonly steps: readonly string[];
}
export const WORDS: readonly string[] = [
  'OWL', 'BAT', 'FOG', 'OAK', 'FOX', 'JAR', 'ZEN',
  'MOTH', 'MIST', 'DUSK', 'CROW', 'LAMP', 'STAR', 'WIND', 'BIRD', 'STAY', 'CALM', 'HIVE',
  'GHOST', 'RAVEN', 'EMBER', 'SHADE', 'WITCH', 'MAGIC', 'QUIET', 'LIGHT',
  'CANDLE', 'SPIDER', 'LISTEN', 'SILENT', 'WINDOW', 'SHADOW',
];
export const ANSWER_YES: Message = { id: 'answer-yes', kind: 'answer', text: 'YES', steps: ['yes'] };
export const ANSWER_NO: Message = { id: 'answer-no', kind: 'answer', text: 'NO', steps: ['no'] };
export const FAREWELL: Message = { id: 'farewell-goodbye', kind: 'farewell', text: 'GOODBYE', steps: ['goodbye'] };
/** Every `n % 4 === 0` Round, in this order, repeating. */
const SPECIAL_ROUNDS: readonly Message[] = [ANSWER_YES, ANSWER_NO, FAREWELL];
export function letterTarget(letter: string): string {
  return `letter-${letter.toLowerCase()}`;
}
/** Builds the word Message for `text` (upper-case A to Z). */
export function messageFor(text: string): Message {
  return {
    id: `word-${text.toLowerCase()}`,
    kind: 'word',
    text,
    steps: [...text].map(letterTarget),
  };
}
/** A small seeded PRNG (mulberry32): the same seed always gives the same sequence. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/**
 * The Message for Round `roundNumber` (counted from 1). Every fourth Round is YES, NO or GOODBYE
 * in turn. Round 1 is a 3-letter word. Other Rounds draw a word that is not `previousId`'s.
 */
export function pickMessage(seed: number, roundNumber: number, previousId: string | null): Message {
  if (roundNumber % 4 === 0) {
    return SPECIAL_ROUNDS[(roundNumber / 4 - 1) % SPECIAL_ROUNDS.length]!;
  }
  const pool = (roundNumber === 1 ? WORDS.filter((w) => w.length === 3) : WORDS).filter(
    (w) => `word-${w.toLowerCase()}` !== previousId,
  );
  const rand = mulberry32((seed + Math.imul(roundNumber, 0x9e3779b1)) >>> 0);
  return messageFor(pool[Math.floor(rand() * pool.length)]!);
}
