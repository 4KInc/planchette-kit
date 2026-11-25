import { createPlanchette, type Planchette } from "@planchette/skeleton";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBoardModel, type BoardAction } from "../src/board-model";
import {
  exportBoardSettings,
  importBoardSettings,
  sanitiseBoardSettings,
  type BoardSettingsValues,
} from "../src/board-settings";
import {
  KEY_HISTORY,
  KEY_MESSAGE,
  KEY_QUICK_PHRASES,
  KEY_SETTINGS,
  readHistory,
  readMessage,
  readQuickPhrases,
  readSettings,
  writeHistory,
  writeMessage,
  writeQuickPhrases,
  writeSettings,
  type StorageLike,
} from "../src/board-storage";
import { createBoardApp } from "../src/main";
import { createQuickPhrasesStore } from "../src/quick-phrases";
import { pickLocalVoice, speak } from "../src/speech";

// ---- spies on the four network entry points --------------------------------

const fetchSpy = vi.fn();
const xhrSpy = vi.fn();
const wsSpy = vi.fn();
const beaconSpy = vi.fn();
const totalCalls = (): number =>
  fetchSpy.mock.calls.length + xhrSpy.mock.calls.length + wsSpy.mock.calls.length + beaconSpy.mock.calls.length;

// Fake speech: utterances are recorded so a step can fire end/error; otherwise the watchdog fires.
interface FakeUtt {
  text: string;
  voice: unknown;
  rate: number;
  fire(type: string): void;
}
let utterances: FakeUtt[] = [];
let utterancesSeen = 0;

class FakeUtterance implements FakeUtt {
  voice: unknown = null;
  rate = 1;
  private l = new Map<string, Array<() => void>>();
  constructor(public text: string) {
    utterances.push(this);
    utterancesSeen += 1;
  }
  addEventListener(type: string, fn: () => void): void {
    this.l.set(type, [...(this.l.get(type) ?? []), fn]);
  }
  fire(type: string): void {
    for (const fn of this.l.get(type) ?? []) fn();
  }
}

const synth = {
  speak: vi.fn(),
  cancel: vi.fn(),
  getVoices: (): SpeechSynthesisVoice[] => [],
};

