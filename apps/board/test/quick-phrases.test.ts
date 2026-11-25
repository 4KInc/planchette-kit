import { describe, expect, it, vi } from 'vitest';
import { createBoardModel } from '../src/board-model.js';
import { KEY_QUICK_PHRASES, writeQuickPhrases, type StorageLike } from '../src/board-storage.js';
import { messages } from '../src/messages.js';
import { createQuickPhrasesStore } from '../src/quick-phrases.js';

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

function counterIds(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

function seeded() {
  const storage = memoryStorage();
  const store = createQuickPhrasesStore({ storage, newId: counterIds() });
  return { storage, store };
}

describe('QuickPhrasesStore', () => {
  it('seeds the six starter phrases in order on first run and saves them', () => {
    const { storage, store } = seeded();
    expect(store.phrases.map((p) => p.text)).toEqual([
      'Yes', 'No', 'Thank you', 'I need help', 'Please wait', 'I want to rest',
    ]);
    expect(store.phrases.map((p) => p.text)).toEqual([...messages.starterQuickPhrases]);
    expect(storage.data.has(KEY_QUICK_PHRASES)).toBe(true);
  });

  it('does not re-seed on a second load, keeping ids and an emptied list', () => {
    const { storage, store } = seeded();
    const first = store.phrases;
    expect(createQuickPhrasesStore({ storage }).phrases).toEqual(first);
    first.forEach((p) => store.remove(p.id));
    expect(createQuickPhrasesStore({ storage }).phrases).toEqual([]);
  });

  it('seeds again when stored data is corrupt', () => {
    const storage = memoryStorage();
    storage.setItem(KEY_QUICK_PHRASES, '{not json');
    expect(createQuickPhrasesStore({ storage }).phrases).toHaveLength(6);
  });

  it('add appends one entry and leaves the others unchanged', () => {
    const { store } = seeded();
    const before = store.phrases;
    store.add('Good morning');
    expect(store.phrases.slice(0, -1)).toEqual(before);
    expect(store.phrases.at(-1)?.text).toBe('Good morning');
  });

  it('update changes only the targeted entry', () => {
    const { store } = seeded();
    const before = store.phrases;
    store.update(before[2]!.id, 'Thanks a lot');
    expect(store.phrases[2]).toEqual({ id: before[2]!.id, text: 'Thanks a lot' });
    expect(store.phrases.filter((_, i) => i !== 2)).toEqual(before.filter((_, i) => i !== 2));
  });

  it('remove drops only the targeted entry', () => {
    const { store } = seeded();
    const before = store.phrases;
    store.remove(before[1]!.id);
    expect(store.phrases).toEqual(before.filter((_, i) => i !== 1));
  });

  it('reorder changes only the order, not the content', () => {
    const { store } = seeded();
    const before = store.phrases;
    store.reorder([...before].reverse().map((p) => p.id));
    expect(store.phrases).toEqual([...before].reverse());
  });

  it('persists changes so a reload sees them', () => {
    const { storage, store } = seeded();
    store.add('Hello');
    expect(createQuickPhrasesStore({ storage }).phrases).toEqual(store.phrases);
  });

  it('treats a missing id and an invalid permutation as no-ops without notifying', () => {
    const { store } = seeded();
    const before = store.phrases;
    const fn = vi.fn();
    store.subscribe(fn);
    store.update('nope', 'x');
    store.remove('nope');
    store.reorder(before.slice(1).map((p) => p.id));
    store.reorder([...before.slice(1).map((p) => p.id), before[1]!.id]);
    expect(store.phrases).toEqual(before);
    expect(fn).not.toHaveBeenCalled();
  });

  it('notifies subscribers on change, and not after unsubscribe', () => {
    const { store } = seeded();
    const fn = vi.fn();
    const off = store.subscribe(fn);
    store.add('A');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith(store.phrases);
    off();
    store.add('B');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('truncates added text to 500 chars', () => {
    const { store } = seeded();
    store.add('x'.repeat(600));
    expect(store.phrases.at(-1)!.text).toHaveLength(500);
  });
  it('refuses add at 100 phrases without changing, writing or notifying; add works again after remove', () => {
    const storage = memoryStorage();
    writeQuickPhrases(Array.from({ length: 100 }, (_, i) => ({ id: `s${i}`, text: `p${i}` })), storage);
    const store = createQuickPhrasesStore({ storage, newId: counterIds() });
    const before = store.phrases;
    const stored = storage.data.get(KEY_QUICK_PHRASES);
    const fn = vi.fn();
    store.subscribe(fn);
    const setItem = vi.spyOn(storage, 'setItem');
    expect(store.add('one too many')).toEqual({ added: false, reason: 'full' });
    expect(store.phrases).toEqual(before);
    expect(store.phrases).toHaveLength(100);
    expect(storage.data.get(KEY_QUICK_PHRASES)).toBe(stored);
    expect(setItem).not.toHaveBeenCalled();
    expect(fn).not.toHaveBeenCalled();
    store.remove('s0');
    expect(store.add('fits now')).toEqual({ added: true });
    expect(store.phrases).toHaveLength(100);
    expect(store.phrases.at(-1)!.text).toBe('fits now');
  });
  it('shows 100 of a loaded 150-phrase list and leaves the stored value until an edit', () => {
    const storage = memoryStorage();
    const many = Array.from({ length: 150 }, (_, i) => ({ id: `s${i}`, text: `p${i}` }));
    const raw = JSON.stringify({ version: 1, phrases: many });
    storage.data.set(KEY_QUICK_PHRASES, raw);
    const store = createQuickPhrasesStore({ storage, newId: counterIds() });
    expect(store.phrases).toEqual(many.slice(0, 100));
    expect(storage.data.get(KEY_QUICK_PHRASES)).toBe(raw);
    store.remove('s0');
    expect(JSON.parse(storage.data.get(KEY_QUICK_PHRASES)!).phrases).toHaveLength(99);
  });
  it('generated default ids skip ids already stored', () => {
    const storage = memoryStorage();
    writeQuickPhrases([{ id: 'qp-1', text: 'a' }], storage);
    const store = createQuickPhrasesStore({ storage });
    store.add('b');
    expect(new Set(store.phrases.map((p) => p.id)).size).toBe(2);
  });

  it('selecting a quick phrase via the board model calls no store mutator', () => {
    const { store } = seeded();
    const spies = (['add', 'update', 'remove', 'reorder'] as const).map((m) => vi.spyOn(store, m));
    const model = createBoardModel();
    model.dispatch({ type: 'replace', text: store.phrases[3]!.text }, false);
    expect(model.message).toBe('I need help');
    model.undo();
    spies.forEach((s) => expect(s).not.toHaveBeenCalled());
  });
});
