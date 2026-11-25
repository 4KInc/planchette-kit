/**
 * Communication board entry point. First version: wires the pure stores only (no DOM,
 * no Planchette, no camera). `createBoardApp` is the testable wiring; importing this
 * module runs nothing.
 */
import type { Profile } from '@planchette/skeleton';
import offensiveWordsData from '../data/offensive-words.json';
import predictionWordListData from '../data/prediction-word-list.json';
import { resolveInitialProfile } from './board-settings.js';
import { createBoardModel, type BoardModel } from './board-model.js';
import {
  HISTORY_MAX_WORDS,
  readHistory,
  readMessage,
  readSettings,
  writeHistory,
  type HistoryEntry,
  type StorageLike,
  type StoredBoardSettings,
} from './board-storage.js';
import {
  createPredictionStrip,
  type PredictionStrip,
  type PredictionWordList,
  type SpokenWordHistory,
} from './prediction.js';
import type { SpeechResult } from './speech.js';
import { normaliseSpokenWords } from './spoken-words.js';

export interface BoardAppDeps {
  /** Speaks `text`; resolves `{ spoken: true }` only when speech finished. */
  readonly speak: (text: string) => Promise<SpeechResult>;
  /** Milliseconds since the epoch; used for `lastSpokenAt`. */
  readonly now: () => number;
  /** Defaults to `localStorage`. */
  readonly storage?: StorageLike;
  /** Defaults to the bundled list. */
  readonly wordList?: PredictionWordList;
  /** Defaults to the bundled Exclusion list. */
  readonly excluded?: ReadonlySet<string>;
}

export interface BoardApp {
  readonly model: BoardModel;
  readonly strip: PredictionStrip;
  /** Pass this to the first `planchette.setProfile(...)` (task 13.1). */
  readonly initialProfile: Partial<Profile>;
  getSettings(): StoredBoardSettings;
  /** Snapshot of the Spoken-word history, as stored. */
  getHistory(): readonly HistoryEntry[];
  /** Adds the predicted word in `slotIndex` to the message. Never touches history. */
  selectPrediction(slotIndex: number, spellMode?: boolean): void;
  /**
   * Speaks the current message (nothing is spoken for an empty message). Only when the
   * result is `{ spoken: true }` is each normalised word appended to the history.
   */
  speakMessage(): Promise<SpeechResult>;
}

export function loadBundledWordList(): PredictionWordList {
  return { words: new Map(Object.entries(predictionWordListData as Record<string, number>)) };
}

export function createBoardApp(deps: BoardAppDeps): BoardApp {
  const settingsResult = readSettings(deps.storage);
  const settings = settingsResult.value;
  const initialProfile = resolveInitialProfile(settingsResult);

  const history = new Map<string, { count: number; lastSpokenAt: number }>();
  for (const e of readHistory(deps.storage).value) {
    history.set(e.word, { count: e.count, lastSpokenAt: e.lastSpokenAt });
  }
  const spoken: SpokenWordHistory = { entries: history };

  const model = createBoardModel(readMessage(deps.storage).value);
  const strip = createPredictionStrip(
    settings.board.predictionSlotCount,
    deps.wordList ?? loadBundledWordList(),
    spoken,
    {
      excluded: deps.excluded ?? new Set<string>(offensiveWordsData as string[]),
      enabled: () => settings.board.filterOffensiveWords,
    },
  );
  const recompute = (): void => strip.recompute(model.message, model.partialWord, () => false);
  model.subscribe(recompute);
  recompute();

  const snapshot = (): HistoryEntry[] =>
    [...history].map(([word, v]) => ({ word, count: v.count, lastSpokenAt: v.lastSpokenAt }));

  return {
    model,
    strip,
    initialProfile,
    getSettings: () => settings.board,
    getHistory: snapshot,
    selectPrediction(slotIndex, spellMode = false) {
      const word = strip.slots[slotIndex]?.word;
      if (word === null || word === undefined) return;
      model.dispatch({ type: 'add-word', text: word }, spellMode);
    },
    async speakMessage() {
      const text = model.message;
      if (text === '') return { spoken: false };
      const result = await deps.speak(text);
      if (!result.spoken) return result;
      const at = deps.now();
      for (const w of normaliseSpokenWords(text)) {
        history.set(w, { count: (history.get(w)?.count ?? 0) + 1, lastSpokenAt: at });
      }
      if (history.size > HISTORY_MAX_WORDS) {
        const keep = [...history].sort((a, b) => b[1].lastSpokenAt - a[1].lastSpokenAt).slice(0, HISTORY_MAX_WORDS);
        history.clear();
        for (const [k, v] of keep) history.set(k, v);
      }
      writeHistory(snapshot(), deps.storage);
      recompute();
      return result;
    },
  };
}
