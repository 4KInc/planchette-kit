/**
 * Spoken-word normalisation (design.md "Spoken-word normalisation"). Pure. Applied
 * before a word is added to, or looked up in, the Spoken-word history. The Message
 * itself is never altered by it.
 */

/** Normalises one token. Returns null when the token contains no letter (dropped). */
export function normaliseSpokenWord(token: string): string | null {
  const result = token.toLowerCase().replace(/^[^\p{L}]+|[^\p{L}\p{M}]+$/gu, '');
  return /\p{L}/u.test(result) ? result : null;
}

/** Splits `message` on whitespace and returns the normalised words, in order, with duplicates. */
export function normaliseSpokenWords(message: string): string[] {
  const out: string[] = [];
  for (const token of message.split(/\s+/u)) {
    if (token === '') continue;
    const w = normaliseSpokenWord(token);
    if (w !== null) out.push(w);
  }
  return out;
}
