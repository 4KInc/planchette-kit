// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Rect, TargetOptions } from '@planchette/skeleton';
import { mountBoardDom, type BoardDomApp, type BoardHost } from '../src/board-dom';
import { createBoardApp } from '../src/main';
import type { StorageLike } from '../src/board-storage';

const html = readFileSync(resolve(import.meta.dirname, '../../../board/index.html'), 'utf8');

class FakeHost extends EventTarget {
  registered = new Map<string, Rect>();
  registerTarget(id: string, rect: Rect, _o?: TargetOptions): void {
    this.registered.set(id, rect);
  }
  updateTarget(id: string, rect: Rect): void {
    if (this.registered.has(id)) this.registered.set(id, rect);
  }
  unregisterTarget(id: string): void {
    this.registered.delete(id);
  }
  getProfile() {
    return { targetSize: 96, targetSpacing: 16 };
  }
  setScreen(): void {}
  emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
  select(targetId: string): void {
    this.emit('select', { targetId, now: 0, source: 'mouse', role: 'default' });
  }
}

const memory = (): StorageLike => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

// Slot i is a 100x96 box at x = i * 200, so a pointer position maps to one slot.
const slotRect = (i: number): DOMRect => new DOMRect(i * 200, 0, 100, 96);

function setup() {
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
  const proto = HTMLElement.prototype as { getBoundingClientRect: () => DOMRect };
  proto.getBoundingClientRect = function (this: HTMLElement) {
    const m = /^prediction-slot-(\d+)$/.exec(this.dataset.planchetteTarget ?? '');
    return m ? slotRect(Number(m[1])) : new DOMRect(5000, 0, 96, 96);
  };
  const app = createBoardApp({
    speak: async () => ({ spoken: true }),
    now: () => 0,
    storage: memory(),
    wordList: { words: new Map([['alpha', 1], ['bravo', 0.5], ['charlie', 0.33], ['delta', 0.25], ['echo', 0.2], ['hotel', 0.1], ['house', 0.05]]) },
    excluded: new Set(),
  });
  const host = new FakeHost();
  mountBoardDom({ host: host as unknown as BoardHost, app: app as unknown as BoardDomApp, document });
  const words = () => app.strip.slots.map((s) => s.word);
  return { app, host, words };
}

describe('board-dom prediction strip', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders fixed slots and registers only those with a word', () => {
    const { app, host, words } = setup();
    const slots = document.querySelectorAll('#prediction-strip > .prediction-slot');
    expect(slots.length).toBe(app.strip.slots.length);
    expect(words().filter((w) => w !== null).length).toBeGreaterThan(0);
    for (const s of app.strip.slots) {
      expect(host.registered.has(`prediction-slot-${s.index}`)).toBe(s.word !== null);
      expect(slots[s.index]!.textContent).toBe(s.word ?? '');
    }
  });

  it('unregisters a slot that becomes empty, keeping the button in place', () => {
    const { app, host } = setup();
    app.model.dispatch({ type: 'add-letter', char: 'h' }, true);
    app.model.dispatch({ type: 'add-letter', char: 'o' }, true); // hotel, house only
    const slots = document.querySelectorAll('#prediction-strip > .prediction-slot');
    expect(slots.length).toBe(app.strip.slots.length);
    expect(host.registered.has('prediction-slot-0')).toBe(true);
    expect(host.registered.has('prediction-slot-2')).toBe(false);
    expect(slots[2]!.textContent).toBe('');
  });

  it('keeps the word of a slot under the pointer and updates the others', () => {
    const { app, host, words } = setup();
    const before = words();
    host.emit('pointer-move', { x: 0 * 200 + 10, y: 10 }); // on slot 0
    app.model.dispatch({ type: 'add-letter', char: 'h' }, true);
    const after = words();
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe('hotel');
    expect(after[2]).toBe('house');
  });

  it('keeps a highlighted slot, and releases it when the highlight moves', () => {
    const { app, host, words } = setup();
    const before = words();
    host.emit('highlight', { kind: 'item', targetId: 'prediction-slot-1', targetIds: ['prediction-slot-1'] });
    app.model.dispatch({ type: 'add-letter', char: 'h' }, true);
    expect(words()[1]).toBe(before[1]);
    host.emit('highlight', { kind: 'none', targetId: '', targetIds: [] });
    app.model.dispatch({ type: 'add-letter', char: 'e' }, true);
    expect(words()[1]).not.toBe(before[1]);
  });

  it('with no lock, every slot updates', () => {
    const { app, words } = setup();
    app.model.dispatch({ type: 'add-letter', char: 'h' }, true);
    expect(words().slice(0, 2)).toEqual(['hotel', 'house']);
  });

  it('selecting a slot dispatches complete-word with that slot\'s word', () => {
    const { app, host, words } = setup();
    const w = words()[1]!;
    host.select('prediction-slot-1');
    expect(app.model.message).toBe(w);
    expect(app.model.partialWord).toBe('');
  });

  it('selecting a slot while spelling replaces the partial word, and Undo brings it back', () => {
    const { app, host, words } = setup();
    app.model.dispatch({ type: 'add-letter', char: 'h' }, true);
    app.model.dispatch({ type: 'add-letter', char: 'o' }, true);
    const w = words()[0]!;
    host.select('prediction-slot-0');
    expect(app.model.message).toBe(w);
    expect(app.model.partialWord).toBe('');
    app.model.undo();
    expect(app.model.message).toBe('ho');
    expect(app.model.partialWord).toBe('ho');
  });

  it('holds all slots still through a press, then catches up on the next frame', async () => {
    const { app, host, words } = setup();
    app.model.dispatch({ type: 'add-letter', char: 'h' }, true);
    const before = words(); // hotel, house, null, null
    host.select('prediction-slot-0'); // the Partial word resets inside the press; no slot may move
    expect(app.model.partialWord).toBe('');
    expect(words()).toEqual(before);
    await new Promise((r) => setTimeout(r, 50));
    expect(words()[0]).toBe('alpha');
  });
});
