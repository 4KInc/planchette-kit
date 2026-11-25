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

  it("refuses to write more than the quick-phrases cap and writes nothing", () => {
    const s = memoryStorage();
    const phrases = Array.from({ length: QUICK_PHRASES_MAX + 1 }, (_, i) => ({ id: `${i}`, text: `p${i}` }));
    expect(writeQuickPhrases(phrases, s)).toBe(false);
    expect(s.data.has(KEY_QUICK_PHRASES)).toBe(false);
    expect(writeQuickPhrases(phrases.slice(0, QUICK_PHRASES_MAX), s)).toBe(true);
    expect(readQuickPhrases(s).value).toHaveLength(QUICK_PHRASES_MAX);
  });
  it("reads a stored list of 150 quick phrases as its first 100", () => {
    const s = memoryStorage();
    const many = Array.from({ length: 150 }, (_, i) => ({ id: `${i}`, text: `p${i}` }));
    s.data.set(KEY_QUICK_PHRASES, JSON.stringify({ version: 1, phrases: many }));
    const r = readQuickPhrases(s);
    expect(r.usedDefault).toBe(false);
    expect(r.reason).toBe("truncated");
    expect(r.value).toEqual(many.slice(0, QUICK_PHRASES_MAX));
  });
  it("cuts a stored 600-character quick phrase to 500", () => {
    const s = memoryStorage();
    s.data.set(KEY_QUICK_PHRASES, JSON.stringify({ version: 1, phrases: [{ id: "a", text: "x".repeat(600) }] }));
    const r = readQuickPhrases(s);
    expect(r.usedDefault).toBe(false);
    expect(r.value[0]?.text).toHaveLength(500);
  });
  it("reads a quick-phrases list with one malformed entry as the default", () => {
    const s = memoryStorage();
    s.data.set(KEY_QUICK_PHRASES, JSON.stringify({ version: 1, phrases: [{ id: "a", text: "ok" }, { id: 2, text: "bad" }] }));
    expect(readQuickPhrases(s)).toMatchObject({ value: [], usedDefault: true });
  });
});