beforeEach(() => {
  for (const s of [fetchSpy, xhrSpy, wsSpy, beaconSpy]) s.mockClear();
  utterances = [];
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubGlobal("XMLHttpRequest", xhrSpy);
  vi.stubGlobal("WebSocket", wsSpy);
  // navigator may be absent (Node < 21) or a read-only getter; stub a whole object either way.
  const nav = (globalThis as { navigator?: object }).navigator ?? {};
  vi.stubGlobal("navigator", Object.assign(Object.create(Object.getPrototypeOf(nav)), nav, { sendBeacon: beaconSpy }));
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---- helpers ---------------------------------------------------------------

function memory(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

const voices = [
  { voiceURI: "local-a", localService: true, name: "A", lang: "en", default: true },
  { voiceURI: "remote-b", localService: false, name: "B", lang: "en", default: false },
] as SpeechSynthesisVoice[];

// ---- generators ------------------------------------------------------------

const textArb = fc.oneof(fc.constantFrom("hello", "go", "apple", "I need water"), fc.string({ maxLength: 20 }));

const actionArb: fc.Arbitrary<BoardAction> = fc.oneof(
  textArb.map((text): BoardAction => ({ type: "add-word", text })),
  fc.string({ minLength: 1, maxLength: 1 }).map((char): BoardAction => ({ type: "add-letter", char })),
  fc.constant<BoardAction>({ type: "add-space" }),
  fc.constant<BoardAction>({ type: "backspace" }),
  fc.constant<BoardAction>({ type: "clear" }),
  textArb.map((text): BoardAction => ({ type: "replace", text })),
);

const jsonValueArb = fc.jsonValue();
const settingsLikeArb = fc.oneof(
  fc.string({ maxLength: 60 }),
  jsonValueArb.map((v) => JSON.stringify(v)),
  fc
    .record(
      {
        version: fc.anything(),
        profile: fc.oneof(fc.object({ maxDepth: 1 }), fc.anything()),
        board: fc.oneof(
          fc.record(
            {
              predictionSlotCount: fc.anything(),
              voiceURI: fc.anything(),
              speechRate: fc.anything(),
              filterOffensiveWords: fc.anything(),
            },
            { requiredKeys: [] },
          ),
          fc.anything(),
        ),
      },
      { requiredKeys: [] },
    )
    .map((v) => {
      try {
        return JSON.stringify(v);
      } catch {
        return "{}";
      }
    }),
);

type Step =
  | { k: "dispatch"; action: BoardAction; spell: boolean }
  | { k: "undo" }
  | { k: "select"; slot: number; spell: boolean }
  | { k: "speak"; outcome: "end" | "error" | "watchdog"; voice: boolean }
  | { k: "qp-add"; text: string }
  | { k: "qp-update"; idx: number; text: string }
  | { k: "qp-remove"; idx: number }
  | { k: "qp-reorder"; seed: number }
  | { k: "import"; json: string }
  | { k: "export" }
  | { k: "sanitise"; raw: unknown }
  | { k: "storage-rw"; key: number; raw: string }
  | { k: "storage-write"; text: string };

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ k: fc.constant("dispatch" as const), action: actionArb, spell: fc.boolean() }) },
  { weight: 1, arbitrary: fc.constant<Step>({ k: "undo" }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant("select" as const), slot: fc.integer({ min: 0, max: 8 }), spell: fc.boolean() }) },
  {
    weight: 3,
    arbitrary: fc.record({
      k: fc.constant("speak" as const),
      outcome: fc.constantFrom("end" as const, "error" as const, "watchdog" as const),
      voice: fc.boolean(),
    }),
  },
  { weight: 2, arbitrary: fc.record({ k: fc.constant("qp-add" as const), text: fc.string({ maxLength: 600 }) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("qp-update" as const), idx: fc.nat(120), text: textArb }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("qp-remove" as const), idx: fc.nat(120) }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("qp-reorder" as const), seed: fc.nat() }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant("import" as const), json: settingsLikeArb }) },
  { weight: 1, arbitrary: fc.constant<Step>({ k: "export" }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("sanitise" as const), raw: fc.anything() }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("storage-rw" as const), key: fc.nat(3), raw: settingsLikeArb }) },
  { weight: 1, arbitrary: fc.record({ k: fc.constant("storage-write" as const), text: fc.string({ maxLength: 3000 }) }) },
);

const KEYS = [KEY_MESSAGE, KEY_HISTORY, KEY_QUICK_PHRASES, KEY_SETTINGS];

