// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeHost } from './board-dom-helpers';
import { mountBoardDom, type BoardDomApp, type BoardHost } from '../src/board-dom';
import { createBoardApp } from '../src/main';
import { createQuickPhrasesStore } from '../src/quick-phrases';
import type { StorageLike } from '../src/board-storage';

const html = readFileSync(resolve(import.meta.dirname, '../../../board/index.html'), 'utf8');

const memory = (): StorageLike => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

/** A host that also counts registrations, to show what is (not) re-registered. */
class SpyHost extends FakeHost {
  calls: string[] = [];
  override registerTarget(id: string, rect: Parameters<FakeHost['registerTarget']>[1], o?: Parameters<FakeHost['registerTarget']>[2]): void {
    this.calls.push(`+${id}`);
    super.registerTarget(id, rect, o);
  }
  override unregisterTarget(id: string): void {
    this.calls.push(`-${id}`);
    super.unregisterTarget(id);
  }
}

function setup(phraseTexts?: string[]) {
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
  const storage = memory();
  const quickPhrases = createQuickPhrasesStore({ storage });
  if (phraseTexts !== undefined) {
    for (const p of [...quickPhrases.phrases]) quickPhrases.remove(p.id);
    for (const t of phraseTexts) quickPhrases.add(t);
  }
  const app = createBoardApp({
    speak: async () => ({ spoken: true }),
    now: () => 0,
    storage,
    quickPhrases,
    wordList: { words: new Map([['alpha', 1], ['bravo', 0.5]]) },
    excluded: new Set(),
  });
  const host = new SpyHost();
  mountBoardDom({ host: host as unknown as BoardHost, app: app as unknown as BoardDomApp, document });
  host.calls = [];
  const ids = (prefix: string) => [...host.registered.keys()].filter((id) => id.startsWith(prefix));
  const gridIds = () =>
    [...host.registered.keys()].filter((id) => /^(core-|letter-|quick-phrase-|phrases-prev|phrases-next|space$|backspace$)/.test(id));
  const pressed = (id: string) => document.querySelector(`[data-planchette-target="${id}"]`)!.getAttribute('aria-pressed');
  const phraseIds = () => quickPhrases.phrases.map((p) => `quick-phrase-${p.id}`);
  return { app, host, quickPhrases, ids, gridIds, pressed, phraseIds };
}

const texts = (n: number) => Array.from({ length: n }, (_, i) => `Phrase number ${i}`);

