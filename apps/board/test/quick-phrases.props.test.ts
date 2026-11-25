import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createBoardModel } from '../src/board-model.js';
import { writeQuickPhrases, type StorageLike } from '../src/board-storage.js';
import { createQuickPhrasesStore } from '../src/quick-phrases.js';

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

type Step =
  | { kind: 'dispatch'; action: Parameters<ReturnType<typeof createBoardModel>['dispatch']>[0]; spell: boolean }
  | { kind: 'select'; index: number; spell: boolean }
  | { kind: 'undo' }
  | { kind: 'reload' };

const text = fc.string({ maxLength: 20 });
const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant('dispatch' as const), action: fc.record({ type: fc.constant('add-word' as const), text }), spell: fc.boolean() }),
  fc.record({ kind: fc.constant('dispatch' as const), action: fc.record({ type: fc.constant('add-letter' as const), char: fc.string({ minLength: 1, maxLength: 1 }) }), spell: fc.boolean() }),
  fc.record({ kind: fc.constant('dispatch' as const), action: fc.constant({ type: 'add-space' as const }), spell: fc.boolean() }),
  fc.record({ kind: fc.constant('dispatch' as const), action: fc.constant({ type: 'backspace' as const }), spell: fc.boolean() }),
  fc.record({ kind: fc.constant('dispatch' as const), action: fc.constant({ type: 'clear' as const }), spell: fc.boolean() }),
  fc.record({ kind: fc.constant('select' as const), index: fc.nat(200), spell: fc.boolean() }),
  fc.constant({ kind: 'undo' as const }),
  fc.constant({ kind: 'reload' as const }),
);

const listArb = fc.uniqueArray(
  fc.record({ id: fc.string({ minLength: 1, maxLength: 8 }), text: fc.string({ maxLength: 40 }) }),
  { maxLength: 30, selector: (p) => p.id },
);

describe('Property 11: Quick-phrase order is stable under non-edit actions', () => {
  it('**Validates: Requirements 7.4**', () => {
    fc.assert(
      fc.property(listArb, fc.array(stepArb, { maxLength: 60 }), (list, steps) => {
        const storage = memoryStorage();
        writeQuickPhrases(list, storage);
        let store = createQuickPhrasesStore({ storage });
        const before = store.phrases.map((p) => ({ id: p.id, text: p.text }));
        expect(before).toEqual(list);
        const board = createBoardModel();
        for (const s of steps) {
          if (s.kind === 'dispatch') board.dispatch(s.action, s.spell);
          else if (s.kind === 'select') {
            const ph = store.phrases;
            if (ph.length > 0) board.dispatch({ type: 'replace', text: ph[s.index % ph.length]!.text }, s.spell);
          } else if (s.kind === 'undo') board.undo();
          else store = createQuickPhrasesStore({ storage });
          expect(store.phrases.map((p) => ({ id: p.id, text: p.text }))).toEqual(before);
        }
        expect(createQuickPhrasesStore({ storage }).phrases.map((p) => ({ id: p.id, text: p.text }))).toEqual(before);
      }),
      { numRuns: 200 },
    );
  });
});
