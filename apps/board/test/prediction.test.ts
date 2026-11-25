import { describe, expect, it } from 'vitest';
import {
  createPredictionStrip,
  recencyWeight,
  scoreWord,
  type OffensiveWordFilter,
  type PredictionWordList,
  type SpokenWordHistory,
} from '../src/prediction.js';

const list = (words: readonly string[]): PredictionWordList => ({
  words: new Map(words.map((w, i) => [w, 1 / (i + 1)])),
});
const hist = (o: Record<string, number> = {}): SpokenWordHistory => ({
  entries: new Map(Object.entries(o).map(([w, count]) => [w, { count, lastSpokenAt: 0 }])),
});
const noFilter: OffensiveWordFilter = { excluded: new Set(), enabled: () => false };
const free = () => false;
const words = (s: { slots: readonly { word: string | null }[] }) => s.slots.map((x) => x.word);

describe('scores', () => {
  const wl = list(['alpha', 'beta', 'gamma']); // beta = 0.5
  it('count 1 adds exactly 1; count 3 adds 1 + ln 3', () => {
    expect(scoreWord(wl, hist({ beta: 1 }), 'beta')).toBe(0.5 + 1);
    expect(scoreWord(wl, hist({ beta: 3 }), 'beta')).toBe(0.5 + (1 + Math.log(3)));
  });
  it('history-only word scores recencyWeight alone', () => {
    expect(scoreWord(wl, hist({ zeta: 1 }), 'zeta')).toBe(1);
    expect(recencyWeight(hist({ zeta: 3 }), 'zeta')).toBe(1 + Math.log(3));
  });
  it('no history means weight 0', () => {
    expect(recencyWeight(hist(), 'beta')).toBe(0);
  });
});

describe('ranking', () => {
  it('empty history ranks by word-list frequency', () => {
    const s = createPredictionStrip(3, list(['a1', 'b1', 'c1', 'd1']), hist(), noFilter);
    s.recompute('', '', free);
    expect(words(s)).toEqual(['a1', 'b1', 'c1']);
  });
  it('a history entry raises that word', () => {
    const s = createPredictionStrip(2, list(['aa', 'bb', 'cc']), hist({ cc: 1 }), noFilter);
    s.recompute('', '', free);
    expect(words(s)).toEqual(['cc', 'aa']); // cc: 1/3+1 > aa: 1
  });
  it('tie-break: history first, then list rank, then lexicographic for history-only', () => {
    // list-rank 0 'aa' score 1; history-only 'zz' (1), 'yy' (1); 'bb' 0.5 + history count 1 = 1.5
    // Equal score 1: aa (list, no history) vs yy, zz (history-only) -> history first.
    const s = createPredictionStrip(4, list(['aa', 'bb']), hist({ zz: 1, yy: 1, bb: 1 }), noFilter);
    s.recompute('', '', free);
    expect(words(s)).toEqual(['bb', 'yy', 'zz', 'aa']);
  });
  it('equal-score history-only words are ordered lexicographically', () => {
    const s = createPredictionStrip(3, list([]), hist({ mm: 2, kk: 2, ll: 2 }), noFilter);
    s.recompute('', '', free);
    expect(words(s)).toEqual(['kk', 'll', 'mm']);
  });
  it('message does not filter candidates', () => {
    const s = createPredictionStrip(2, list(['aa', 'bb']), hist(), noFilter);
    s.recompute('aa bb', '', free);
    expect(words(s)).toEqual(['aa', 'bb']);
  });
  it('core words are never suggested', () => {
    const s = createPredictionStrip(2, list(['help', 'I', 'xx', 'yy']), hist({ go: 2 }), noFilter);
    s.recompute('', '', free);
    expect(words(s)).toEqual(['xx', 'yy']);
  });
});

