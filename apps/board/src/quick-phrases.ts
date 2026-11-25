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

export interface QuickPhrasesStore {
  readonly phrases: readonly QuickPhrase[];
  add(text: string): void;
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
 * one, is never re-seeded.
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
      const added = { id: newId(), text: text.slice(0, QUICK_PHRASE_MAX_CHARS) };
      // Same eviction as the storage layer: oldest (first) entries go once over the cap.
      commit([...phrases, added].slice(-QUICK_PHRASES_MAX));
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
