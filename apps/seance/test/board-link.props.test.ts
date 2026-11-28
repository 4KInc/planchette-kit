import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BOARD_KEY, carryDwellToBoard, readBoard, undoCarry } from '../src/board-link';
import { createRound, stepRound, type RoundInput } from '../src/round';
import { WORDS, messageFor } from '../src/spirit-messages';
import { canOfferCarry, summarise } from '../src/summary';
import { createSupport, stepSupport } from '../src/support';
import { BOARD_TARGET_IDS } from './board-target-ids';
import { MemoryStorage } from './memory-storage';
const profileArb = fc.dictionary(fc.string({ maxLength: 8 }).filter((k) => k !== '__proto__'), fc.oneof(fc.string({ maxLength: 8 }), fc.integer(), fc.boolean(), fc.constant(null)), { maxKeys: 6 });
const validRecordArb = fc.record({
  profile: profileArb,
  board: fc.record({
    predictionSlotCount: fc.integer({ min: -5, max: 20 }),
    voiceURI: fc.string({ maxLength: 10 }),
    speechRate: fc.double({ min: -2, max: 5, noNaN: true }),
    filterOffensiveWords: fc.boolean(),
  }),
  extra: fc.option(fc.string({ maxLength: 6 }), { nil: undefined }),
}).map((r) => JSON.stringify({ ...r, version: 1 }));
const unreadableArb = fc.oneof(
  fc.string({ maxLength: 40 }).filter((x) => { try { JSON.parse(x); return false; } catch { return true; } }),
  fc.constantFrom('[]', 'null', '1', '{}', '{"version":1}', '{"version":2,"profile":{},"board":{}}', '{"version":1,"profile":{},"board":{"predictionSlotCount":"4"}}'),
);
describe('Feature: seance, Property 11: Carry', () => {
  it('writes nothing until carryDwellToBoard is called, however Rounds are played', () => {
    fc.assert(
      fc.property(fc.option(validRecordArb, { nil: null }), fc.constantFrom(...WORDS), fc.array(fc.constantFrom(...BOARD_TARGET_IDS, 'undo', 'stop'), { maxLength: 40 }), (raw, word, inputs) => {
        const s = new MemoryStorage();
        if (raw !== null) s.setItem(BOARD_KEY, raw);
        s.writes = 0;
        const round = createRound(messageFor(word), 0);
        const support = createSupport();
        let t = 0;
        for (const id of inputs) {
          const input: RoundInput = id === 'undo' ? { type: 'undo' } : id === 'stop' ? { type: 'stop' } : { type: 'select', target: id };
          for (const e of stepRound(round, input, (t += 25))) {
            if (e.type === 'hit') stepSupport(support, { type: 'hit' }, t);
            if (e.type === 'miss') stepSupport(support, { type: 'miss', dwellMs: 2100 }, t);
          }
        }
        const board = readBoard(s);
        summarise(round, { dwellMs: 2100, mode: 'head + dwell' });
        canOfferCarry(round, { mode: 'head + dwell', modeChangedDuringRound: false, boardReadable: board.state !== 'unreadable' });
        expect(s.writes).toBe(0);
        expect(s.data.get(BOARD_KEY) ?? null).toBe(raw);
      }),
      { numRuns: 100 },
    );
  });
  it('on any valid record, only profile.dwellTime differs, and it is 400..3000 on a 50 step', () => {
    fc.assert(
      fc.property(validRecordArb, fc.integer({ min: -1000, max: 10_000 }), (raw, dwell) => {
        const s = new MemoryStorage();
        s.setItem(BOARD_KEY, raw);
        const r = carryDwellToBoard(s, dwell);
        expect(r.ok).toBe(true);
        const before = JSON.parse(raw) as { profile: Record<string, unknown> };
        const after = JSON.parse(s.data.get(BOARD_KEY)!) as { profile: Record<string, unknown> };
        const written = after.profile.dwellTime as number;
        expect(written).toBeGreaterThanOrEqual(400);
        expect(written).toBeLessThanOrEqual(3000);
        expect(written % 50).toBe(0);
        delete before.profile.dwellTime;
        delete after.profile.dwellTime;
        expect(after).toEqual(before);
      }),
      { numRuns: 200 },
    );
  });
  it('leaves any unreadable value exactly as it was', () => {
    fc.assert(
      fc.property(unreadableArb, fc.integer({ min: 0, max: 5000 }), (raw, dwell) => {
        const s = new MemoryStorage();
        s.setItem(BOARD_KEY, raw);
        s.writes = 0;
        expect(carryDwellToBoard(s, dwell).ok).toBe(false);
        expect(s.writes).toBe(0);
        expect(s.data.get(BOARD_KEY)).toBe(raw);
      }),
      { numRuns: 200 },
    );
  });
  it('Undo restores the exact previous value (or removes the key), and never overwrites a later change', () => {
    fc.assert(
      fc.property(fc.option(validRecordArb, { nil: null }), fc.integer({ min: 400, max: 3000 }), validRecordArb, (raw, dwell, later) => {
        const s = new MemoryStorage();
        if (raw !== null) s.setItem(BOARD_KEY, raw);
        const r = carryDwellToBoard(s, dwell);
        if (!r.ok) throw new Error('carry should succeed');
        const written = s.data.get(BOARD_KEY)!;
        // A later change by the Board blocks Undo (unless it happens to equal what was written).
        if (later !== written) {
          const t = new MemoryStorage();
          t.setItem(BOARD_KEY, later);
          t.writes = 0;
          expect(undoCarry(t, r.record)).toBe('changed-since');
          expect(t.writes).toBe(0);
        }
        expect(undoCarry(s, r.record)).toBe('restored');
        expect(s.data.get(BOARD_KEY) ?? null).toBe(raw);
      }),
      { numRuns: 200 },
    );
  });
});
