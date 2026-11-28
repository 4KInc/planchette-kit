import { describe, expect, it } from 'vitest';
import { createRound, stepRound } from '../src/round';
import { ANSWER_YES, messageFor } from '../src/spirit-messages';
import { canOfferCarry, summarise } from '../src/summary';
const play = (text: string, hits: number, end: 'complete' | 'stop' | 'none' = 'none') => {
  const r = createRound(messageFor(text), 1000);
  let t = 1000;
  for (let i = 0; i < hits; i++) stepRound(r, { type: 'select', target: r.message.steps[i]! }, (t += 1230));
  if (end === 'stop') stepRound(r, { type: 'stop' }, (t += 100));
  return r;
};
const ctx = { dwellMs: 2100, mode: 'head + dwell' as const };
describe('summarise', () => {
  it('a completed Round', () => {
    const s = summarise(play('MOTH', 4), ctx);
    expect(s).toMatchObject({ completed: true, spelled: 'MOTH', letters: 4, steps: 4, seconds: 4.9, misses: 0, takenBack: 0, dwellMs: 2100, mode: 'head + dwell' });
  });
  it('a stopped Round shows the letters so far', () => {
    const r = play('MOTH', 2, 'stop');
    expect(summarise(r, ctx)).toMatchObject({ completed: false, spelled: 'MO', letters: 2, steps: 4, seconds: 2.6 });
  });
  it('a stopped one-step Round has nothing spelled', () => {
    const r = createRound(ANSWER_YES, 0);
    stepRound(r, { type: 'stop' }, 5);
    expect(summarise(r, ctx)).toMatchObject({ spelled: '', letters: 0, steps: 1 });
  });
});
describe('canOfferCarry', () => {
  const ok = { mode: 'head + dwell' as const, modeChangedDuringRound: false, boardReadable: true };
  it('is true only when all four conditions hold', () => {
    const done = play('OWL', 3);
    expect(canOfferCarry(done, ok)).toBe(true);
    expect(canOfferCarry(play('OWL', 1, 'stop'), ok)).toBe(false);
    expect(canOfferCarry(done, { ...ok, mode: 'mouse' })).toBe(false);
    expect(canOfferCarry(done, { ...ok, modeChangedDuringRound: true })).toBe(false);
    expect(canOfferCarry(done, { ...ok, boardReadable: false })).toBe(false);
  });
});
