import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createBoardApp } from "../src/main";
import { readHistory, HISTORY_MAX_WORDS, type StorageLike } from "../src/board-storage";
import type { BoardAction } from "../src/board-model";
import { normaliseSpokenWord } from "../src/spoken-words";

function memory(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

type Step =
  | { kind: "select"; slot: number; spell: boolean }
  | { kind: "dispatch"; action: BoardAction; spell: boolean }
  | { kind: "undo" }
  | { kind: "speak"; spoken: boolean };

// Small pools keep the distinct-word count far below the 500-word history cap.
const tokenArb = fc.constantFrom("Hello", "hello,", "WORLD", "world!", "it's", "'quoted'", "123", "...", "café", "go", "a-b", "apple");
const wordArb = fc.constantFrom("apple", "banana", "Cherry", "go", "hello");

const actionArb: fc.Arbitrary<BoardAction> = fc.oneof(
  wordArb.map((text): BoardAction => ({ type: "add-word", text })),
  fc.constantFrom("a", "b", "x", "1", "!").map((char): BoardAction => ({ type: "add-letter", char })),
  fc.constant<BoardAction>({ type: "add-space" }),
  fc.constant<BoardAction>({ type: "backspace" }),
  fc.constant<BoardAction>({ type: "clear" }),
  fc
    .array(tokenArb, { maxLength: 6 })
    .chain((ts) => fc.constantFrom(" ", "  ", "\n").map((sep) => ts.join(sep)))
    .map((text): BoardAction => ({ type: "replace", text })),
);

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  { weight: 3, arbitrary: fc.record({ kind: fc.constant("select" as const), slot: fc.integer({ min: 0, max: 5 }), spell: fc.boolean() }) },
  { weight: 4, arbitrary: fc.record({ kind: fc.constant("dispatch" as const), action: actionArb, spell: fc.boolean() }) },
  { weight: 1, arbitrary: fc.constant<Step>({ kind: "undo" }) },
  { weight: 4, arbitrary: fc.record({ kind: fc.constant("speak" as const), spoken: fc.boolean() }) },
);

type Oracle = Map<string, { count: number; lastSpokenAt: number }>;

const canon = (entries: Iterable<{ word: string; count: number; lastSpokenAt: number }>) =>
  [...entries].map((e) => ({ word: e.word, count: e.count, lastSpokenAt: e.lastSpokenAt })).sort((a, b) => (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));

const expected = (o: Oracle) => canon([...o].map(([word, v]) => ({ word, ...v })));

describe("Property 8: Spoken-word history updates only on successful speech", () => {
  // **Property 8: Spoken-word history updates only on successful speech**
  // **Validates: Requirements 4.4, 4.9, 8.1, 8.2, 8.6**
  it("history changes exactly on spoken:true calls, by the normalised words of the message", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(stepArb, { maxLength: 40 }), async (steps) => {
        const storage = memory();
        let clock = 1000;
        let nextSpoken = true;
        const spokenTexts: string[] = [];
        const app = createBoardApp({
          storage,
          now: () => clock,
          speak: async (t) => {
            spokenTexts.push(t);
            return { spoken: nextSpoken };
          },
          wordList: {
            words: new Map([
              ["apple", 5],
              ["apricot", 4],
              ["banana", 3],
              ["cherry", 2],
              ["go", 1],
              ["hello", 1],
            ]),
          },
          excluded: new Set(),
        });

        const oracle: Oracle = new Map();
        const check = () => {
          expect(canon(app.getHistory())).toEqual(expected(oracle));
          expect(canon(readHistory(storage).value)).toEqual(expected(oracle));
        };
        check();

        for (const step of steps) {
          clock += 7;
          if (step.kind === "select") app.selectPrediction(step.slot, step.spell);
          else if (step.kind === "dispatch") app.model.dispatch(step.action, step.spell);
          else if (step.kind === "undo") app.model.undo();
          else {
            const message = app.model.message;
            const callsBefore = spokenTexts.length;
            nextSpoken = step.spoken;
            const result = await app.speakMessage();
            if (message === "") {
              // Nothing is spoken for an empty message.
              expect(spokenTexts.length).toBe(callsBefore);
              expect(result.spoken).toBe(false);
            } else {
              expect(spokenTexts.slice(callsBefore)).toEqual([message]);
              expect(result.spoken).toBe(step.spoken);
              if (step.spoken) {
                for (const token of message.split(/\s+/u)) {
                  const w = normaliseSpokenWord(token);
                  if (w === null) continue;
                  oracle.set(w, { count: (oracle.get(w)?.count ?? 0) + 1, lastSpokenAt: clock });
                }
              }
            }
          }
          expect(oracle.size).toBeLessThanOrEqual(HISTORY_MAX_WORDS);
          check();
        }
      }),
      { numRuns: 200 },
    );
  });

  it("a word spoken twice in one message is counted twice (pinned example)", async () => {
    const storage = memory();
    const app = createBoardApp({
      storage,
      now: () => 5,
      speak: async () => ({ spoken: true }),
      wordList: { words: new Map() },
      excluded: new Set(),
    });
    app.model.dispatch({ type: "replace", text: "Go, go! 123" }, false);
    await app.speakMessage();
    expect(canon(app.getHistory())).toEqual([{ word: "go", count: 2, lastSpokenAt: 5 }]);
  });
});
