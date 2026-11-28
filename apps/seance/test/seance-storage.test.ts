import { describe, expect, it } from 'vitest';
import { KEY_SEANCE, readSeanceProfile, resolveInitialProfile, writeSeanceProfile } from '../src/seance-storage';
import { MemoryStorage, throwingStorage } from './memory-storage';
describe('seance-storage', () => {
  it('round trips a profile', () => {
    const s = new MemoryStorage();
    expect(writeSeanceProfile(s, { dwellTime: 1500, mode: 'scan' })).toBe(true);
    expect(readSeanceProfile(s)).toEqual({ profile: { dwellTime: 1500, mode: 'scan' }, usedDefault: false });
    expect(JSON.parse(s.data.get(KEY_SEANCE)!)).toEqual({ version: 1, profile: { dwellTime: 1500, mode: 'scan' } });
  });
  it('a missing key gives the 2100 ms default; a saved 1000 stays 1000', () => {
    const none = readSeanceProfile(new MemoryStorage());
    expect(none.usedDefault).toBe(true);
    expect(resolveInitialProfile(none)).toEqual({ dwellTime: 2100 });
    const s = new MemoryStorage();
    writeSeanceProfile(s, { dwellTime: 1000 });
    expect(resolveInitialProfile(readSeanceProfile(s))).toEqual({ dwellTime: 1000 });
  });
  it('a failing storage is swallowed on read and write', () => {
    expect(readSeanceProfile(throwingStorage).usedDefault).toBe(true);
    expect(writeSeanceProfile(throwingStorage, {})).toBe(false);
    expect(readSeanceProfile(undefined).usedDefault).toBe(true);
    expect(writeSeanceProfile(undefined, {})).toBe(false);
  });
  it('wrong version or shape falls back', () => {
    for (const raw of ['{"version":2,"profile":{}}', '{"version":1,"profile":[]}', '{"version":1}', '[]', 'null', 'x']) {
      const s = new MemoryStorage();
      s.setItem(KEY_SEANCE, raw);
      expect(readSeanceProfile(s).usedDefault, raw).toBe(true);
    }
  });
});
