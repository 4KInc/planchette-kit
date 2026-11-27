import { describe, expect, it } from 'vitest';
import { createBoardModel, UNDO_LIMIT } from '../src/board-model.js';

describe('board-model: appending', () => {
  it('add-word inserts one space only when needed', () => {
    const m = createBoardModel();
    m.dispatch({ type: 'add-word', text: 'I' }, false);
    expect(m.message).toBe('I');
    m.dispatch({ type: 'add-word', text: 'want' }, false);
    expect(m.message).toBe('I want');
    m.dispatch({ type: 'add-space' }, false);
    m.dispatch({ type: 'add-word', text: 'more' }, false);
    expect(m.message).toBe('I want more');
  });

  it('add-word after trailing punctuation or a newline follows the same rule', () => {
    const m = createBoardModel('Hello,');
    m.dispatch({ type: 'add-word', text: 'you' }, false);
    expect(m.message).toBe('Hello, you');
    const n = createBoardModel('a\n');
    n.dispatch({ type: 'add-word', text: 'b' }, false);
    expect(n.message).toBe('a\nb');
  });

  it('add-space inserts no extra space', () => {
    const m = createBoardModel('go');
    m.dispatch({ type: 'add-space' }, true);
    m.dispatch({ type: 'add-space' }, true);
    expect(m.message).toBe('go  ');
  });
});

describe('board-model: complete-word', () => {
  const letter = (char: string) => ({ type: 'add-letter', char }) as const;

  it('"he" then hello gives "hello"', () => {
    const m = createBoardModel();
    m.dispatch(letter('h'), true);
    m.dispatch(letter('e'), true);
    m.dispatch({ type: 'complete-word', text: 'hello' }, true);
    expect(m.message).toBe('hello');
    expect(m.partialWord).toBe('');
  });

  it('"I want he" then help gives "I want help"; Undo restores "I want he"', () => {
    const m = createBoardModel('I want');
    m.dispatch(letter('h'), true);
    m.dispatch(letter('e'), true);
    expect(m.message).toBe('I want he');
    m.dispatch({ type: 'complete-word', text: 'help' }, true);
    expect(m.message).toBe('I want help');
    expect(m.partialWord).toBe('');
    m.undo();
    expect(m.message).toBe('I want he');
    expect(m.partialWord).toBe('he');
  });

  it('with an empty partial word it equals add-word', () => {
    for (const init of ['', 'I want', 'a\n', 'Hello,']) {
      const a = createBoardModel(init);
      const b = createBoardModel(init);
      a.dispatch({ type: 'complete-word', text: 'more' }, false);
      b.dispatch({ type: 'add-word', text: 'more' }, false);
      expect(a.message).toBe(b.message);
      expect(a.partialWord).toBe('');
    }
  });

  it('empty text is a no-op and pushes nothing', () => {
    const m = createBoardModel();
    m.dispatch(letter('h'), true);
    m.undo();
    m.dispatch(letter('h'), true);
    m.dispatch({ type: 'complete-word', text: '' }, true);
    expect(m.message).toBe('h');
    expect(m.partialWord).toBe('h');
    m.undo();
    expect(m.canUndo()).toBe(false);
  });

  it('is one undoable step', () => {
    const m = createBoardModel();
    m.dispatch(letter('h'), true);
    m.dispatch({ type: 'complete-word', text: 'hello' }, true);
    m.undo();
    expect(m.message).toBe('h');
    expect(m.partialWord).toBe('h');
  });

  it('completes a letter sequence after add-space without a doubled space', () => {
    const m = createBoardModel('I');
    m.dispatch({ type: 'add-space' }, true);
    m.dispatch(letter('w'), true);
    expect(m.message).toBe('I w');
    m.dispatch({ type: 'complete-word', text: 'want' }, true);
    expect(m.message).toBe('I want');
  });
});

