import { describe, expect, it } from "vitest";
import { createBoardApp } from "../src/main";
import { readHistory, type StorageLike } from "../src/board-storage";
import { normaliseSpokenWords } from "../src/spoken-words";

function memory(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

function app(spoken = true) {
  const storage = memory();
  const calls: string[] = [];
  const a = createBoardApp({
    storage,
    now: () => 1234,
    speak: async (t) => {
      calls.push(t);
      return { spoken };
    },
    wordList: { words: new Map([["apple", 1], ["banana", 0.5]]) },
    excluded: new Set(),
  });
  return { a, storage, calls };
}

const counts = (a: ReturnType<typeof app>["a"]) => Object.fromEntries(a.getHistory().map((e) => [e.word, e.count]));

describe("history update rule", () => {
  it("selecting a predicted word alone does not change history", () => {
    const { a, storage } = app();
    expect(a.strip.slots[0]?.word).toBe("apple");
    a.selectPrediction(0);
    expect(a.model.message).toBe("apple");
    expect(a.getHistory()).toEqual([]);
    expect(readHistory(storage).value).toEqual([]);
  });

  it("a spoken: true result adds each word of the message and persists it", async () => {
    const { a, storage, calls } = app(true);
    a.model.dispatch({ type: "replace", text: "go home now" }, false);
    await a.speakMessage();
    expect(calls).toEqual(["go home now"]);
    expect(counts(a)).toEqual({ go: 1, home: 1, now: 1 });
    expect(readHistory(storage).value.map((e) => e.lastSpokenAt)).toEqual([1234, 1234, 1234]);
  });

  it("a spoken: false result leaves history unchanged", async () => {
    const { a, storage } = app(false);
    a.model.dispatch({ type: "replace", text: "go home" }, false);
    await a.speakMessage();
    expect(a.getHistory()).toEqual([]);
    expect(readHistory(storage).usedDefault).toBe(true);
  });

  it("speaking raises a word's rank in the prediction strip", async () => {
    const { a } = app(true);
    a.model.dispatch({ type: "replace", text: "banana" }, false);
    await a.speakMessage();
    a.model.dispatch({ type: "clear" }, false);
    expect(a.strip.slots[0]?.word).toBe("banana");
  });
});

describe("normalisation", () => {
  it("speaking the example message adds exactly hello, don't, josé, quoted", async () => {
    const { a } = app(true);
    a.model.dispatch({ type: "replace", text: "Hello, don't José! 1234 'quoted' 😀" }, false);
    await a.speakMessage();
    expect(a.getHistory().map((e) => e.word).sort()).toEqual(["don't", "hello", "josé", "quoted"].sort());
    expect(normaliseSpokenWords("Hello, don't José! 1234 'quoted' 😀")).toEqual(["hello", "don't", "josé", "quoted"]);
  });

  it('speaking "Hello" then "hello," gives the single key hello count 2', async () => {
    const { a } = app(true);
    a.model.dispatch({ type: "replace", text: "Hello" }, false);
    await a.speakMessage();
    a.model.dispatch({ type: "replace", text: "hello," }, false);
    await a.speakMessage();
    expect(counts(a)).toEqual({ hello: 2 });
  });
});
