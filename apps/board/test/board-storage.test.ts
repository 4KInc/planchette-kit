import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  HISTORY_MAX_WORDS,
  KEY_HISTORY,
  KEY_MESSAGE,
  KEY_QUICK_PHRASES,
  MESSAGE_MAX_CHARS,
  QUICK_PHRASES_MAX,
  readHistory,
  readJSON,
  readMessage,
  readQuickPhrases,
  readSettings,
  writeHistory,
  writeJSON,
  writeMessage,
  writeQuickPhrases,
  writeSettings,
  type StorageLike,
} from "../src/board-storage";

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe("board-storage", () => {
  it("returns documented defaults with usedDefault for missing keys", () => {
    const s = memoryStorage();
    expect(readMessage(s)).toMatchObject({ value: "", usedDefault: true });
    expect(readHistory(s)).toMatchObject({ value: [], usedDefault: true });
    expect(readQuickPhrases(s)).toMatchObject({ value: [], usedDefault: true });
    const settings = readSettings(s);
    expect(settings.usedDefault).toBe(true);
    expect(settings.value).toEqual(DEFAULT_SETTINGS);
    expect(settings.value.board.filterOffensiveWords).toBe(true);
  });

  it("round-trips valid values", () => {
    const s = memoryStorage();
    writeMessage("hello there", s);
    expect(readMessage(s)).toEqual({ value: "hello there", usedDefault: false });
    const words = [{ word: "go", count: 2, lastSpokenAt: 5 }];
    writeHistory(words, s);
    expect(readHistory(s).value).toEqual(words);
    const phrases = [{ id: "a", text: "Thank you" }];
    writeQuickPhrases(phrases, s);
    expect(readQuickPhrases(s).value).toEqual(phrases);
    const custom = {
      profile: { dwellTime: 1400 },
      board: { predictionSlotCount: 6, voiceURI: "v", speechRate: 1.5, filterOffensiveWords: false },
    };
    writeSettings(custom, s);
    expect(readSettings(s)).toEqual({ value: custom, usedDefault: false });
  });

  it("does not throw when setItem throws QuotaExceededError", () => {
    const quota: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("full", "QuotaExceededError");
      },
    };
    expect(() => writeJSON("k", 1, { a: 1 }, quota)).not.toThrow();
    expect(() => writeMessage("x", quota)).not.toThrow();
  });

  it("falls back to default on corrupt data without throwing", () => {
    const s = memoryStorage();
    for (const raw of ["{not json", "[]", "42", '{"message":"x"}', '{"version":"1","message":"x"}', '{"version":1,"message":5}']) {
      s.data.set(KEY_MESSAGE, raw);
      expect(readMessage(s)).toMatchObject({ value: "", usedDefault: true });
    }
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => undefined,
    };
    expect(readJSON("k", 1, "d", undefined, throwing).usedDefault).toBe(true);
  });

  it("treats a stored value over its cap as the default", () => {
    const s = memoryStorage();
    s.data.set(KEY_MESSAGE, JSON.stringify({ version: 1, message: "a".repeat(MESSAGE_MAX_CHARS + 1) }));
    expect(readMessage(s).usedDefault).toBe(true);
    const many = Array.from({ length: QUICK_PHRASES_MAX + 1 }, (_, i) => ({ id: `${i}`, text: "t" }));
    s.data.set(KEY_QUICK_PHRASES, JSON.stringify({ version: 1, phrases: many }));
    expect(readQuickPhrases(s).usedDefault).toBe(true);
  });

  it("truncates an over-long message on write", () => {
    const s = memoryStorage();
    writeMessage("a".repeat(MESSAGE_MAX_CHARS + 10), s);
    expect(readMessage(s).value.length).toBe(MESSAGE_MAX_CHARS);
  });

  it("evicts the least-recently-spoken history entries past the cap", () => {
    const s = memoryStorage();
    const words = Array.from({ length: HISTORY_MAX_WORDS + 1 }, (_, i) => ({ word: `w${i}`, count: 1, lastSpokenAt: i + 1 }));
    writeHistory(words, s);
    const stored = readHistory(s).value;
    expect(stored).toHaveLength(HISTORY_MAX_WORDS);
    expect(stored.some((e) => e.word === "w0")).toBe(false);
    expect(stored.some((e) => e.word === `w${HISTORY_MAX_WORDS}`)).toBe(true);
    expect(s.data.has(KEY_HISTORY)).toBe(true);
  });

  it("evicts the oldest quick phrases past the cap", () => {
    const s = memoryStorage();
    const phrases = Array.from({ length: QUICK_PHRASES_MAX + 1 }, (_, i) => ({ id: `${i}`, text: `p${i}` }));
    writeQuickPhrases(phrases, s);
    const stored = readQuickPhrases(s).value;
    expect(stored).toHaveLength(QUICK_PHRASES_MAX);
    expect(stored[0]?.id).toBe("1");
    expect(stored.at(-1)?.id).toBe(`${QUICK_PHRASES_MAX}`);
  });
});
