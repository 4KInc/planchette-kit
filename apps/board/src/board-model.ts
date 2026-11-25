/**
 * The Message model: the message string, the Spell-mode partial word, and a bounded
 * undo stack. Pure: no DOM, no clock, no storage.
 */

export type BoardAction =
  | { type: 'add-word'; text: string }
  | { type: 'add-letter'; char: string }
  | { type: 'add-space' }
  | { type: 'backspace' } // word in grid mode, character in spell mode
  | { type: 'clear' }
  | { type: 'replace'; text: string }; // quick phrase

export interface BoardModel {
  readonly message: string;
  /** Letters added in Spell mode since the last word/space/clear/replace; '' when none. */
  readonly partialWord: string;
  dispatch(action: BoardAction, spellMode: boolean): void;
  undo(): void;
  canUndo(): boolean;
  subscribe(fn: (message: string) => void): () => void;
}

/** Maximum number of undo snapshots kept; the oldest is dropped beyond this. */
export const UNDO_LIMIT = 50;

interface Snapshot {
  readonly message: string;
  readonly partialWord: string;
}

/** Remove the last code point (so surrogate pairs are never split). */
function dropLastChar(text: string): string {
  const chars = Array.from(text);
  chars.pop();
  return chars.join('');
}

/** Remove the last word and the whitespace around it (trailing and preceding). */
function dropLastWord(text: string): string {
  return text.replace(/\s*\S+\s*$/u, '').replace(/\s+$/u, '');
}

export function createBoardModel(initial = ''): BoardModel {
  let message = initial;
  let partialWord = '';
  const undoStack: Snapshot[] = [];
  const listeners = new Set<(message: string) => void>();

  const notify = (): void => {
    for (const fn of [...listeners]) fn(message);
  };

  const apply = (nextMessage: string, nextPartial: string): void => {
    undoStack.push({ message, partialWord });
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    message = nextMessage;
    partialWord = nextPartial;
    notify();
  };

  return {
    get message() {
      return message;
    },
    get partialWord() {
      return partialWord;
    },
    dispatch(action, spellMode) {
      switch (action.type) {
        case 'add-word': {
          if (action.text === '') return; // nothing to append: no-op
          const sep = message !== '' && !/\s$/u.test(message) ? ' ' : '';
          apply(message + sep + action.text, '');
          return;
        }
        case 'add-letter':
          if (action.char === '') return; // nothing to append: no-op
          apply(message + action.char, partialWord + action.char);
          return;
        case 'add-space':
          apply(message + ' ', '');
          return;
        case 'backspace':
          if (message === '') return; // no-op, pushes nothing
          if (spellMode) {
            apply(dropLastChar(message), dropLastChar(partialWord));
          } else {
            apply(dropLastWord(message), '');
          }
          return;
        case 'clear':
          if (message === '') return; // no-op, pushes nothing
          apply('', '');
          return;
        case 'replace':
          apply(action.text, '');
          return;
      }
    },
    undo() {
      const snap = undoStack.pop();
      if (snap === undefined) return;
      message = snap.message;
      partialWord = snap.partialWord;
      notify();
    },
    canUndo() {
      return undoStack.length > 0;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
