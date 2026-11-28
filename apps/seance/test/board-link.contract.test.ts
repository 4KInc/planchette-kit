// This is the one Séance test that imports from the Board's source. Séance copies the shape of the
// Board's stored settings (apps/seance/src/board-link.ts); this test makes the Board's own reader the
// judge, so a change to the Board's schema fails here first. Source files never import from the Board.
import { describe, expect, it } from 'vitest';
import { KEY_SETTINGS, readSettings } from '../../board/src/board-storage';
import { BOARD_KEY, carryDwellToBoard } from '../src/board-link';
import { MemoryStorage } from './memory-storage';
describe('Carry against the Board reader', () => {
  it('uses the Board key the Board uses', () => {
    expect(BOARD_KEY).toBe(KEY_SETTINGS);
  });
  it('a record written when there was none is accepted, with the carried dwell and the Board defaults', () => {
    const s = new MemoryStorage();
    carryDwellToBoard(s, 2250);
    const r = readSettings(s);
    expect(r.usedDefault).toBe(false);
    expect(r.value.profile.dwellTime).toBe(2250);
    expect(r.value.board).toEqual({ predictionSlotCount: 4, voiceURI: '', speechRate: 1, filterOffensiveWords: true });
  });
  it('a record changed in place is accepted, with the other fields kept', () => {
    const s = new MemoryStorage();
    s.setItem(
      KEY_SETTINGS,
      JSON.stringify({ profile: { mode: 'scan', dwellTime: 900 }, board: { predictionSlotCount: 7, voiceURI: 'x', speechRate: 0.8, filterOffensiveWords: false }, version: 1 }),
    );
    carryDwellToBoard(s, 2100);
    const r = readSettings(s);
    expect(r.usedDefault).toBe(false);
    expect(r.value.profile).toEqual({ mode: 'scan', dwellTime: 2100 });
    expect(r.value.board).toEqual({ predictionSlotCount: 7, voiceURI: 'x', speechRate: 0.8, filterOffensiveWords: false });
  });
});