describe('slots', () => {
  it.each([2, 8])('slotCount %i gives that many slots', (n) => {
    const s = createPredictionStrip(n, list(['aa', 'bb']), hist(), noFilter);
    expect(s.slots).toHaveLength(n);
    s.recompute('', '', free);
    expect(s.slots).toHaveLength(n);
    expect(s.slots.map((x) => x.index)).toEqual([...Array(n).keys()]);
  });
  it('short ranked list leaves remaining unlocked slots null', () => {
    const s = createPredictionStrip(4, list(['aa', 'bb']), hist(), noFilter);
    s.recompute('', '', free);
    expect(words(s)).toEqual(['aa', 'bb', null, null]);
  });
  it('a locked slot keeps its word even when a higher-ranked candidate appears', () => {
    const h = { entries: new Map<string, { count: number; lastSpokenAt: number }>() };
    const s = createPredictionStrip(2, list(['aa', 'bb', 'cc']), h, noFilter);
    s.recompute('', '', free);
    expect(words(s)).toEqual(['aa', 'bb']);
    h.entries.set('cc', { count: 5, lastSpokenAt: 1 });
    s.recompute('', '', (i) => i === 0);
    expect(words(s)).toEqual(['aa', 'cc']);
    s.recompute('', '', (i) => i === 1);
    expect(words(s)).toEqual(['aa', 'cc']); // locked 'cc' is not duplicated into slot 0
  });
  it('notifies subscribers and supports unsubscribe', () => {
    const s = createPredictionStrip(2, list(['aa']), hist(), noFilter);
    let n = 0;
    const off = s.subscribe(() => n++);
    s.recompute('', '', free);
    off();
    s.recompute('', '', free);
    expect(n).toBe(1);
  });
});

describe('prefix rule', () => {
  it('spoken "hello" ranks ahead of higher-frequency bundled "helps"; all start with prefix', () => {
    // "help" is a core word, so the bundled competitor is "helps".
    const s = createPredictionStrip(3, list(['helps', 'other', 'heron']), hist({ hello: 1 }), noFilter);
    s.recompute('', 'He', free);
    expect(words(s)).toEqual(['hello', 'helps', 'heron']);
    expect(words(s).every((w) => w === null || w.toLowerCase().startsWith('he'))).toBe(true);
  });
  it('history words come first even with a lower score than a list word', () => {
    const s = createPredictionStrip(2, list(['hxa', 'hxb']), hist({ hxz: 1 }), noFilter);
    s.recompute('', 'hx', free);
    expect(words(s)[0]).toBe('hxz');
  });
  it('clearing the partial word returns to whole-message ranking', () => {
    const s = createPredictionStrip(2, list(['other', 'helps']), hist({ hello: 1 }), noFilter);
    s.recompute('', 'he', free);
    expect(words(s)).toEqual(['hello', 'helps']);
    s.recompute('', '', free);
    expect(words(s)).toEqual(['hello', 'other']); // hello 1 > other 1 tie -> history first
  });
});

describe('offensive-word filter', () => {
  const excluded = new Set(['badword']);
  const wl = list(['badword', 'fine']);
  it('filter on: excluded bundled word absent', () => {
    const s = createPredictionStrip(2, wl, hist(), { excluded, enabled: () => true });
    s.recompute('', '', free);
    expect(words(s)).toEqual(['fine', null]);
  });
  it('filter on: same word present when in history', () => {
    const s = createPredictionStrip(2, wl, hist({ badword: 1 }), { excluded, enabled: () => true });
    s.recompute('', '', free);
    expect(words(s)).toContain('badword');
  });
  it('filter off: word present', () => {
    const s = createPredictionStrip(2, wl, hist(), { excluded, enabled: () => false });
    s.recompute('', '', free);
    expect(words(s)).toEqual(['badword', 'fine']);
  });
  it('setting is read at recompute time', () => {
    let on = true;
    const s = createPredictionStrip(2, wl, hist(), { excluded, enabled: () => on });
    s.recompute('', '', free);
    expect(words(s)).toEqual(['fine', null]);
    on = false;
    s.recompute('', '', free);
    expect(words(s)).toEqual(['badword', 'fine']);
  });
});
