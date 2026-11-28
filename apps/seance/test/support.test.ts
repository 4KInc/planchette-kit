import { describe, expect, it } from 'vitest';
import { cloneSupport, createSupport, stepSupport, suggestedDwell, type SupportInput } from '../src/support';
const miss = (dwellMs = 2100): SupportInput => ({ type: 'miss', dwellMs });
describe('support', () => {
  it('two Misses give level 1, four give level 2 and one Suggestion', () => {
    const s = createSupport();
    expect(stepSupport(s, miss(), 0)).toEqual([]);
    expect(stepSupport(s, miss(), 0)).toEqual([{ type: 'level', level: 1 }]);
    expect(stepSupport(s, miss(), 0)).toEqual([]);
    expect(stepSupport(s, miss(), 0)).toEqual([{ type: 'level', level: 2 }, { type: 'suggest', ms: 2400 }]);
    expect(s.suggestion).toEqual({ ms: 2400 });
    expect(stepSupport(s, miss(), 0)).toEqual([]);
  });
  it('the Suggestion arithmetic: +300, on the 50 step, capped at 3000, none at 3000', () => {
    expect(suggestedDwell(2100)).toBe(2400);
    expect(suggestedDwell(2110)).toBe(2450);
    expect(suggestedDwell(2900)).toBe(3000);
    const s = createSupport();
    for (let i = 0; i < 6; i++) expect(stepSupport(s, miss(3000), 0).some((e) => e.type === 'suggest')).toBe(false);
  });
  it('offers once per Round, and again after round-start once answered', () => {
    const s = createSupport();
    for (let i = 0; i < 4; i++) stepSupport(s, miss(), 0);
    stepSupport(s, { type: 'dismiss' }, 0);
    expect(s.suggestion).toBeNull();
    stepSupport(s, { type: 'hit' }, 0);
    for (let i = 0; i < 4; i++) expect(stepSupport(s, miss(), 0).some((e) => e.type === 'suggest')).toBe(false);
    stepSupport(s, { type: 'round-start' }, 0);
    for (let i = 0; i < 3; i++) stepSupport(s, miss(), 0);
    expect(stepSupport(s, miss(), 0).some((e) => e.type === 'suggest')).toBe(true);
  });
  it('three Hits drop one level; fewer do not; a Miss resets the streak', () => {
    const s = createSupport();
    for (let i = 0; i < 4; i++) stepSupport(s, miss(3000), 0);
    expect(s.level).toBe(2);
    stepSupport(s, { type: 'hit' }, 0);
    stepSupport(s, { type: 'hit' }, 0);
    expect(s.level).toBe(2);
    stepSupport(s, miss(3000), 0);
    stepSupport(s, { type: 'hit' }, 0);
    stepSupport(s, { type: 'hit' }, 0);
    expect(s.level).toBe(2);
    expect(stepSupport(s, { type: 'hit' }, 0)).toEqual([{ type: 'level', level: 1 }]);
  });
  it('accept emits apply-dwell once; dismiss emits suggestion-closed; neither does anything without a Suggestion', () => {
    const s = createSupport();
    expect(stepSupport(s, { type: 'accept' }, 0)).toEqual([]);
    expect(stepSupport(s, { type: 'dismiss' }, 0)).toEqual([]);
    for (let i = 0; i < 4; i++) stepSupport(s, miss(), 0);
    expect(stepSupport(s, { type: 'accept' }, 0)).toEqual([{ type: 'apply-dwell', ms: 2400 }, { type: 'suggestion-closed' }]);
    expect(stepSupport(s, { type: 'accept' }, 0)).toEqual([]);
  });
  it('the level carries across round-start, and the Round ending closes an open Suggestion', () => {
    const s = createSupport();
    for (let i = 0; i < 4; i++) stepSupport(s, miss(), 0);
    expect(stepSupport(s, { type: 'round-end' }, 0)).toEqual([{ type: 'suggestion-closed' }]);
    expect(s.suggestion).toBeNull();
    expect(stepSupport(s, { type: 'round-end' }, 0)).toEqual([]);
    stepSupport(s, { type: 'round-start' }, 0);
    expect(s.level).toBe(2);
    expect(s.missStreak).toBe(0);
  });
  it('offers a Suggestion only while dwell applies; the stronger cue is raised in every mode', () => {
    for (const dwellApplies of [true, false]) {
      const s = createSupport();
      const events = [1, 2, 3, 4].flatMap(() => stepSupport(s, { type: 'miss', dwellMs: 2100, dwellApplies }, 0));
      expect(events.some((e) => e.type === 'suggest'), String(dwellApplies)).toBe(dwellApplies);
      expect(s.level).toBe(2);
      expect(s.offeredThisRound).toBe(dwellApplies);
    }
  });
  it('cloneSupport copies the Suggestion', () => {
    const s = createSupport();
    for (let i = 0; i < 4; i++) stepSupport(s, miss(), 0);
    const c = cloneSupport(s);
    stepSupport(s, { type: 'dismiss' }, 0);
    expect(c.suggestion).toEqual({ ms: 2400 });
  });
});
