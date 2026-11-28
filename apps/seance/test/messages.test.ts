import { describe, expect, it } from 'vitest';
import { messages } from '../src/messages';
/** Every string in `messages`, calling each function with sample arguments. */
function allStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else if (typeof node === 'function') {
    // each message function takes strings or numbers: try a few argument lists and keep what it returns
    for (const args of [['MOTH', 'L'], [2100, 'Head + dwell'], [3, 4], [2400]] as unknown[][]) {
      try {
        out.push(String((node as (...a: unknown[]) => unknown)(...args)));
      } catch {
        // wrong argument types for this function
      }
    }
  }
  else if (Array.isArray(node)) for (const n of node) allStrings(n, out);
  else if (typeof node === 'object' && node !== null) for (const v of Object.values(node)) allStrings(v, out);
  return out;
}
const JUDGING = /\b(wrong|fail(ed|ure|s)?|bad|lose|lost|loser|mistake[sn]?|error|try harder|incorrect|violat\w*|illegal|breach\w*|unlawful|non-?\s?compliant)\b/i;
describe('messages.ts', () => {
  const strings = allStrings(messages);
  it('has strings', () => {
    expect(strings.length).toBeGreaterThan(60);
  });
  it('uses no word that judges the player (Requirement 3 AC 10)', () => {
    for (const s of strings) expect(s, s).not.toMatch(JUDGING);
  });
  it('says what the game is not, once, in the notice', () => {
    expect(messages.notice).toMatch(/not a medical device/);
    expect(messages.notice).toMatch(/speech-language therapist/);
  });
  it('defines an accidental selection as not the one the spirit pointed to', () => {
    expect(messages.summary.accidentalMeaning).toMatch(/was not the one the spirit pointed to/);
  });
  it('makes no claim of eye tracking', () => {
    for (const s of strings) expect(s, s).not.toMatch(/eye[- ]track/i);
  });
});
