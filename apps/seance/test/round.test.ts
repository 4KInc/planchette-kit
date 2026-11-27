import { describe, expect, it } from 'vitest';
import { cloneRound, createRound, stepRound } from '../src/round';
import { ANSWER_YES, FAREWELL, messageFor } from '../src/spirit-messages';
const owl = messageFor('OWL');
describe('round', () => {
  it('plays a full Round to complete', () => {
    const r = createRound(owl, 1000);
    expect(stepRound(r, { type: 'select', target: 'letter-o' }, 1500)).toEqual([{ type: 'hit', target: 'letter-o', index: 0, ms: 500 }]);
    expect(stepRound(r, { type: 'select', target: 'letter-w' }, 2100)).toHaveLength(1);
    const last = stepRound(r, { type: 'select', target: 'letter-l' }, 3000);
    expect(last.map((e) => e.type)).toEqual(['hit', 'complete']);
    expect(r).toMatchObject({ status: 'complete', index: 3, hits: 3, misses: 0, endedAt: 3000, stepMs: [500, 600, 900] });
  });
  it('a Miss keeps the Step and only adds to the Miss count', () => {
    const r = createRound(owl, 0);
    expect(stepRound(r, { type: 'select', target: 'letter-x' }, 10)).toEqual([{ type: 'miss', target: 'letter-x', expected: 'letter-o' }]);
    expect(r).toMatchObject({ index: 0, hits: 0, misses: 1, status: 'playing' });
  });
  it('Undo steps back, adds Taken back and restarts the Step timer', () => {
    const r = createRound(owl, 0);
    stepRound(r, { type: 'select', target: 'letter-o' }, 100);
    expect(stepRound(r, { type: 'undo' }, 200)).toEqual([{ type: 'undone', index: 0 }]);
    expect(r).toMatchObject({ index: 0, hits: 1, takenBack: 1, misses: 0 });
    expect(r.stepMs[0]).toBe(-1);
    stepRound(r, { type: 'select', target: 'letter-o' }, 450);
    expect(r.stepMs[0]).toBe(250);
  });
  it('Undo with nothing standing does nothing', () => {
    const r = createRound(owl, 0);
    expect(stepRound(r, { type: 'undo' }, 5)).toEqual([]);
    expect(r.takenBack).toBe(0);
  });
  it('stop ends a Round, and an ended Round ignores everything', () => {
    const r = createRound(owl, 0);
    expect(stepRound(r, { type: 'stop' }, 50)).toEqual([{ type: 'stopped' }]);
    expect(r).toMatchObject({ status: 'stopped', endedAt: 50 });
    const before = cloneRound(r);
    expect(stepRound(r, { type: 'select', target: 'letter-o' }, 99)).toEqual([]);
    expect(stepRound(r, { type: 'stop' }, 100)).toEqual([]);
    expect(r).toEqual(before);
  });
  it('ignores a stale timestamp, but stop with an old timestamp still ends the Round', () => {
    const r = createRound(owl, 100);
    stepRound(r, { type: 'select', target: 'letter-o' }, 200);
    expect(stepRound(r, { type: 'select', target: 'letter-w' }, 200)).toEqual([]);
    expect(stepRound(r, { type: 'select', target: 'letter-w' }, 150)).toEqual([]);
    expect(r).toMatchObject({ index: 1, hits: 1, misses: 0 });
    expect(stepRound(r, { type: 'stop' }, 10)).toEqual([{ type: 'stopped' }]);
    expect(r.endedAt).toBe(200);
  });
  it('a selection stamped at the start is ignored (it came before the Round)', () => {
    const r = createRound(owl, 100);
    expect(stepRound(r, { type: 'select', target: 'letter-o' }, 100)).toEqual([]);
  });
  it('one-step Messages complete on the first Hit', () => {
    const y = createRound(ANSWER_YES, 0);
    expect(stepRound(y, { type: 'select', target: 'yes' }, 5).map((e) => e.type)).toEqual(['hit', 'complete']);
    const g = createRound(FAREWELL, 0);
    stepRound(g, { type: 'select', target: 'no' }, 5);
    expect(g.status).toBe('playing');
    stepRound(g, { type: 'select', target: 'goodbye' }, 9);
    expect(g.status).toBe('complete');
  });
});