describe('board-dom Phrases view', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('style');
    HTMLElement.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 96, 96);
  });

  it('registers the first page plus Next and unregisters Core; toggling back reverses it', () => {
    const { host, ids, gridIds, phraseIds } = setup(texts(12));
    expect(ids('core-')).toHaveLength(36);
    host.select('phrases-toggle');
    expect(ids('core-')).toHaveLength(0);
    expect(gridIds().sort()).toEqual([...phraseIds().slice(0, 10), 'phrases-next'].sort());
    host.select('phrases-toggle');
    expect(gridIds().every((id) => id.startsWith('core-'))).toBe(true);
    expect(ids('core-')).toHaveLength(36);
  });

  it('keeps exactly one grid registered in all six transitions', () => {
    const { host, gridIds } = setup(texts(3));
    const kinds = () => new Set(gridIds().map((id) => (id.startsWith('core-') ? 'core' : id.startsWith('quick-phrase-') || id.startsWith('phrases-') ? 'phrases' : 'spell')));
    const steps: Array<[string, string]> = [
      ['spell-toggle', 'spell'], // core -> spell
      ['spell-toggle', 'core'], // spell -> core
      ['phrases-toggle', 'phrases'], // core -> phrases
      ['phrases-toggle', 'core'], // phrases -> core
      ['phrases-toggle', 'phrases'],
      ['spell-toggle', 'spell'], // phrases -> spell
      ['phrases-toggle', 'phrases'], // spell -> phrases
    ];
    for (const [toggle, expected] of steps) {
      host.select(toggle);
      expect([...kinds()], `after ${toggle}`).toEqual([expected]);
    }
  });

  it('keeps aria-pressed on both toggles in step with the view (mutually exclusive)', () => {
    const { host, pressed } = setup(texts(3));
    expect([pressed('spell-toggle'), pressed('phrases-toggle')]).toEqual(['false', 'false']);
    host.select('spell-toggle');
    expect([pressed('spell-toggle'), pressed('phrases-toggle')]).toEqual(['true', 'false']);
    host.select('phrases-toggle');
    expect([pressed('spell-toggle'), pressed('phrases-toggle')]).toEqual(['false', 'true']);
    host.select('spell-toggle');
    expect([pressed('spell-toggle'), pressed('phrases-toggle')]).toEqual(['true', 'false']);
    host.select('spell-toggle');
    expect([pressed('spell-toggle'), pressed('phrases-toggle')]).toEqual(['false', 'false']);
  });

  it('places cells row-major at row floor(i/2), column i%2, and Previous/Next at row 5', () => {
    const { host } = setup(texts(25));
    host.select('phrases-toggle');
    const cells = [...document.querySelectorAll<HTMLElement>('#phrases-grid > button')];
    expect(cells).toHaveLength(12);
    cells.slice(0, 10).forEach((el, i) => {
      expect([el.dataset.row, el.dataset.col]).toEqual([String(Math.floor(i / 2)), String(i % 2)]);
      expect(el.textContent).toBe(`Phrase number ${i}`);
    });
    const prev = document.querySelector<HTMLElement>('[data-planchette-target="phrases-prev"]')!;
    const next = document.querySelector<HTMLElement>('[data-planchette-target="phrases-next"]')!;
    expect([prev.dataset.row, prev.dataset.col, prev.textContent]).toEqual(['5', '0', 'Previous']);
    expect([next.dataset.row, next.dataset.col, next.textContent]).toEqual(['5', '1', 'Next']);
  });

  it('pages 25 phrases into 3 pages with placeholders in place, and re-entry shows page 0', () => {
    const { host, ids, phraseIds } = setup(texts(25));
    const live = document.getElementById('phrases-page')!;
    const cellPositions = () => [...document.querySelectorAll<HTMLElement>('#phrases-grid > button')].map((e) => `${e.dataset.row},${e.dataset.col}`);
    const before = cellPositions();
    host.select('phrases-toggle');
    expect(live.textContent).toBe('Page 1 of 3');
    expect(ids('phrases-prev')).toEqual([]);
    expect(ids('phrases-next')).toEqual(['phrases-next']);
    const prev = document.querySelector('[data-planchette-target="phrases-prev"]')!;
    expect(prev.getAttribute('aria-disabled')).toBe('true');
    host.select('phrases-next');
    expect(live.textContent).toBe('Page 2 of 3');
    expect(ids('quick-phrase-').sort()).toEqual(phraseIds().slice(10, 20).sort());
    host.select('phrases-next');
    expect(live.textContent).toBe('Page 3 of 3');
    expect(ids('quick-phrase-').sort()).toEqual(phraseIds().slice(20).sort());
    expect(ids('phrases-next')).toEqual([]);
    expect(ids('phrases-prev')).toEqual(['phrases-prev']);
    const next = document.querySelector('[data-planchette-target="phrases-next"]')!;
    expect(next.getAttribute('aria-disabled')).toBe('true');
    const empties = document.querySelectorAll('#phrases-grid > [data-empty="true"]');
    expect(empties).toHaveLength(5);
    expect(cellPositions()).toEqual(before);
    host.select('phrases-next'); // no page to go to
    expect(live.textContent).toBe('Page 3 of 3');
    host.select('phrases-toggle');
    host.select('phrases-toggle');
    expect(live.textContent).toBe('Page 1 of 3');
    expect(ids('quick-phrase-').sort()).toEqual(phraseIds().slice(0, 10).sort());
  });

  it('selecting a phrase replaces the Message with its full text, once, and stays in the view', () => {
    const long = 'x'.repeat(200);
    const { app, host, ids, quickPhrases } = setup(['Hello there', long]);
    app.model.dispatch({ type: 'add-word', text: 'before' }, false);
    host.select('phrases-toggle');
    const longId = `quick-phrase-${quickPhrases.phrases[1]!.id}`;
    const el = document.querySelector<HTMLElement>(`[data-planchette-target="${longId}"]`)!;
    expect(el.textContent).toBe(long); // the full phrase is the accessible name
    host.select(longId);
    expect(app.model.message).toBe(long);
    expect(ids('quick-phrase-')).toHaveLength(2);
    expect(document.getElementById('phrases-page')!.textContent).toBe('Page 1 of 1');
    app.model.undo();
    expect(app.model.message).toBe('before');
  });

  it('shows the last page when an edit removes the shown page', () => {
    const { host, ids, quickPhrases } = setup(texts(25));
    host.select('phrases-toggle');
    host.select('phrases-next');
    host.select('phrases-next');
    for (const p of quickPhrases.phrases.slice(12)) quickPhrases.remove(p.id); // 12 left: 2 pages
    expect(document.getElementById('phrases-page')!.textContent).toBe('Page 2 of 2');
    expect(ids('quick-phrase-')).toHaveLength(2);
  });

  it('does not re-register phrase targets on message, prediction, Speak or Core/Letter changes', async () => {
    const { app, host, quickPhrases } = setup(texts(4));
    host.select('phrases-toggle');
    host.calls = [];
    app.model.dispatch({ type: 'add-word', text: 'alpha' }, false);
    app.model.dispatch({ type: 'add-letter', char: 'a' }, true);
    host.select('core-I'); // not registered in this view; ignored
    host.select('clear');
    await app.speakMessage();
    host.select('undo');
    const phraseCalls = host.calls.filter((c) => /quick-phrase-|phrases-/.test(c));
    expect(phraseCalls).toEqual([]);
    quickPhrases.add('Another');
    expect(host.calls.filter((c) => c.startsWith('+quick-phrase-')).length).toBe(5);
    host.calls = [];
    quickPhrases.reorder([...quickPhrases.phrases].reverse().map((p) => p.id));
    expect(host.calls.some((c) => c.startsWith('+quick-phrase-'))).toBe(true);
    host.calls = [];
    quickPhrases.remove(quickPhrases.phrases[0]!.id);
    expect(host.calls.some((c) => c.startsWith('+quick-phrase-'))).toBe(true);
  });

  it('registers no phrase targets in Core and does not render for store edits there', () => {
    const { host, quickPhrases, ids } = setup(texts(2));
    host.calls = [];
    quickPhrases.add('More');
    expect(host.calls).toEqual([]);
    expect(ids('quick-phrase-')).toEqual([]);
  });

  it('Spell mode still dispatches with the spell flag; Phrases view does not', () => {
    const { app, host } = setup(texts(2));
    host.select('spell-toggle');
    host.select('letter-h');
    expect(app.model.partialWord).toBe('h');
    host.select('phrases-toggle');
    host.select('backspace-action');
    expect(app.model.message).toBe('');
  });
});
