/**
 * Communication board wiring. `createBoardApp` wires the pure stores (no DOM, no
 * Planchette) and is the testable part. `startBoard` is the browser entry: it creates the
 * Planchette and mounts board-dom.ts. Importing this module runs nothing; the page's
 * script (entry.ts) calls `startBoard`.
 */
/// <reference types="vite/client" />
import { createPlanchette, type Planchette, type Profile } from '@planchette/skeleton';
import { mountBoardDom, type BoardDom } from './board-dom.js';
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
import { pickLocalVoice, speak, type SpeechResult } from './speech.js';
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

export interface StartedBoard {
  readonly planchette: Planchette;
  readonly app: BoardApp;
  readonly dom: BoardDom;
}

/** Browser entry: creates the Planchette and the Board, and mounts the DOM layer. */
export function startBoard(doc: Document = document): StartedBoard {
  const win = doc.defaultView;
  if (win === null) throw new Error('board: the document has no window');
  const status = doc.getElementById('camera-status');
  const planchette = createPlanchette({
    screen: { width: win.innerWidth, height: win.innerHeight },
    assetsUrl: `${import.meta.env.BASE_URL}mediapipe/`,
    ...(status === null ? {} : { trackingIndicator: status }),
  });
  const app: BoardApp = createBoardApp({
    now: () => Date.now(),
    speak: (text) => {
      const { voiceURI, speechRate } = app.getSettings();
      const voice = pickLocalVoice(win.speechSynthesis.getVoices(), voiceURI);
      return speak(text, { voice, rate: speechRate }, win.speechSynthesis);
    },
  });
  // First: the saved or imported Profile, or the Board's 1400 ms dwell default (Req 11 AC 5, 6).
  planchette.setProfile(app.initialProfile);
  const dom = mountBoardDom({ host: planchette, app, document: doc });
  // For the end-to-end tests and for people trying the Board in the console.
  (win as unknown as { planchetteBoard: { planchette: Planchette } }).planchetteBoard = { planchette };
  return { planchette, app, dom };
}
