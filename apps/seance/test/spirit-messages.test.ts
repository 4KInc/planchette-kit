import { describe, expect, it } from 'vitest';
import { WORDS, letterTarget, messageFor, pickMessage } from '../src/spirit-messages';
describe('spirit-messages', () => {
  it('has 32 words', () => {
    expect(WORDS).toHaveLength(32);
  });
  it('builds step ids for a word', () => {
    const m = messageFor('MOTH');
    expect(m).toEqual({ id: 'word-moth', kind: 'word', text: 'MOTH', steps: ['letter-m', 'letter-o', 'letter-t', 'letter-h'] });
    expect(letterTarget('Z')).toBe('letter-z');
  });
  it('Round 1 is a 3-letter word', () => {
    for (const seed of [0, 1, 7, 123456, 4294967295]) {
      const m = pickMessage(seed, 1, null);
      expect(m.kind).toBe('word');
      expect(m.text).toHaveLength(3);
    }
  });
  it('every fourth Round is YES, NO, GOODBYE in turn', () => {
    expect(pickMessage(5, 4, null)).toMatchObject({ kind: 'answer', text: 'YES', steps: ['yes'] });
    expect(pickMessage(5, 8, null)).toMatchObject({ kind: 'answer', text: 'NO', steps: ['no'] });
    expect(pickMessage(5, 12, null)).toMatchObject({ kind: 'farewell', text: 'GOODBYE', steps: ['goodbye'] });
    expect(pickMessage(5, 16, null).text).toBe('YES');
  });
  it('is the same for the same arguments and does not repeat the previous word', () => {
    const a = pickMessage(99, 2, null);
    expect(pickMessage(99, 2, null)).toEqual(a);
    expect(pickMessage(99, 3, a.id).id).not.toBe(a.id);
  });
});
