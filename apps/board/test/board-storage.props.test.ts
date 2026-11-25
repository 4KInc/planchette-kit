import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createBoardModel } from '../src/board-model.js';
import {
  DEFAULT_HISTORY,
  DEFAULT_MESSAGE,
  DEFAULT_QUICK_PHRASES,
  DEFAULT_SETTINGS,
  HISTORY_MAX_WORDS,
  KEY_HISTORY,
  KEY_MESSAGE,
  KEY_QUICK_PHRASES,
  KEY_SETTINGS,
  MESSAGE_MAX_CHARS,
  QUICK_PHRASES_MAX,
  QUICK_PHRASE_MAX_CHARS,
  readHistory,
  readJSON,
  readMessage,
  readQuickPhrases,
  readSettings,
  writeHistory,
  writeMessage,
  writeQuickPhrases,
  writeSettings,
  type StorageLike,
  type StorageResult,
} from '../src/board-storage.js';

/**
 * Feature: board, Property 12: Corrupt or partial storage never throws and falls back
 * to the documented default (amended for quick phrases: over-cap lists are cut down,
 * not defaulted)
 * **Validates: Requirements 10.4, 7.6**
 */

function stubStorage(key: string, raw: string): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>([[key, raw]]);
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

interface KeySpec {
  readonly name: string;
  readonly key: string;
  /** Field names that make a version-1 object "right-shaped" for this key. */
  readonly fields: readonly string[];
  readonly read: (s: StorageLike) => StorageResult<unknown>;
  readonly defaultValue: unknown;
  /** Re-writes the read value and, where relevant, exercises the Board model with it. */
  readonly useDefault: (value: unknown, s: StorageLike) => void;
  /** Valid JSON text with a correct version but exceeding the key's size cap. */
  readonly oversize: fc.Arbitrary<string>;
  /** Valid JSON text, plus the value expected from reading it back. */
  readonly valid: fc.Arbitrary<{ raw: string; expected: unknown }>;
}

const word = fc.string({ minLength: 1, maxLength: 12 });
const historyEntry = fc.record({
  word,
  count: fc.integer({ min: 0, max: 1000 }),
  lastSpokenAt: fc.integer({ min: 0, max: 2_000_000_000 }),
});
const phrase = fc.record({ id: fc.string({ maxLength: 10 }), text: fc.string({ maxLength: 40 }) });
const settingsValue = fc.record({
  profile: fc.constant({}),
  board: fc.record({
    predictionSlotCount: fc.integer({ min: 1, max: 8 }),
    voiceURI: fc.string({ maxLength: 20 }),
    speechRate: fc.double({ min: 0.5, max: 2, noNaN: true, noDefaultInfinity: true }),
    filterOffensiveWords: fc.boolean(),
  }),
});

const specs: readonly KeySpec[] = [
  {
    name: 'message',
    key: KEY_MESSAGE,
    fields: ['message'],
    read: readMessage,
    defaultValue: DEFAULT_MESSAGE,
    useDefault: (value, s) => {
      writeMessage(value as string, s);
      const model = createBoardModel(value as string);
      model.dispatch({ type: 'add-word', text: 'hello' }, false);
      model.dispatch({ type: 'backspace' }, false);
    },
    oversize: fc
      .integer({ min: MESSAGE_MAX_CHARS + 1, max: MESSAGE_MAX_CHARS + 50 })
      .map((n) => JSON.stringify({ version: 1, message: 'a'.repeat(n) })),
    valid: fc
      .string({ maxLength: 100 })
      .map((message) => ({ raw: JSON.stringify({ version: 1, message }), expected: message })),
  },
  {
    name: 'history',
    key: KEY_HISTORY,
    fields: ['words'],
    read: readHistory,
    defaultValue: DEFAULT_HISTORY,
    useDefault: (value, s) => writeHistory(value as never, s),
    oversize: fc
      .integer({ min: HISTORY_MAX_WORDS + 1, max: HISTORY_MAX_WORDS + 20 })
      .map((n) =>
        JSON.stringify({
          version: 1,
          words: Array.from({ length: n }, (_, i) => ({ word: `w${i}`, count: 1, lastSpokenAt: i })),
        }),
      ),
    valid: fc
      .array(historyEntry, { maxLength: 20 })
      .map((words) => ({ raw: JSON.stringify({ version: 1, words }), expected: words })),
  },
  {
    name: 'quick-phrases',
    key: KEY_QUICK_PHRASES,
    fields: ['phrases'],
    read: readQuickPhrases,
    defaultValue: DEFAULT_QUICK_PHRASES,
    useDefault: (value, s) => writeQuickPhrases(value as never, s),
    oversize: fc.oneof(
      fc.integer({ min: QUICK_PHRASES_MAX + 1, max: QUICK_PHRASES_MAX + 20 }).map((n) =>
        JSON.stringify({ version: 1, phrases: Array.from({ length: n }, (_, i) => ({ id: `${i}`, text: 'x' })) }),
      ),
      fc.integer({ min: QUICK_PHRASE_MAX_CHARS + 1, max: QUICK_PHRASE_MAX_CHARS + 50 }).map((n) =>
        JSON.stringify({ version: 1, phrases: [{ id: 'a', text: 'x'.repeat(n) }] }),
      ),
    ),
    valid: fc
      .array(phrase, { maxLength: 20 })
      .map((phrases) => ({ raw: JSON.stringify({ version: 1, phrases }), expected: phrases })),
  },
  {
    name: 'settings',
    key: KEY_SETTINGS,
    fields: ['profile', 'board'],
    read: readSettings,
    defaultValue: DEFAULT_SETTINGS,
    useDefault: (value, s) => writeSettings(value as never, s),
    // Settings has no documented size cap in board-storage.ts; the shape checks cover it.
    oversize: fc.constant(JSON.stringify({ version: 1, profile: {}, board: {} })),
    valid: settingsValue.map((v) => ({ raw: JSON.stringify({ version: 1, ...v }), expected: v })),
  },
];

