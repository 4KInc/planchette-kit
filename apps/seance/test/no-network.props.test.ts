import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOARD_TARGET_IDS } from './board-target-ids';
import { MemoryStorage } from './memory-storage';
import { carryDwellToBoard, readBoard, undoCarry } from '../src/board-link';
import { createRound, stepRound, type RoundInput } from '../src/round';
import { readSeanceProfile, resolveInitialProfile, writeSeanceProfile } from '../src/seance-storage';
import { WORDS, messageFor, pickMessage } from '../src/spirit-messages';
import { planSound } from '../src/sound-plan';
import { canOfferCarry, summarise } from '../src/summary';
import { createSupport, stepSupport } from '../src/support';
afterEach(() => vi.unstubAllGlobals());
describe('Feature: seance, Property 14: No network', () => {
  it('the pure layer, storage and the sound plan call no network API', () => {
    const fetchSpy = vi.fn();
    const xhr = vi.fn();
    const ws = vi.fn();
    const beacon = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('XMLHttpRequest', xhr);
    vi.stubGlobal('WebSocket', ws);
    vi.stubGlobal('navigator', { sendBeacon: beacon });
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), fc.integer({ min: 1, max: 30 }), fc.array(fc.constantFrom(...BOARD_TARGET_IDS, 'undo', 'stop'), { maxLength: 40 }), (seed, n, inputs) => {
        const message = pickMessage(seed, n, null);
        expect(WORDS.length).toBeGreaterThan(0);
        const round = createRound(message.kind === 'word' ? message : messageFor('OWL'), 0);
        const support = createSupport();
        const store = new MemoryStorage();
        let t = 0;
        for (const id of inputs) {
          const input: RoundInput = id === 'undo' ? { type: 'undo' } : id === 'stop' ? { type: 'stop' } : { type: 'select', target: id };
          for (const e of stepRound(round, input, (t += 20))) {
            if (e.type === 'hit') stepSupport(support, { type: 'hit' }, t);
            if (e.type === 'miss') stepSupport(support, { type: 'miss', dwellMs: 2100 }, t);
            if (e.type === 'hit' || e.type === 'complete') planSound(e.type, 0, t / 1000);
          }
        }
        summarise(round, { dwellMs: 2100, mode: 'head + dwell' });
        canOfferCarry(round, { mode: 'head + dwell', modeChangedDuringRound: false, boardReadable: readBoard(store).state !== 'unreadable' });
        const carried = carryDwellToBoard(store, 2100);
        if (carried.ok) undoCarry(store, carried.record);
        writeSeanceProfile(store, { dwellTime: 2100 });
        resolveInitialProfile(readSeanceProfile(store));
      }),
      { numRuns: 100 },
    );
    for (const spy of [fetchSpy, xhr, ws, beacon]) expect(spy).not.toHaveBeenCalled();
  });
});
