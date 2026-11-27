// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountBoardDom, type BoardDomApp, type BoardHost } from '../src/board-dom';
import { CORE_VOCABULARY } from '../src/core-vocabulary';
import { LETTER_BOARD } from '../src/letter-board';
import { createQuickPhrasesStore } from '../src/quick-phrases';
import { FakeHost, stubRectWith } from './board-dom-helpers';

const html = readFileSync(resolve(import.meta.dirname, '../../../board/index.html'), 'utf8');

type Op =
  | { kind: 'select'; id: string }
  | { kind: 'toggle' }
  | { kind: 'phrases-toggle' }
  | { kind: 'page'; dir: 'phrases-prev' | 'phrases-next' }
  | { kind: 'phrase'; index: number }
  | { kind: 'settings'; targetSize: number; targetSpacing: number }
  | { kind: 'resize'; width: number; height: number }
  | { kind: 'mode-change' };

// Board actions: core-word selects, letter selects, Space, Backspace (grid and action row),
// Clear, Undo, Speak.
const ACTION_SELECTS = [
  ...CORE_VOCABULARY.map((b) => `core-${b.id}`),
  ...LETTER_BOARD.map((k) => k.id),
  'backspace-action',
  'clear',
  'undo',
  'speak',
];

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 5, arbitrary: fc.constantFrom(...ACTION_SELECTS).map((id): Op => ({ kind: 'select', id })) },
  { weight: 3, arbitrary: fc.constant<Op>({ kind: 'toggle' }) },
  { weight: 3, arbitrary: fc.constant<Op>({ kind: 'phrases-toggle' }) },
  { weight: 3, arbitrary: fc.constantFrom('phrases-prev', 'phrases-next').map((dir): Op => ({ kind: 'page', dir })) },
  { weight: 2, arbitrary: fc.nat(99).map((index): Op => ({ kind: 'phrase', index })) },
  {
    weight: 2,
    // The skeleton's valid ranges: targetSize 64..400, targetSpacing 8..64.
    arbitrary: fc.record({
      kind: fc.constant('settings' as const),
      targetSize: fc.integer({ min: 64, max: 400 }),
      targetSpacing: fc.integer({ min: 8, max: 64 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('resize' as const),
      width: fc.integer({ min: 320, max: 3840 }),
      height: fc.integer({ min: 240, max: 2160 }),
    }),
  },
  { weight: 1, arbitrary: fc.constant<Op>({ kind: 'mode-change' }) },
);

type View = 'core' | 'spell' | 'phrases';

// `end` is the view shown both before and after the sequence. Constructing it as its own
// value (rather than filtering) makes all three cases occur in equal shares. The list is
// loaded once, with 0..100 phrases, and is never edited during the sequence.
const scenarioArb = fc.record({
  end: fc.constantFrom<View>('core', 'spell', 'phrases'),
  phrases: fc.array(fc.string({ minLength: 1, maxLength: 60 }), { maxLength: 100 }),
  ops: fc.array(opArb, { maxLength: 40 }),
});

interface Entry {
  row: string | undefined;
  col: string | undefined;
  label: string;
}

describe('Feature: board, Property 1: Fixed-grid position stability', () => {
  const original = HTMLElement.prototype.getBoundingClientRect;
  let host: FakeHost;
  beforeEach(() => {
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      return stubRectWith(this, host.profile.targetSize, host.profile.targetSpacing);
    };
  });
  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = original;
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('style');
  });

  /** Mounts a fresh Board DOM with the given (unedited) Quick-phrases list. */
  function mount(phraseTexts: readonly string[]) {
    document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
    document.documentElement.removeAttribute('style');
    host = new FakeHost();
    const data = new Map<string, string>();
    const quickPhrases = createQuickPhrasesStore({ storage: { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) } });
    for (const p of [...quickPhrases.phrases]) quickPhrases.remove(p.id);
    for (const t of phraseTexts) quickPhrases.add(t);
    const model = {
      message: '',
      dispatch: () => {},
      undo: () => {},
      subscribe: () => () => {},
    };
    const app = { model, speakMessage: async () => ({ spoken: true }), quickPhrases };
    const dom = mountBoardDom({ host: host as unknown as BoardHost, app: app as unknown as BoardDomApp, document });
    const pressed = (id: string) => document.querySelector(`[data-planchette-target="${id}"]`)!.getAttribute('aria-pressed') === 'true';
    const viewOf = (): View => (pressed('spell-toggle') ? 'spell' : pressed('phrases-toggle') ? 'phrases' : 'core');
    const page = () => Number(/(\d+)/.exec(document.getElementById('phrases-page')!.textContent ?? '')?.[1] ?? 0);
    return { dom, quickPhrases, viewOf, page };
  }

  /** What the host holds for these ids: id → (row, col, label), and ids in on-screen order. */
  function record(ids: readonly string[]): { entries: Map<string, Entry>; order: string[] } {
    const entries = new Map<string, Entry>();
    for (const id of ids) {
      const t = host.registered.get(id);
      if (t !== undefined) entries.set(id, { row: t.row, col: t.col, label: t.label });
    }
    const order = [...entries.keys()].sort((a, b) => {
      const ra = host.registered.get(a)!.rect;
      const rb = host.registered.get(b)!.rect;
      return ra.y - rb.y || ra.x - rb.x;
    });
    return { entries, order };
  }

  const coreIds = CORE_VOCABULARY.map((b) => `core-${b.id}`);
  const letterIds = LETTER_BOARD.map((k) => k.id);
  const isPhraseId = (id: string) => id.startsWith('quick-phrase-') || id === 'phrases-prev' || id === 'phrases-next';
  /** Registered grid targets (not the action row), grouped by the view they belong to. */
  const registeredViews = (): Set<View> => {
    const kinds = new Set<View>();
    for (const id of host.registered.keys()) {
      if (id.startsWith('core-')) kinds.add('core');
      else if (letterIds.includes(id)) kinds.add('spell');
      else if (isPhraseId(id)) kinds.add('phrases');
    }
    return kinds;
  };
  const phraseRegistry = () => record([...host.registered.keys()].filter(isPhraseId));

  it('keeps (row, col, label) and relative order of the active grid across any sequence', () => {
    const shares: Record<View, number> = { core: 0, spell: 0, phrases: 0 };
    fc.assert(
      fc.property(scenarioArb, ({ end, phrases, ops }) => {
        const { dom, quickPhrases, viewOf, page } = mount(phrases);
        const list = quickPhrases.phrases;
        let expected: View = 'core';
        const toggle = (kind: 'spell' | 'phrases') => {
          host.select(`${kind}-toggle`);
          expected = expected === kind ? 'core' : kind;
        };
        const checkOneView = () => {
          expect(viewOf()).toBe(expected);
          const kinds = registeredViews();
          if (expected === 'phrases') expect([...kinds].every((k) => k === 'phrases')).toBe(true);
          else expect([...kinds]).toEqual([expected]);
        };
        const goTo = (view: View) => {
          if (expected !== view) toggle(view === 'core' ? (expected as 'spell' | 'phrases') : view);
          checkOneView();
        };

        goTo(end);
        const ids = end === 'spell' ? letterIds : coreIds;
        const before = end === 'phrases' ? phraseRegistry() : record(ids);
        if (end === 'phrases') expect(page()).toBe(1);
        else expect(before.entries.size).toBe(ids.length);

        for (const op of ops) {
          switch (op.kind) {
            case 'select':
              host.select(op.id);
              break;
            case 'toggle':
              toggle('spell');
              break;
            case 'phrases-toggle':
              toggle('phrases');
              break;
            case 'page':
              host.select(op.dir);
              break;
            case 'phrase':
              if (list.length > 0) host.select(`quick-phrase-${list[op.index % list.length]!.id}`);
              break;
            case 'settings':
              host.profile = { targetSize: op.targetSize, targetSpacing: op.targetSpacing };
              dom.syncTargets();
              break;
            case 'resize':
              Object.defineProperty(window, 'innerWidth', { value: op.width, configurable: true });
              Object.defineProperty(window, 'innerHeight', { value: op.height, configurable: true });
              window.dispatchEvent(new Event('resize'));
              break;
            case 'mode-change':
              host.dispatchEvent(new CustomEvent('mode-change'));
              break;
          }
          checkOneView();
          if (viewOf() === 'phrases') {
            // A phrase target's place depends on its list index only; Previous / Next sit at row 5.
            const shown = page() - 1;
            for (const [id, e] of phraseRegistry().entries) {
              if (id === 'phrases-prev') expect([e.row, e.col]).toEqual(['5', '0']);
              else if (id === 'phrases-next') expect([e.row, e.col]).toEqual(['5', '1']);
              else {
                const n = list.findIndex((p) => `quick-phrase-${p.id}` === id);
                expect(Math.floor(n / 10)).toBe(shown);
                expect(e).toEqual({ row: String(Math.floor((n % 10) / 2)), col: String(n % 2), label: list[n]!.text });
              }
            }
          }
        }
        // End in the constructed view.
        goTo(end);
        // Phrases: show the page shown at the start (the first) by paging back, not by re-entering.
        if (end === 'phrases') {
          for (let guard = 0; page() > 1 && guard < 10; guard++) host.select('phrases-prev');
          expect(page()).toBe(1);
        }

        const after = end === 'phrases' ? phraseRegistry() : record(ids);
        expect(after.entries).toEqual(before.entries);
        expect(after.order).toEqual(before.order);
        // Only the active view's grid is registered.
        expect([...registeredViews()].every((k) => k === end)).toBe(true);
        // Order on screen is row-major by (row, col), whatever the size and spacing.
        const rowMajor = [...after.entries].sort(([, a], [, b]) => Number(a.row) - Number(b.row) || Number(a.col) - Number(b.col)).map(([id]) => id);
        expect(after.order).toEqual(rowMajor);
        shares[end]++;
      }),
      { numRuns: 150 },
    );
    // Not vacuous: all three end-states were exercised, in comparable shares.
    expect(shares.core).toBeGreaterThan(25);
    expect(shares.spell).toBeGreaterThan(25);
    expect(shares.phrases).toBeGreaterThan(25);
  }, 120_000);
});