/** Arbitrary raw strings that are corrupt or partial for `spec`. */
function corruptRaw(spec: KeySpec): fc.Arbitrary<string> {
  const nonJson = fc.string({ maxLength: 60 }).filter((s) => {
    try {
      JSON.parse(s);
      return false;
    } catch {
      return true;
    }
  });
  const truncated = fc
    .tuple(spec.valid, fc.nat(1000))
    .map(([v, n]) => v.raw.slice(0, Math.min(n, v.raw.length - 1)))
    .filter((s) => {
      try {
        JSON.parse(s);
        return false;
      } catch {
        return true;
      }
    });
  // Any JSON value that is not a version-1 object carrying this key's fields.
  const anyJson = fc.jsonValue().filter((v) => {
    const o = v as Record<string, unknown> | null;
    return !(o && typeof o === 'object' && !Array.isArray(o) && o.version === 1 && spec.fields.every((f) => f in o));
  });
  const wrongShapeV1 = fc
    .dictionary(
      fc.string({ maxLength: 8 }).filter((k) => !spec.fields.includes(k) && k !== '__proto__'),
      fc.jsonValue(),
      { maxKeys: 4 },
    )
    .map((d) => ({ ...d, version: 1 }));
  const wrongFieldType = fc
    .jsonValue()
    .map((v) => Object.fromEntries([['version', 1], ...spec.fields.map((f) => [f, [v]] as const)]));
  const missingVersion = spec.valid.map(({ raw }) => {
    const { version: _v, ...rest } = JSON.parse(raw) as Record<string, unknown>;
    return JSON.stringify(rest);
  });
  const badVersion = fc
    .tuple(
      spec.valid,
      fc.oneof(
        fc.integer().filter((n) => n !== 1),
        fc.constantFrom('1', 'one', null, true, [], {}),
      ),
    )
    .map(([{ raw }, version]) => JSON.stringify({ ...JSON.parse(raw), version }));
  return fc.oneof(
    nonJson,
    truncated,
    anyJson.map((v) => JSON.stringify(v)),
    wrongShapeV1.map((o) => JSON.stringify(o)),
    wrongFieldType.map((o) => JSON.stringify(o)),
    missingVersion,
    badVersion,
    // Settings has no cap; quick phrases are kept cut down rather than defaulted (amended Property 12).
    ...(spec.name === 'settings' || spec.name === 'quick-phrases' ? [] : [spec.oversize]),
  );
}

describe('Property 12: Corrupt or partial storage never throws and falls back to the documented default', () => {
  for (const spec of specs) {
    describe(spec.name, () => {
      it('corrupt/partial stored value yields the default with usedDefault: true and later use does not throw', () => {
        fc.assert(
          fc.property(corruptRaw(spec), (raw) => {
            const storage = stubStorage(spec.key, raw);
            let result!: StorageResult<unknown>;
            expect(() => {
              result = spec.read(storage);
            }).not.toThrow();
            expect(result.usedDefault).toBe(true);
            expect(result.value).toEqual(spec.defaultValue);
            expect(() => spec.useDefault(result.value, storage)).not.toThrow();
            // The written-back default is itself readable as a valid value.
            expect(spec.read(storage).usedDefault).toBe(false);
          }),
          { numRuns: 200 },
        );
      });

      it('valid stored values are NOT replaced by the default', () => {
        fc.assert(
          fc.property(spec.valid, ({ raw, expected }) => {
            const result = spec.read(stubStorage(spec.key, raw));
            expect(result.usedDefault).toBe(false);
            expect(result.value).toEqual(expected);
          }),
          { numRuns: 100 },
        );
      });
    });
  }

  it('quick phrases over the caps are kept cut down (first 100, texts cut to 500), never defaulted, never throw', () => {
    fc.assert(
      fc.property(specs.find((s) => s.name === 'quick-phrases')!.oversize, (raw) => {
        const parsed = JSON.parse(raw) as { phrases: { id: string; text: string }[] };
        const storage = stubStorage(KEY_QUICK_PHRASES, raw);
        let result!: StorageResult<unknown>;
        expect(() => {
          result = readQuickPhrases(storage);
        }).not.toThrow();
        expect(result.usedDefault).toBe(false);
        expect(result.value).toEqual(
          parsed.phrases.slice(0, QUICK_PHRASES_MAX).map((p) => ({ id: p.id, text: p.text.slice(0, QUICK_PHRASE_MAX_CHARS) })),
        );
      }),
      { numRuns: 100 },
    );
  });

  it('readJSON without a migrate function falls back on any non-matching raw value and never throws', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string({ maxLength: 60 }), fc.jsonValue().map((v) => JSON.stringify(v))),
        (raw) => {
          const fallback = { sentinel: true };
          const r = readJSON('k', 1, fallback, undefined, stubStorage('k', raw));
          if (r.usedDefault) expect(r.value).toBe(fallback);
          else {
            const parsed = JSON.parse(raw) as { version: number };
            expect(parsed.version).toBe(1);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('a storage whose getItem throws, or a missing storage, yields the default without throwing', () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    for (const spec of specs) {
      const r = spec.read(throwing);
      expect(r.usedDefault).toBe(true);
      expect(r.value).toEqual(spec.defaultValue);
      expect(() => spec.useDefault(r.value, throwing)).not.toThrow();
    }
  });
});
