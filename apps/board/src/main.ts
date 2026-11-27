/**
 * Communication board wiring. `createBoardApp` wires the pure stores (no DOM, no
 * Planchette) and is the testable part. `startBoard` is the browser entry: it creates the
 * Planchette and mounts board-dom.ts. Importing this module runs nothing; the page's
 * script (entry.ts) calls `startBoard`.
 */
/// <reference types="vite/client" />
import { createPlanchette, type Planchette, type Profile } from '@planchette/skeleton';
import { createDwellRing, createScanHighlight } from '@planchette/skeleton/ui';
import { mountBoardControls } from './board-controls.js';
import { mountBoardDom, type BoardDom } from './board-dom.js';
import { mountBoardSettings } from './board-settings-dom.js';
import offensiveWordsData from '../data/offensive-words.json';
import predictionWordListData from '../data/prediction-word-list.json';
import { resolveInitialProfile, shouldStartCameraOnLoad } from './board-settings.js';
import { createBoardModel, type BoardModel } from './board-model.js';
import {
  HISTORY_MAX_WORDS,
  readHistory,
  readMessage,
  readSettings,
  writeHistory,
  writeSettings,
  type HistoryEntry,
  type StorageLike,
  type StoredBoardSettings,
} from './board-storage.js';
import {
  createPredictionStrip,
  type PredictionStrip,
  type PredictionWordList,
  type SlotLock,
  type SpokenWordHistory,
} from './prediction.js';
import { createQuickPhrasesStore, type QuickPhrasesStore } from './quick-phrases.js';
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
  /** Defaults to a store over `storage`. */
  readonly quickPhrases?: QuickPhrasesStore;
}

export interface BoardApp {
  readonly model: BoardModel;
  readonly strip: PredictionStrip;
  /** The person's Quick phrases; the Phrases view (board-dom.ts) renders and pages them. */
  readonly quickPhrases: QuickPhrasesStore;
  /** Pass this to the first `planchette.setProfile(...)` (task 13.1). */
  readonly initialProfile: Partial<Profile>;
  /** True when no saved Profile was found at load (`usedDefault` of the settings read). */
  readonly firstRun: boolean;
  /** The current Board-only settings (changes made with `updateBoardSettings` are included). */
  getSettings(): StoredBoardSettings;
  /**
   * Changes Board settings and saves them at once (Req 6 AC 3, 8). A new `filterOffensiveWords`
   * applies to the next recompute, which runs now. `predictionSlotCount` is saved but the strip
   * keeps its slot count until the page opens again (the strip is fixed for the page's life, Req 4 AC 1).
   */
  updateBoardSettings(patch: Partial<StoredBoardSettings>): void;
  /** Snapshot of the Spoken-word history, as stored. */
  getHistory(): readonly HistoryEntry[];
  /**
   * Sets the slot-lock rule the next recomputes use (board-dom.ts supplies it from skeleton
   * events). Until set, no slot is locked.
   */
  setSlotLock(isLocked: SlotLock): void;
  /** Saves the Profile (with the current Board settings) under the settings key. */
  saveProfile(profile: Partial<Profile>): void;
  /** Completes the message with the predicted word in `slotIndex` (replacing any Partial word). Never touches history. */
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
  let board: StoredBoardSettings = settingsResult.value.board;
  const initialProfile = resolveInitialProfile(settingsResult);
  // What a Board-only save writes next to the settings. Starts as the profile the page starts with
  // (so the 1400 ms dwell default is kept when nothing was saved) and follows `saveProfile`.
  let currentProfile: Partial<Profile> = initialProfile;

  const history = new Map<string, { count: number; lastSpokenAt: number }>();
  for (const e of readHistory(deps.storage).value) {
    history.set(e.word, { count: e.count, lastSpokenAt: e.lastSpokenAt });
  }
  const spoken: SpokenWordHistory = { entries: history };

  const model = createBoardModel(readMessage(deps.storage).value);
  const strip = createPredictionStrip(
    board.predictionSlotCount,
    deps.wordList ?? loadBundledWordList(),
    spoken,
    {
      excluded: deps.excluded ?? new Set<string>(offensiveWordsData as string[]),
      enabled: () => board.filterOffensiveWords,
    },
  );
  let slotLock: SlotLock = () => false;
  const recompute = (): void => strip.recompute(model.message, model.partialWord, (i) => slotLock(i));
  model.subscribe(recompute);
  recompute();

  const snapshot = (): HistoryEntry[] =>
    [...history].map(([word, v]) => ({ word, count: v.count, lastSpokenAt: v.lastSpokenAt }));

  return {
    model,
    strip,
    quickPhrases: deps.quickPhrases ?? createQuickPhrasesStore(deps.storage === undefined ? {} : { storage: deps.storage }),
    initialProfile,
    firstRun: settingsResult.usedDefault,
    getSettings: () => board,
    updateBoardSettings(patch) {
      board = { ...board, ...patch };
      writeSettings({ profile: currentProfile, board }, deps.storage);
      recompute();
    },
    getHistory: snapshot,
    setSlotLock(isLocked) {
      slotLock = isLocked;
    },
    saveProfile(profile) {
      currentProfile = profile;
      writeSettings({ profile, board }, deps.storage);
    },
    selectPrediction(slotIndex, spellMode = false) {
      const word = strip.slots[slotIndex]?.word;
      if (word === null || word === undefined) return;
      model.dispatch({ type: 'complete-word', text: word }, spellMode);
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
export function startBoard(
  doc: Document = document,
  /** A seam for tests, which pass a fake. The page uses the real `createPlanchette`. */
  create: typeof createPlanchette = createPlanchette,
): StartedBoard {
  const win = doc.defaultView;
  if (win === null) throw new Error('board: the document has no window');
  const status = doc.getElementById('camera-status');
  const planchette = create({
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
  // Remember the mode and the dwell default. board-controls.ts calls this on a mode change
  // and when a calibration run ends (the one place those two saves happen).
  const saveCurrentProfile = (): void => app.saveProfile(JSON.parse(planchette.exportProfile()) as Partial<Profile>);
  const dom = mountBoardDom({ host: planchette, app, document: doc });
  createDwellRing(planchette, { shape: 'outline' });
  createScanHighlight(planchette);
  // Mounted before the DOM layer so the toggle has its label (and size) when it is registered.
  // The Profile is saved here, on a mode change and when calibration ends (Task 18.1).
  const controls = mountBoardControls({ host: planchette, document: doc, saveProfile: saveCurrentProfile, firstRun: app.firstRun });
  // The Settings dialog's contents. Saved Board-only settings go through the app; Profile changes
  // are applied with `setProfile` / `importProfile`, then saved and the targets re-measured.
  mountBoardSettings({
    host: planchette,
    app,
    document: doc,
    saveProfile: saveCurrentProfile,
    syncTargets: () => dom.syncTargets(),
    synth: win.speechSynthesis ?? null,
  });
  // The camera starts nowhere else, and only when the person's Profile asks for it.
  if (shouldStartCameraOnLoad(planchette.getProfile())) {
    controls.setCameraOn(true);
    planchette.startCamera().catch(() => controls.setCameraOn(false)); // the indicator shows the failure
  }
  // For the end-to-end tests and for people trying the Board in the console.
  (win as unknown as { planchetteBoard: { planchette: Planchette; quickPhrases: QuickPhrasesStore } }).planchetteBoard = {
    planchette,
    quickPhrases: app.quickPhrases,
  };
  return { planchette, app, dom };
}
