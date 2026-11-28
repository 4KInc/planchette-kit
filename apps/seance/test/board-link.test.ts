import { describe, expect, it } from 'vitest';
import { BOARD_KEY, carryDwellToBoard, clampDwell, readBoard, undoCarry } from '../src/board-link';
import { MemoryStorage, throwingStorage } from './memory-storage';
const record = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    profile: { mode: 'scan', dwellTime: 1500, startCameraOnLoad: true, targetSize: 120 },
    board: { predictionSlotCount: 6, voiceURI: 'v://x', speechRate: 1.25, filterOffensiveWords: false },
    version: 1,
    ...over,
  });
describe('readBoard', () => {
  it('has the three read states', () => {
    const s = new MemoryStorage();
    expect(readBoard(s)).toEqual({ state: 'none' });
    s.setItem(BOARD_KEY, record());
    expect(readBoard(s)).toMatchObject({ state: 'ok', dwellMs: 1500 });
    s.setItem(BOARD_KEY, '{nope');
    expect(readBoard(s)).toEqual({ state: 'unreadable' });
    expect(readBoard(throwingStorage)).toEqual({ state: 'unreadable' });
    expect(readBoard(undefined)).toEqual({ state: 'unreadable' });
  });
  it('a valid record with no dwell time has dwellMs null', () => {
    const s = new MemoryStorage();
    s.setItem(BOARD_KEY, record({ profile: { mode: 'mouse' } }));
    expect(readBoard(s)).toMatchObject({ state: 'ok', dwellMs: null });
  });
});
describe('carryDwellToBoard', () => {
  it('on a valid record changes only profile.dwellTime', () => {
    const s = new MemoryStorage();
    const before = record();
    s.setItem(BOARD_KEY, before);
    const r = carryDwellToBoard(s, 2100);
    expect(r.ok).toBe(true);
    const expected = JSON.parse(before) as { profile: Record<string, unknown> };
    expected.profile.dwellTime = 2100;
    expect(JSON.parse(s.data.get(BOARD_KEY)!)).toEqual(expected);
  });
  it('with no key writes a full record', () => {
    const s = new MemoryStorage();
    const r = carryDwellToBoard(s, 1800);
    expect(r.ok).toBe(true);
    expect(JSON.parse(s.data.get(BOARD_KEY)!)).toEqual({
      version: 1,
      profile: { dwellTime: 1800 },
      board: { predictionSlotCount: 4, voiceURI: '', speechRate: 1, filterOffensiveWords: true },
    });
  });
  it('writes nothing over something it cannot read', () => {
    for (const raw of ['garbage', '{"version":2,"profile":{},"board":{}}', '{"version":1,"profile":{}}', '[]']) {
      const s = new MemoryStorage();
      s.setItem(BOARD_KEY, raw);
      s.writes = 0;
      expect(carryDwellToBoard(s, 2100)).toEqual({ ok: false, reason: 'unreadable' });
      expect(s.writes).toBe(0);
      expect(s.data.get(BOARD_KEY)).toBe(raw);
    }
  });
  it('rounds to 50 and clamps to 400..3000', () => {
    expect(clampDwell(2124)).toBe(2100);
    expect(clampDwell(2125)).toBe(2150);
    expect(clampDwell(100)).toBe(400);
    expect(clampDwell(9999)).toBe(3000);
    const s = new MemoryStorage();
    const r = carryDwellToBoard(s, 99999);
    expect(r.ok && r.record.dwellMs).toBe(3000);
  });
  it('a storage that throws gives a result, not an exception', () => {
    expect(carryDwellToBoard(throwingStorage, 2100)).toEqual({ ok: false, reason: 'unreadable' });
    const s = new MemoryStorage();
    s.setItem = () => {
      throw new Error('quota');
    };
    expect(carryDwellToBoard(s, 2100)).toEqual({ ok: false, reason: 'storage-failed' });
  });
});
describe('undoCarry', () => {
  it('restores the exact previous string', () => {
    const s = new MemoryStorage();
    const before = record();
    s.setItem(BOARD_KEY, before);
    const r = carryDwellToBoard(s, 2400);
    if (!r.ok) throw new Error('carry failed');
    expect(undoCarry(s, r.record)).toBe('restored');
    expect(s.data.get(BOARD_KEY)).toBe(before);
  });
  it('removes the key when there was none', () => {
    const s = new MemoryStorage();
    const r = carryDwellToBoard(s, 2400);
    if (!r.ok) throw new Error('carry failed');
    expect(undoCarry(s, r.record)).toBe('restored');
    expect(s.data.has(BOARD_KEY)).toBe(false);
  });
  it('does nothing when the Board changed its settings since', () => {
    const s = new MemoryStorage();
    const r = carryDwellToBoard(s, 2400);
    if (!r.ok) throw new Error('carry failed');
    const later = record({ profile: { dwellTime: 900 } });
    s.setItem(BOARD_KEY, later);
    s.writes = 0;
    expect(undoCarry(s, r.record)).toBe('changed-since');
    expect(s.writes).toBe(0);
    expect(s.data.get(BOARD_KEY)).toBe(later);
  });
  it('reports a failing storage', () => {
    const s = new MemoryStorage();
    const r = carryDwellToBoard(s, 2400);
    if (!r.ok) throw new Error('carry failed');
    expect(undoCarry(throwingStorage, r.record)).toBe('storage-failed');
  });
});
