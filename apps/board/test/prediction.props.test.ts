import fc from 'fast-check';
import { describe, it } from 'vitest';
import { CORE_VOCABULARY } from '../src/core-vocabulary.js';
import {
  createPredictionStrip,
  scoreWord,
  type PredictionWordList,
  type SpokenWordHistory,
} from '../src/prediction.js';

// ---------------------------------------------------------------------------
// Reusable generators (shared by Properties 4-8 in this file)
// ---------------------------------------------------------------------------

const CORE_LOWER = CORE_VOCABULARY.map((c) => c.label.toLowerCase());

const plainWord = fc.stringMatching(/^[a-z]{1,8}$/);
const apostropheWord = fc.stringMatching(/^[a-z]{1,5}'[a-z]{1,3}$/);
const coreWord = fc.constantFrom(...CORE_LOWER);
export const arbWord: fc.Arbitrary<string> = fc.oneof(
  { weight: 6, arbitrary: plainWord },
  { weight: 2, arbitrary: apostropheWord },
  { weight: 2, arbitrary: coreWord },
);

/** Unique lowercase words in rank order (index = 0-based rank). */
export const arbRankedWords: fc.Arbitrary<string[]> = fc.uniqueArray(arbWord, { maxLength: 40 });

export function toWordList(ranked: readonly string[]): PredictionWordList {
  return { words: new Map(ranked.map((w, rank) => [w, 1 / (rank + 1)] as const)) };
}

export const arbWordList: fc.Arbitrary<PredictionWordList> = arbRankedWords.map(toWordList);

export type HistoryMap = Map<string, { count: number; lastSpokenAt: number }>;

export const arbHistory: fc.Arbitrary<HistoryMap> = fc
  .uniqueArray(
    fc.record({
      word: arbWord,
      count: fc.integer({ min: 1, max: 50 }),
      lastSpokenAt: fc.integer({ min: 0, max: 2_000_000_000 }),
    }),
    { maxLength: 15, selector: (e) => e.word },
  )
  .map((es) => new Map(es.map((e) => [e.word, { count: e.count, lastSpokenAt: e.lastSpokenAt }] as const)));

export const arbMessage: fc.Arbitrary<string> = fc.string({ maxLength: 40 });

/** Empty or letters, mixed case. */
export const arbPartialWord: fc.Arbitrary<string> = fc.oneof(
  { weight: 2, arbitrary: fc.constant('') },
  { weight: 3, arbitrary: fc.stringMatching(/^[a-zA-Z]{1,4}$/) },
);

export const arbSlotCount: fc.Arbitrary<number> = fc.integer({ min: 2, max: 8 });

/** Arbitrary subset of slot indices [0, slotCount). */
export const arbLockedSet = (slotCount: number): fc.Arbitrary<ReadonlySet<number>> =>
  fc.subarray(Array.from({ length: slotCount }, (_, i) => i)).map((xs) => new Set(xs));

export const arbExclusion: fc.Arbitrary<ReadonlySet<string>> = fc
  .array(arbWord, { maxLength: 10 })
  .map((ws) => new Set(ws));

export const arbFilterEnabled: fc.Arbitrary<boolean> = fc.boolean();

export function toHistory(map: HistoryMap): SpokenWordHistory {
  return { entries: map };
}

// ---------------------------------------------------------------------------
// Property 4
// ---------------------------------------------------------------------------

describe('prediction properties', () => {
  /**
   * **Property 4: Prediction never changes a locked slot**
   *
   * **Validates: Requirements 4.1, 4.5**
   */
  it('Property 4: Prediction never changes a locked slot', () => {
    fc.assert(
      fc.property(
        arbWordList,
        arbHistory,
        arbSlotCount,
        fc.array(fc.tuple(arbMessage, arbPartialWord, arbHistory, arbFilterEnabled, fc.infiniteStream(fc.boolean())), {
          minLength: 1,
          maxLength: 4,
        }),
        arbExclusion,
        arbFilterEnabled,
        arbMessage,
        arbPartialWord,
        (wordList, history0, slotCount, steps, excluded, enabled0, message0, partial0) => {
          const history: HistoryMap = new Map(history0);
          let enabled = enabled0;
          const strip = createPredictionStrip(slotCount, wordList, toHistory(history), {
            excluded,
            enabled: () => enabled,
          });
          strip.recompute(message0, partial0, () => false);

          for (const [message, partial, newHistory, newEnabled, bools] of steps) {
            history.clear();
            for (const [k, v] of newHistory) history.set(k, v);
            enabled = newEnabled;

            const locked = new Set<number>();
            const it = bools[Symbol.iterator]();
            for (let i = 0; i < slotCount; i++) if (it.next().value === true) locked.add(i);

            const before = strip.slots.map((s) => s.word);
            strip.recompute(message, partial, (i) => locked.has(i));
            for (const i of locked) {
              if (strip.slots[i]!.word !== before[i]) {
                throw new Error(`locked slot ${i} changed: ${String(before[i])} -> ${String(strip.slots[i]!.word)}`);
              }
            }
          }
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5
// ---------------------------------------------------------------------------

/**
 * Independent oracle: the full eligible ranking, built by repeated selection of the
 * best remaining candidate (does not use prediction.ts's sort or scoring helpers).
 */
function oracleRanking(
  list: PredictionWordList,
  history: HistoryMap,
  excluded: ReadonlySet<string>,
  filterOn: boolean,
  partial: string,
): string[] {
  const prefix = partial.toLowerCase();
  const inHist = (w: string): boolean => (history.get(w)?.count ?? 0) >= 1;
  const pool = new Set<string>([...list.words.keys(), ...[...history.keys()].filter(inHist)]);
  const remaining = [...pool].filter((w) => {
    const lw = w.toLowerCase();
    if (CORE_LOWER.includes(lw)) return false;
    if (filterOn && !inHist(w) && excluded.has(lw)) return false;
    return lw.startsWith(prefix);
  });
  const freq = (w: string): number => list.words.get(w) ?? 0;
  const score = (w: string): number => freq(w) + (inHist(w) ? 1 + Math.log(history.get(w)!.count) : 0);
  const before = (a: string, b: string): boolean => {
    if (prefix !== '' && inHist(a) !== inHist(b)) return inHist(a);
    if (score(a) !== score(b)) return score(a) > score(b);
    if (inHist(a) !== inHist(b)) return inHist(a);
    if (list.words.has(a) !== list.words.has(b)) return list.words.has(a);
    if (list.words.has(a) && freq(a) !== freq(b)) return freq(a) > freq(b);
    return a < b;
  };
  const out: string[] = [];
  while (remaining.length > 0) {
    let best = 0;
    for (let i = 1; i < remaining.length; i++) if (before(remaining[i]!, remaining[best]!)) best = i;
    out.push(remaining.splice(best, 1)[0]!);
  }
  return out;
}

describe('prediction properties (Property 5)', () => {
  /**
   * **Property 5: Unlocked slots are filled from the ranked, deduplicated, core-excluding list**
   *
   * **Validates: Requirements 4.3, 4.6, 4.7**
   */
  it('Property 5: Unlocked slots are filled from the ranked, deduplicated, core-excluding list', () => {
    fc.assert(
      fc.property(
        arbWordList,
        arbHistory,
        arbSlotCount.chain((n) => fc.tuple(fc.constant(n), arbLockedSet(n))),
        arbMessage,
        arbPartialWord,
        arbPartialWord,
        arbHistory,
        arbExclusion,
        arbFilterEnabled,
        (wordList, history0, [slotCount, locked], message, partial0, partial, history1, excluded, enabled) => {
          const history: HistoryMap = new Map(history0);
          const strip = createPredictionStrip(slotCount, wordList, toHistory(history), {
            excluded,
            enabled: () => enabled,
          });
          strip.recompute(message, partial0, () => false);

          // Change inputs so locked slots can hold words that are no longer top-ranked.
          history.clear();
          for (const [k, v] of history1) history.set(k, v);
          const before = strip.slots.map((s) => s.word);
          strip.recompute(message, partial, (i) => locked.has(i));
          const after = strip.slots.map((s) => s.word);

          const ranking = oracleRanking(wordList, history, excluded, enabled, partial);
          const rankOf = new Map(ranking.map((w, i) => [w, i] as const));

          const unlocked = after.map((w, i) => ({ w, i })).filter((x) => !locked.has(x.i));
          const placed = unlocked.filter((x) => x.w !== null).map((x) => x.w!);

          // (a) no core word, (b) no repeats anywhere in the strip
          for (const w of placed) {
            if (CORE_LOWER.includes(w.toLowerCase())) throw new Error(`core word in slot: ${w}`);
          }
          const nonNull = after.filter((w): w is string => w !== null);
          if (new Set(nonNull).size !== nonNull.length) throw new Error(`duplicate in strip: ${nonNull.join(',')}`);

          // (c) non-increasing rank order, using the oracle's rank
          for (let k = 1; k < placed.length; k++) {
            if (rankOf.get(placed[k - 1]!)! > rankOf.get(placed[k]!)!) {
              throw new Error(`rank order violated: ${placed[k - 1]} before ${placed[k]}`);
            }
          }

          // Requirement 4.6: next-ranked word not already shown in a locked slot; empty once exhausted.
          const lockedWords = new Set(before.filter((w, i) => locked.has(i) && w !== null) as string[]);
          const expected = ranking.filter((w) => !lockedWords.has(w));
          unlocked.forEach((x, k) => {
            const want = expected[k] ?? null;
            if (x.w !== want) throw new Error(`slot ${x.i}: expected ${String(want)}, got ${String(x.w)}`);
          });
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6
// ---------------------------------------------------------------------------

describe('prediction properties (Property 6)', () => {
  /**
   * **Property 6: Speaking a word never decreases its future rank**
   *
   * **Validates: Requirements 4.7**
   */
  it('Property 6: Speaking a word never decreases its future rank', () => {
    const arbNonCore = arbWord.filter((w) => !CORE_LOWER.includes(w.toLowerCase()));
    fc.assert(
      fc.property(
        arbWordList,
        arbHistory,
        arbNonCore,
        arbSlotCount,
        arbPartialWord,
        arbMessage,
        arbExclusion,
        arbFilterEnabled,
        fc.boolean(),
        (wordList, h1, w, slotCount, partial, message, excluded, enabled, preferListWord) => {
          // Pick w from the list when requested and possible, else history-only / arbitrary non-core.
          const listed = [...wordList.words.keys()].filter((k) => !CORE_LOWER.includes(k.toLowerCase()));
          const target = preferListWord && listed.length > 0 ? listed[w.length % listed.length]! : w;

          const prev = h1.get(target);
          const h2: HistoryMap = new Map(h1);
          h2.set(target, {
            count: (prev?.count ?? 0) + 1,
            lastSpokenAt: (prev?.lastSpokenAt ?? 0) + 1000,
          });

          // Independent oracle over the full candidate list.
          const r1 = oracleRanking(wordList, h1, excluded, enabled, partial).indexOf(target);
          const r2 = oracleRanking(wordList, h2, excluded, enabled, partial).indexOf(target);
          if (r1 !== -1 && (r2 === -1 || r2 > r1)) {
            throw new Error(`oracle rank worsened for ${target}: ${r1} -> ${r2}`);
          }

          // Observable strip output, no locks, same partial word and filter setting.
          const show = (h: HistoryMap): number => {
            const strip = createPredictionStrip(slotCount, wordList, toHistory(h), {
              excluded,
              enabled: () => enabled,
            });
            strip.recompute(message, partial, () => false);
            return strip.slots.findIndex((s) => s.word === target);
          };
          const s1 = show(h1);
          const s2 = show(h2);
          if (s1 !== -1 && (s2 === -1 || s2 > s1)) {
            throw new Error(`strip position worsened for ${target}: ${s1} -> ${s2}`);
          }

          // scoreWord monotonicity.
          if (scoreWord(wordList, toHistory(h2), target) < scoreWord(wordList, toHistory(h1), target)) {
            throw new Error(`score decreased for ${target}`);
          }
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 14
// ---------------------------------------------------------------------------

describe('prediction properties (Property 14)', () => {
  /**
   * **Property 14: Prefix predictions start with the partial word**
   *
   * Per design.md Property 14 / tasks.md 5.5: every unlocked slot, and every locked slot whose
   * word already starts with the Partial word, matches the prefix. A locked slot keeps its
   * word even if it no longer matches (Property 4 takes precedence).
   *
   * **Validates: Requirements 4.10, 4.12**
   */
  it('Property 14: Prefix predictions start with the partial word', () => {
    const arbNonEmptyPartial = fc.stringMatching(/^[a-zA-Z]{1,4}$/);
    // Half the time, derive the prefix from a pool word so matches are common.
    const arbDerive = fc.tuple(fc.nat(), fc.integer({ min: 1, max: 4 }), fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }));
    fc.assert(
      fc.property(
        arbWordList,
        arbHistory,
        arbSlotCount.chain((n) => fc.tuple(fc.constant(n), arbLockedSet(n))),
        arbMessage,
        arbPartialWord,
        arbNonEmptyPartial,
        fc.option(arbDerive, { nil: undefined }),
        arbHistory,
        arbExclusion,
        arbFilterEnabled,
        (wordList, history0, [slotCount, locked], message, partial0, typed, derive, history1, excluded, enabled) => {
          const history: HistoryMap = new Map(history0);
          const strip = createPredictionStrip(slotCount, wordList, toHistory(history), {
            excluded,
            enabled: () => enabled,
          });
          strip.recompute(message, partial0, () => false);

          history.clear();
          for (const [k, v] of history1) history.set(k, v);

          let partial = typed;
          if (derive !== undefined) {
            const pool = [...new Set([...wordList.words.keys(), ...history.keys()])];
            if (pool.length > 0) {
              const [i, len, flips] = derive;
              const w = pool[i % pool.length]!;
              partial = [...w.slice(0, len)].map((c, j) => (flips[j] ? c.toUpperCase() : c)).join('');
            }
          }
          const prefix = partial.toLowerCase();

          const before = strip.slots.map((s) => s.word);
          strip.recompute(message, partial, (i) => locked.has(i));
          const after = strip.slots.map((s) => s.word);

          // (a) every unlocked word, and every locked word that already had the prefix, matches.
          after.forEach((w, i) => {
            if (w === null) return;
            const checked = !locked.has(i) || before[i]!.toLowerCase().startsWith(prefix);
            if (checked && !w.toLowerCase().startsWith(prefix)) {
              throw new Error(`slot ${i} (${locked.has(i) ? 'locked' : 'unlocked'}) "${w}" lacks prefix "${partial}"`);
            }
          });

          // (b) history words with the prefix come before list-only words in unlocked slots.
          const lockedWords = new Set(before.filter((w, i) => locked.has(i) && w !== null) as string[]);
          const ranking = oracleRanking(wordList, history, excluded, enabled, partial);
          const histWords = ranking.filter((w) => (history.get(w)?.count ?? 0) >= 1 && !lockedWords.has(w));
          const placed = after.filter((_, i) => !locked.has(i));
          const fit = Math.min(histWords.length, placed.length);
          const histSet = new Set(histWords);
          for (let k = 0; k < fit; k++) {
            if (placed[k] === null || !histSet.has(placed[k]!)) {
              throw new Error(`unlocked position ${k} holds ${String(placed[k])}, expected a history word`);
            }
          }
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 15
// ---------------------------------------------------------------------------

/** Exclusion list: a random subset of the list's words, some history words, and a few extras. */
function buildExclusion(list: PredictionWordList, history: HistoryMap, picks: readonly number[], extras: readonly string[]): Set<string> {
  const pool = [...list.words.keys(), ...history.keys()];
  const out = new Set<string>(extras);
  if (pool.length > 0) for (const p of picks) out.add(pool[p % pool.length]!);
  return out;
}

const arbExclusionPicks = fc.array(fc.nat(), { maxLength: 20 });
const arbExclusionExtras = fc.array(arbWord, { maxLength: 3 });

describe('prediction properties (Property 15)', () => {
  /**
   * **Property 15: Offensive-word filter**
   *
   * Per design.md Property 15 / tasks.md 5.6: with the filter on, no excluded non-history word
   * appears in an unlocked slot, and in no slot at all when the filter setting and Exclusion
   * list are unchanged since the slot was filled. Here they are unchanged between the initial
   * fill and the locked recompute, so every slot is checked.
   *
   * **Validates: Requirements 4.13, 4.14, 4.15, 4.17**
   */
  it('Property 15: Offensive-word filter', () => {
    fc.assert(
      fc.property(
        arbWordList,
        arbHistory,
        arbExclusionPicks,
        arbExclusionExtras,
        arbSlotCount.chain((n) => fc.tuple(fc.constant(n), arbLockedSet(n))),
        arbMessage,
        arbPartialWord,
        arbPartialWord,
        arbFilterEnabled,
        (wordList, history, picks, extras, [slotCount, locked], message, partial0, partial, enabled) => {
          const excluded = buildExclusion(wordList, history, picks, extras);
          const run = (ex: ReadonlySet<string>): (string | null)[][] => {
            const strip = createPredictionStrip(slotCount, wordList, toHistory(history), {
              excluded: ex,
              enabled: () => enabled,
            });
            strip.recompute(message, partial0, () => false);
            const first = strip.slots.map((s) => s.word);
            strip.recompute(message, partial, (i) => locked.has(i));
            return [first, strip.slots.map((s) => s.word)];
          };
          const actual = run(excluded);

          if (enabled) {
            for (const slots of actual) {
              for (const w of slots) {
                if (w === null) continue;
                const inHistory = (history.get(w)?.count ?? 0) >= 1;
                if (excluded.has(w.toLowerCase()) && !inHistory) throw new Error(`excluded word shown: ${w}`);
              }
            }
          } else {
            const reference = run(new Set());
            if (JSON.stringify(actual) !== JSON.stringify(reference)) {
              throw new Error(`filter off differs from empty exclusion: ${JSON.stringify(actual)} vs ${JSON.stringify(reference)}`);
            }
          }
        },
      ),
    );
  });

  /**
   * Filter toggled on between calls (design.md Property 15, tasks.md 5.6): a word in a locked
   * slot is never swapped out when the filter is turned on, even if it is now excluded;
   * unlocked slots hold no excluded non-history word; and the first `recompute` after the
   * lock is released (nothing locked) leaves no excluded non-history word in any slot.
   *
   * **Validates: Requirements 4.13, 4.15**
   */
  it('Property 15 (toggle): locked words survive switching the filter on; release clears them', () => {
    fc.assert(
      fc.property(
        arbWordList,
        arbHistory,
        arbExclusionPicks,
        arbExclusionExtras,
        arbSlotCount.chain((n) => fc.tuple(fc.constant(n), arbLockedSet(n))),
        arbMessage,
        arbPartialWord,
        arbPartialWord,
        (wordList, history, picks, extras, [slotCount, locked], message, partial0, partial) => {
          const excluded = buildExclusion(wordList, history, picks, extras);
          let enabled = false;
          const strip = createPredictionStrip(slotCount, wordList, toHistory(history), { excluded, enabled: () => enabled });
          strip.recompute(message, partial0, () => false);
          const before = strip.slots.map((s) => s.word);
          enabled = true;
          const isExcluded = (w: string): boolean => excluded.has(w.toLowerCase()) && (history.get(w)?.count ?? 0) < 1;

          strip.recompute(message, partial, (i) => locked.has(i));
          strip.slots.forEach((s, i) => {
            // (a) a locked slot keeps its word, even if it is now excluded.
            if (locked.has(i) && s.word !== before[i]) {
              throw new Error(`locked slot ${i} changed: ${String(before[i])} -> ${String(s.word)}`);
            }
            // (b) unlocked slots hold no excluded non-history word.
            if (!locked.has(i) && s.word !== null && isExcluded(s.word)) throw new Error(`excluded word shown: ${s.word}`);
          });

          // (c) first recompute after the locks are released.
          strip.recompute(message, partial, () => false);
          for (const s of strip.slots) {
            if (s.word !== null && isExcluded(s.word)) throw new Error(`excluded word kept after release: ${s.word}`);
          }
        },
      ),
    );
  });
});