describe("no network (Property 13)", () => {
  it("sanity: the spies detect a call", () => {
    void fetchSpy("https://example.invalid");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(totalCalls()).toBe(1);
    new (xhrSpy as unknown as new () => unknown)();
    new (wsSpy as unknown as new (u: string) => unknown)("ws://x");
    navigator.sendBeacon("/x");
    expect(totalCalls()).toBe(4);
    // and the stubs are the ones the code under test would see
    expect(globalThis.fetch).toBe(fetchSpy);
    expect(globalThis.XMLHttpRequest).toBe(xhrSpy);
    expect(globalThis.WebSocket).toBe(wsSpy);
    expect(navigator.sendBeacon).toBe(beaconSpy);
  });

  /**
   * **Property 13: No network calls**
   * **Validates: Requirements 10.1, 10.3**
   */
  it("Property 13: No network calls", async () => {
    const planchette: Planchette = createPlanchette({ screen: { width: 1000, height: 800 } });
    try {
      await fc.assert(
        fc.asyncProperty(fc.array(stepArb, { maxLength: 40 }), async (steps) => {
          for (const s of [fetchSpy, xhrSpy, wsSpy, beaconSpy]) s.mockClear();
          utterances = [];
          const storage = memory();
          let clock = 1000;
          const speakViaSynth = async (text: string, hasVoice: boolean) => {
            const voice = hasVoice ? pickLocalVoice(voices, "remote-b") : null;
            const p = speak(text, { voice, rate: 1 }, synth);
            return p;
          };
          let pending: Promise<unknown>[] = [];
          let outcome: "end" | "error" | "watchdog" = "end";
          let useVoice = true;
          const app = createBoardApp({
            storage,
            now: () => (clock += 10),
            speak: (text) => {
              const p = speakViaSynth(text, useVoice);
              const before = utterances.length;
              // Resolve the utterance according to the step's outcome.
              queueMicrotask(() => {
                const u = utterances[before];
                if (u && outcome !== "watchdog") u.fire(outcome);
                else void vi.advanceTimersByTimeAsync(10_000_000);
              });
              return p;
            },
            wordList: { words: new Map([["apple", 5], ["apricot", 4], ["banana", 3], ["go", 2], ["hello", 9], ["help", 1]]) },
            excluded: new Set(["banana"]),
          });
          const qp = createQuickPhrasesStore({ storage });
          const model = createBoardModel("seed");

          for (const s of steps) {
            switch (s.k) {
              case "dispatch":
                app.model.dispatch(s.action, s.spell);
                model.dispatch(s.action, s.spell);
                break;
              case "undo":
                app.model.undo();
                model.undo();
                break;
              case "select":
                app.selectPrediction(s.slot, s.spell);
                break;
              case "speak":
                outcome = s.outcome;
                useVoice = s.voice;
                pending.push(app.speakMessage());
                await Promise.all(pending);
                pending = [];
                break;
              case "qp-add":
                qp.add(s.text);
                break;
              case "qp-update":
                qp.update(qp.phrases[s.idx % Math.max(1, qp.phrases.length)]?.id ?? "none", s.text);
                break;
              case "qp-remove":
                qp.remove(qp.phrases[s.idx % Math.max(1, qp.phrases.length)]?.id ?? "none");
                break;
              case "qp-reorder": {
                const ids = qp.phrases.map((p) => p.id);
                ids.sort((a, b) => ((a.length * 31 + s.seed) % 7) - ((b.length * 17 + s.seed) % 7) || (a < b ? -1 : 1));
                qp.reorder(ids);
                // A phrase chosen from the list replaces the message.
                const first = qp.phrases[0];
                if (first) app.model.dispatch({ type: "replace", text: first.text }, false);
                break;
              }
              case "import": {
                const r = importBoardSettings(planchette, s.json);
                const out = exportBoardSettings(planchette, r.value.board as BoardSettingsValues);
                importBoardSettings(planchette, out);
                break;
              }
              case "export":
                exportBoardSettings(planchette, app.getSettings());
                break;
              case "sanitise":
                sanitiseBoardSettings(s.raw);
                break;
              case "storage-rw":
                storage.setItem(KEYS[s.key % KEYS.length]!, s.raw);
                readMessage(storage);
                readHistory(storage);
                readQuickPhrases(storage);
                readSettings(storage);
                break;
              case "storage-write":
                writeMessage(s.text, storage);
                writeHistory([{ word: s.text, count: 1, lastSpokenAt: 1 }], storage);
                writeQuickPhrases([{ id: "x", text: s.text }], storage);
                writeSettings(readSettings(storage).value, storage);
                break;
            }
          }
          expect(fetchSpy).not.toHaveBeenCalled();
          expect(xhrSpy).not.toHaveBeenCalled();
          expect(wsSpy).not.toHaveBeenCalled();
          expect(beaconSpy).not.toHaveBeenCalled();
          expect(totalCalls()).toBe(0);
        }),
        { numRuns: 100 },
      );
      // the generated sequences really reached the speech layer
      expect(utterancesSeen).toBeGreaterThan(0);
    } finally {
      planchette.destroy();
    }
  });
});