describe('board-model: spelling after a word', () => {
  const letter = (char: string) => ({ type: 'add-letter', char }) as const;

  it('starts a spelled word after a word: "I want" + H gives "I want h"', () => {
    const m = createBoardModel('I want');
    m.dispatch(letter('H'), true);
    expect(m.message).toBe('I want h');
    expect(m.partialWord).toBe('h');
  });

  it('continuing a word adds no space', () => {
    const m = createBoardModel('I want');
    m.dispatch(letter('H'), true);
    m.dispatch(letter('E'), true);
    expect(m.message).toBe('I want he');
    expect(m.partialWord).toBe('he');
  });

  it('a letter on an empty message adds no space', () => {
    const m = createBoardModel();
    m.dispatch(letter('A'), true);
    expect(m.message).toBe('a');
  });

  it('a letter after trailing whitespace adds no second space', () => {
    const m = createBoardModel('I want ');
    m.dispatch(letter('H'), true);
    expect(m.message).toBe('I want h');
    const n = createBoardModel('a\n');
    n.dispatch(letter('B'), true);
    expect(n.message).toBe('a\nb');
  });

  it('lower-cases letters in the message and partialWord', () => {
    const m = createBoardModel();
    m.dispatch(letter('A'), true);
    m.dispatch(letter('B'), true);
    expect(m.message).toBe('ab');
    expect(m.partialWord).toBe('ab');
  });

  it('undo of the first letter restores the message and an empty partialWord', () => {
    const m = createBoardModel('I want');
    m.dispatch(letter('H'), true);
    m.undo();
    expect(m.message).toBe('I want');
    expect(m.partialWord).toBe('');
  });

  it('undo of a continuing letter restores the previous message and partialWord', () => {
    const m = createBoardModel('I want');
    m.dispatch(letter('H'), true);
    m.dispatch(letter('E'), true);
    m.undo();
    expect(m.message).toBe('I want h');
    expect(m.partialWord).toBe('h');
  });

  it('spell-mode backspace of the first letter leaves "I want " and the next letter gives "I want k"', () => {
    const m = createBoardModel('I want');
    m.dispatch(letter('H'), true);
    m.dispatch({ type: 'backspace' }, true);
    expect(m.message).toBe('I want ');
    expect(m.partialWord).toBe('');
    m.dispatch(letter('K'), true);
    expect(m.message).toBe('I want k');
    expect(m.partialWord).toBe('k');
  });
});

describe('board-model: backspace', () => {
  it('grid-mode backspace removes the last word', () => {
    const m = createBoardModel('I want more');
    m.dispatch({ type: 'backspace' }, false);
    expect(m.message).toBe('I want');
    m.dispatch({ type: 'backspace' }, false);
    expect(m.message).toBe('I');
    m.dispatch({ type: 'backspace' }, false);
    expect(m.message).toBe('');
  });

  it('grid-mode backspace with a trailing space removes the last word and its spaces', () => {
    const m = createBoardModel('I want ');
    m.dispatch({ type: 'backspace' }, false);
    expect(m.message).toBe('I');
  });

  it('spell-mode backspace removes exactly one character (whole code point)', () => {
    const m = createBoardModel('ab😀');
    m.dispatch({ type: 'backspace' }, true);
    expect(m.message).toBe('ab');
    m.dispatch({ type: 'backspace' }, true);
    expect(m.message).toBe('a');
  });
});

