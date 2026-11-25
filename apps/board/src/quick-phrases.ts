import {
  QUICK_PHRASES_MAX,
  QUICK_PHRASE_MAX_CHARS,
  readQuickPhrases,
  writeQuickPhrases,
  type StorageLike,
} from './board-storage.js';
import { messages } from './messages.js';

/**
 * The person's editable Quick-phrases list. Pure apart from the injected storage.
 * Order only ever changes through `reorder`.
 */
export interface QuickPhrase {
  readonly id: string;
  readonly text: string;
}

export type AddResult = { readonly added: true } | { readonly added: false; readonly reason: 'full' };

export interface QuickPhrasesStore {
  readonly phrases: readonly QuickPhrase[];
  /** Refuses (list unchanged, nothing written, no notification) at the 100-phrase cap; never evicts a phrase. */
  add(text: string): AddResult;
  update(id: string, text: string): void;
  remove(id: string): void;
  reorder(ids: readonly string[]): void; // only way the order changes
  subscribe(fn: (phrases: readonly QuickPhrase[]) => void): () => void;
}

export interface QuickPhrasesOptions {
  readonly storage?: StorageLike;
  /** Returns a fresh id on each call. Defaults to a counter ("qp-1", "qp-2", ...) that skips ids already in use. */
  readonly newId?: () => string;
}

/**
 * Loads the list from storage. When nothing valid is stored (`usedDefault`), seeds it
 * with `messages.starterQuickPhrases` and saves it. A valid saved list, even an empty
 * one, is never re-seeded. A saved list over the limits is shown cut to 100 phrases of
 * at most 500 characters, but is not written back until the person edits it.
 */
export function createQuickPhrasesStore(options: QuickPhrasesOptions = {}): QuickPhrasesStore {
  const { storage } = options;
  const loaded = readQuickPhrases(storage);
  let phrases: readonly QuickPhrase[] = loaded.value;

  let counter = 0;
  const used = (id: string): boolean => phrases.some((p) => p.id === id);
  const newId =
    options.newId ??
    ((): string => {
      let id: string;
      do {
        counter += 1;
        id = `qp-${counter}`;
      } while (used(id));
      return id;
    });

  const listeners = new Set<(p: readonly QuickPhrase[]) => void>();
  const commit = (next: readonly QuickPhrase[]): void => {
    phrases = next;
    writeQuickPhrases(phrases, storage);
    for (const fn of [...listeners]) fn(phrases);
  };

  if (loaded.usedDefault) {
    phrases = messages.starterQuickPhrases.map((text) => ({ id: newId(), text }));
    writeQuickPhrases(phrases, storage);
  }

  return {
    get phrases() {
      return phrases;
    },
    add(text) {
      if (phrases.length >= QUICK_PHRASES_MAX) return { added: false, reason: 'full' };
      commit([...phrases, { id: newId(), text: text.slice(0, QUICK_PHRASE_MAX_CHARS) }]);
      return { added: true };
    },
    update(id, text) {
      if (!used(id)) return;
      const t = text.slice(0, QUICK_PHRASE_MAX_CHARS);
      commit(phrases.map((p) => (p.id === id ? { id, text: t } : p)));
    },
    remove(id) {
      if (!used(id)) return;
      commit(phrases.filter((p) => p.id !== id));
    },
    reorder(ids) {
      // Only an exact permutation of the current ids is accepted; anything else is a no-op.
      if (ids.length !== phrases.length || new Set(ids).size !== ids.length || !ids.every(used)) return;
      const byId = new Map(phrases.map((p) => [p.id, p]));
      commit(ids.map((id) => byId.get(id) as QuickPhrase));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
