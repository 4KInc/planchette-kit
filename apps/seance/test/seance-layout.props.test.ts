import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { guardedTargets, insideRect } from '../src/seance-layout';
const rectArb = fc.record({ x: fc.integer({ min: 0, max: 1500 }), y: fc.integer({ min: 0, max: 800 }), width: fc.integer({ min: 1, max: 400 }), height: fc.integer({ min: 1, max: 200 }) });
const setArb = fc.uniqueArray(fc.tuple(fc.string({ minLength: 1, maxLength: 6 }), rectArb), { selector: (t) => t[0], maxLength: 30 });
const pointArb = fc.record({ x: fc.integer({ min: -50, max: 1900 }), y: fc.integer({ min: -50, max: 1100 }) });
describe('Feature: seance, Property 17: Arrival guard', () => {
  it('holds exactly the targets that contain the pointer, and registers the rest', () => {
    fc.assert(
      fc.property(setArb, fc.option(pointArb, { nil: null }), (entries, pointer) => {
        const rects = new Map(entries);
        const ids = entries.map((e) => e[0]);
        const { register, held } = guardedTargets(ids, rects, pointer);
        expect([...register, ...held].sort()).toEqual([...ids].sort());
        if (pointer === null) expect(held).toEqual([]);
        for (const id of held) expect(insideRect(pointer!, rects.get(id)!)).toBe(true);
        for (const id of register) if (pointer !== null) expect(insideRect(pointer, rects.get(id)!)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });
  it('a held target is released once the pointer is outside it', () => {
    fc.assert(
      fc.property(setArb, pointArb, pointArb, (entries, p1, p2) => {
        const rects = new Map(entries);
        const ids = entries.map((e) => e[0]);
        const first = guardedTargets(ids, rects, p1).held;
        const second = guardedTargets(first, rects, p2);
        for (const id of second.register) expect(insideRect(p2, rects.get(id)!)).toBe(false);
      }),
    );
  });
});