describe('board-model: partialWord', () => {
  it('grows with each letter', () => {
    const m = createBoardModel('hi');
    m.dispatch({ type: 'add-letter', char: 'a' }, true);
    m.dispatch({ type: 'add-letter', char: 'b' }, true);
    expect(m.partialWord).toBe('ab');
  });

  it.each([
    ['add-word', { type: 'add-word', text: 'x' }, false],
    ['add-space', { type: 'add-space' }, true],
    ['clear', { type: 'clear' }, true],
    ['replace', { type: 'replace', text: 'hello' }, true],
    ['grid-mode backspace', { type: 'backspace' }, false],
  ] as const)('resets on %s', (_name, action, spell) => {
    const m = createBoardModel();
    m.dispatch({ type: 'add-letter', char: 'a' }, true);
    m.dispatch({ type: 'add-letter', char: 'b' }, true);
    m.dispatch(action, spell);
    expect(m.partialWord).toBe('');
  });

  it('shrinks by one on spell-mode backspace and stays empty when already empty', () => {
    const m = createBoardModel('hi');
    m.dispatch({ type: 'backspace' }, true);
    expect(m.message).toBe('h');
    expect(m.partialWord).toBe('');
    m.dispatch({ type: 'add-letter', char: 'a' }, true);
    m.dispatch({ type: 'add-letter', char: 'b' }, true);
    m.dispatch({ type: 'backspace' }, true);
    expect(m.partialWord).toBe('a');
  });

  it('undo restores partialWord together with the message', () => {
    const m = createBoardModel();
    m.dispatch({ type: 'add-letter', char: 'a' }, true);
    m.dispatch({ type: 'add-letter', char: 'b' }, true);
    m.dispatch({ type: 'add-space' }, true);
    expect(m.partialWord).toBe('');
    m.undo();
    expect(m.message).toBe('ab');
    expect(m.partialWord).toBe('ab');
    m.undo();
    expect(m.partialWord).toBe('a');
  });
});

describe('board-model: no-ops and undo', () => {
  it('backspace and clear on an empty message push nothing', () => {
    const m = createBoardModel();
    m.dispatch({ type: 'backspace' }, false);
    m.dispatch({ type: 'backspace' }, true);
    m.dispatch({ type: 'clear' }, false);
    expect(m.message).toBe('');
    expect(m.canUndo()).toBe(false);
  });

  it('no-ops do not notify subscribers', () => {
    const m = createBoardModel();
    let calls = 0;
    m.subscribe(() => calls++);
    m.dispatch({ type: 'clear' }, false);
    m.undo();
    expect(calls).toBe(0);
  });

  it('replace replaces the whole message and is undoable', () => {
    const m = createBoardModel('old text');
    m.dispatch({ type: 'replace', text: 'I need water' }, false);
    expect(m.message).toBe('I need water');
    m.undo();
    expect(m.message).toBe('old text');
  });

  it('clear is undoable, and successive undos walk back one action at a time', () => {
    const m = createBoardModel();
    m.dispatch({ type: 'add-word', text: 'a' }, false);
    m.dispatch({ type: 'add-word', text: 'b' }, false);
    m.dispatch({ type: 'clear' }, false);
    m.undo();
    expect(m.message).toBe('a b');
    m.undo();
    expect(m.message).toBe('a');
    m.undo();
    expect(m.message).toBe('');
    expect(m.canUndo()).toBe(false);
  });

  it('undo does not push onto the stack', () => {
    const m = createBoardModel();
    m.dispatch({ type: 'add-word', text: 'a' }, false);
    m.undo();
    m.undo();
    expect(m.message).toBe('');
  });

  it('caps the undo stack at 50, dropping the oldest', () => {
    const m = createBoardModel();
    for (let i = 0; i < UNDO_LIMIT + 10; i++) m.dispatch({ type: 'add-letter', char: 'x' }, true);
    let undone = 0;
    while (m.canUndo()) {
      m.undo();
      undone++;
    }
    expect(undone).toBe(UNDO_LIMIT);
    expect(m.message).toBe('x'.repeat(10));
  });

  it('subscribe notifies with the message on dispatch and undo; unsubscribe stops it', () => {
    const m = createBoardModel();
    const seen: string[] = [];
    const off = m.subscribe((s) => seen.push(s));
    m.dispatch({ type: 'add-word', text: 'hi' }, false);
    m.undo();
    off();
    m.dispatch({ type: 'add-word', text: 'again' }, false);
    expect(seen).toEqual(['hi', '']);
  });
});
