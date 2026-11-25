import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CORE_VOCABULARY } from '../src/core-vocabulary.js';
import { createBoardModel, UNDO_LIMIT, type BoardAction } from '../src/board-model.js';

/** Messages incl. empty, whitespace-only and unicode. */
const messageArb = fc.oneof(
  fc.constant(''),
  fc.stringMatching(/^[ \t\n]{1,6}$/u),
  fc.string({ unit: 'binary', maxLength: 30 }),
  fc.string({ unit: 'grapheme', maxLength: 30 }),
  fc.string({ maxLength: 30 }),
);
const partialArb = fc.string({ unit: 'grapheme', maxLength: 5 });

/** A message plus a pending partial word, built through the model so state is reachable. */
/** Non-empty messages with no trailing whitespace, so add-letter takes the space-insertion path. */
const wordsMessageArb = fc.stringMatching(/^[a-z]{1,8}( [a-z]{1,8}){0,3}$/u);
const setupArb = fc.record({
  message: fc.oneof(messageArb, wordsMessageArb),
  letters: partialArb.filter((s) => s.length > 0).map((s) => Array.from(s)),
  withLetters: fc.boolean(),
});

const nonEmpty = fc.string({ unit: 'grapheme', minLength: 1, maxLength: 12 });
const actionArb: fc.Arbitrary<BoardAction> = fc.oneof(
  nonEmpty.map((text): BoardAction => ({ type: 'add-word', text })),
  fc.string({ unit: 'grapheme', minLength: 1, maxLength: 1 }).map((char): BoardAction => ({ type: 'add-letter', char })),
  fc.constant<BoardAction>({ type: 'add-space' }),
  fc.constant<BoardAction>({ type: 'backspace' }),
  fc.constant<BoardAction>({ type: 'clear' }),
  messageArb.map((text): BoardAction => ({ type: 'replace', text })),
);

type Setup = { message: string; letters: string[]; withLetters: boolean };
function build(s: Setup) {
  const m = createBoardModel(s.message);
  if (s.withLetters) for (const c of s.letters) m.dispatch({ type: 'add-letter', char: c }, true);
  return m;
}

describe('board-model properties', () => {
  it('P2: clear then undo restores the exact message and partialWord', () => {
    // **Validates: Requirements 1.6, 1.7**
    fc.assert(
      fc.property(setupArb, (s) => {
        const m = build(s);
        const before = { message: m.message, partialWord: m.partialWord };
        m.dispatch({ type: 'clear' }, false);
        if (before.message === '') {
          // clear on empty is a no-op: nothing to undo, state unchanged
          expect(m.message).toBe('');
        } else {
          expect(m.message).toBe('');
          m.undo();
        }
        expect({ message: m.message, partialWord: m.partialWord }).toEqual(before);
      }),
    );
  });

  it('P3: any non-no-op action then undo restores the exact state', () => {
    // **Validates: Requirements 1.4, 1.5, 1.7, 7.2**
    fc.assert(
      fc.property(setupArb, actionArb, fc.boolean(), (s, action, spell) => {
        const m = build(s);
        const before = { message: m.message, partialWord: m.partialWord };
        const depth = (() => {
          let n = 0;
          const probe = build(s);
          while (probe.canUndo()) {
            probe.undo();
            n++;
          }
          return n;
        })();
        m.dispatch(action, spell);
        const noOp =
          before.message === '' && (action.type === 'backspace' || action.type === 'clear');
        if (noOp) {
          expect(m.message).toBe(before.message);
          return;
        }
        m.undo();
        expect({ message: m.message, partialWord: m.partialWord }).toEqual(before);
        // the stack is back to its depth from before the action
        let remaining = 0;
        while (m.canUndo()) {
          m.undo();
          remaining++;
        }
        expect(remaining).toBe(depth);
      }),
    );
  });

  it('the undo stack never exceeds 50 and undo on an empty stack is a no-op', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(actionArb, fc.boolean()), { maxLength: 200 }), (steps) => {
        const m = createBoardModel();
        for (const [a, spell] of steps) m.dispatch(a, spell);
        let depth = 0;
        while (m.canUndo()) {
          m.undo();
          depth++;
          expect(depth).toBeLessThanOrEqual(UNDO_LIMIT);
        }
        const after = { message: m.message, partialWord: m.partialWord };
        let notified = 0;
        m.subscribe(() => notified++);
        m.undo();
        m.undo();
        expect({ message: m.message, partialWord: m.partialWord }).toEqual(after);
        expect(notified).toBe(0);
        expect(m.canUndo()).toBe(false);
      }),
    );
  });

  it('undo on a fresh model is a no-op', () => {
    fc.assert(
      fc.property(messageArb, (msg) => {
        const m = createBoardModel(msg);
        m.undo();
        expect(m.message).toBe(msg);
        expect(m.partialWord).toBe('');
        expect(m.canUndo()).toBe(false);
      }),
    );
  });

  it('Property 16: Spelling after a word', () => {
    // **Validates: Requirements 3.4**
    fc.assert(
      fc.property(
        fc.constantFrom(...CORE_VOCABULARY.map((b) => b.label)),
        fc.stringMatching(/^[a-zA-Z]{1,12}$/u),
        (w0, s) => {
          const m = createBoardModel();
          m.dispatch({ type: 'add-word', text: w0 }, false);
          for (const c of s) m.dispatch({ type: 'add-letter', char: c }, true);
          expect(m.message).toBe(w0 + ' ' + s.toLowerCase());
          expect(m.partialWord).toBe(s.toLowerCase());
        },
      ),
    );
  });
});
