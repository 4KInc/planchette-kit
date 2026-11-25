/**
 * Prediction strip model (design.md "prediction.ts" and "Data Models").
 * Pure: no DOM, no clock, no storage.
 */

import { CORE_VOCABULARY } from './core-vocabulary.js';
import { normaliseSpokenWord } from './spoken-words.js';

export interface SlotState {
  readonly index: number;
  readonly word: string | null;
}

/** true = do not overwrite this slot now. */
export type SlotLock = (index: number) => boolean;

export interface PredictionWordList {
  /** word -> 1 / (rank + 1), 0-based rank, top = 1. Insertion order is not relied on. */
  readonly words: ReadonlyMap<string, number>;
}

/**
 * Spoken-word history as design.md defines it (a Map keyed by word). board-storage.ts
 * stores an array of `HistoryEntry` ({ word, count, lastSpokenAt }); main.ts converts
 * that array to this Map. `lastSpokenAt` is never used for ranking.
 */
export interface SpokenWordHistory {
  readonly entries: ReadonlyMap<string, { count: number; lastSpokenAt: number }>;
}

export interface OffensiveWordFilter {
  readonly excluded: ReadonlySet<string>; // normalised single words (Exclusion list)
  readonly enabled: () => boolean; // current `filterOffensiveWords` setting
}

export interface PredictionStrip {
  readonly slots: readonly SlotState[];
  recompute(message: string, partialWord: string, isLocked: SlotLock): void;
  subscribe(fn: (slots: readonly SlotState[]) => void): () => void;
}

const CORE_WORDS: ReadonlySet<string> = new Set(CORE_VOCABULARY.map((c) => c.label.toLowerCase()));

/** 1 + ln(count) for count >= 1, else 0. No time decay. */
export function recencyWeight(history: SpokenWordHistory, word: string): number {
  const e = history.entries.get(historyKey(word));
  if (e === undefined || !Number.isFinite(e.count) || e.count < 1) return 0;
  return 1 + Math.log(e.count);
}

/** History keys are normalised words, so every lookup normalises its argument first. */
function historyKey(word: string): string {
  return normaliseSpokenWord(word) ?? word;
}

function inHistory(history: SpokenWordHistory, word: string): boolean {
  const e = history.entries.get(historyKey(word));
  return e !== undefined && Number.isFinite(e.count) && e.count >= 1;
}

/** normalizedFreq + recencyWeight; a word absent from the bundled list has normalizedFreq 0. */
export function scoreWord(wordList: PredictionWordList, history: SpokenWordHistory, word: string): number {
  return (wordList.words.get(word) ?? 0) + recencyWeight(history, word);
}

export function createPredictionStrip(
  slotCount: number,
  wordList: PredictionWordList,
  history: SpokenWordHistory,
  filter: OffensiveWordFilter,
): PredictionStrip {
  let slots: readonly SlotState[] = Array.from({ length: slotCount }, (_, index) => ({ index, word: null }));
  const listeners = new Set<(s: readonly SlotState[]) => void>();

  function rank(partialWord: string): string[] {
    const candidates = new Set<string>(wordList.words.keys());
    for (const w of history.entries.keys()) if (inHistory(history, w)) candidates.add(w);

    const prefix = partialWord.toLowerCase();
    const filterOn = filter.enabled();
    const info = new Map<string, { score: number; hist: boolean; freq: number }>();
    for (const w of candidates) {
      const lower = w.toLowerCase();
      if (CORE_WORDS.has(lower)) continue;
      const hist = inHistory(history, w);
      if (filterOn && !hist && filter.excluded.has(lower)) continue;
      if (prefix !== '' && !lower.startsWith(prefix)) continue;
      info.set(w, { score: scoreWord(wordList, history, w), hist, freq: wordList.words.get(w) ?? 0 });
    }

    const usePrefixGroups = prefix !== '';
    return [...info.keys()].sort((a, b) => {
      const x = info.get(a)!;
      const y = info.get(b)!;
      // Prefix rule: history words form the first group regardless of score.
      if (usePrefixGroups && x.hist !== y.hist) return x.hist ? -1 : 1;
      if (x.score !== y.score) return y.score - x.score;
      // Tie-break: history words first, then bundled-list rank, then lexicographic.
      if (x.hist !== y.hist) return x.hist ? -1 : 1;
      const xIn = wordList.words.has(a);
      const yIn = wordList.words.has(b);
      if (xIn !== yIn) return xIn ? -1 : 1;
      if (xIn && yIn && x.freq !== y.freq) return y.freq - x.freq; // higher freq = better rank
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }

  return {
    get slots() {
      return slots;
    },
    // `message` is deliberately unused: it does not filter candidates (design.md).
    recompute(_message: string, partialWord: string, isLocked: SlotLock): void {
      const ranked = rank(partialWord);
      const used = new Set<string>();
      slots.forEach((s, i) => {
        if (isLocked(i) && s.word !== null) used.add(s.word);
      });
      let next = 0;
      const out: SlotState[] = slots.map((s, i) => {
        if (isLocked(i)) return s;
        while (next < ranked.length && used.has(ranked[next]!)) next++;
        if (next >= ranked.length) return { index: i, word: null };
        const word = ranked[next++]!;
        used.add(word);
        return { index: i, word };
      });
      slots = out;
      for (const fn of [...listeners]) fn(slots);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
