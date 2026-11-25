// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountBoardDom, type BoardDomApp, type BoardHost } from '../src/board-dom';
import { CORE_VOCABULARY } from '../src/core-vocabulary';
import { LETTER_BOARD } from '../src/letter-board';
import { FakeHost, stubRectWith } from './board-dom-helpers';

const html = readFileSync(resolve(import.meta.dirname, '../../../board/index.html'), 'utf8');

type Op =
  | { kind: 'select'; id: string }
  | { kind: 'toggle' }
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

// `spell` is the Spell-mode state both before and after the sequence. Constructing it as
// its own boolean (rather than filtering) makes both cases occur in equal shares.
const scenarioArb = fc.record({ spell: fc.boolean(), ops: fc.array(opArb, { maxLength: 40 }) });

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

  /** Mounts a fresh Board DOM; returns it with a handle on the Spell-mode state. */
  function mount() {
    document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
    document.documentElement.removeAttribute('style');
    host = new FakeHost();
    const model = {
      message: '',
      dispatch: () => {},
      undo: () => {},
      subscribe: () => () => {},
    };
    const app = { model, speakMessage: async () => ({ spoken: true }) };
    const dom = mountBoardDom({ host: host as unknown as BoardHost, app: app as unknown as BoardDomApp, document });
    const spellOn = () => document.querySelector('[data-planchette-target="spell-toggle"]')!.getAttribute('aria-pressed') === 'true';
    return { dom, spellOn };
  }

  /** What the host holds for one grid: id → (row, col, label), and ids in on-screen order. */
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

  function apply(op: Op, dom: ReturnType<typeof mount>['dom']): void {
    switch (op.kind) {
      case 'select':
        host.select(op.id);
        break;
      case 'toggle':
        host.select('spell-toggle');
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
  }

  it('keeps (row, col, label) and relative order of the active grid across any sequence', () => {
    const shares = { on: 0, off: 0 };
    fc.assert(
      fc.property(scenarioArb, ({ spell, ops }) => {
        const { dom, spellOn } = mount();
        if (spell) host.select('spell-toggle');
        expect(spellOn()).toBe(spell);
        const ids = spell ? letterIds : coreIds;
        const before = record(ids);
        expect(before.entries.size).toBe(ids.length);

        for (const op of ops) apply(op, dom);
        // End in the constructed Spell-mode state.
        if (spellOn() !== spell) host.select('spell-toggle');
        expect(spellOn()).toBe(spell);

        const after = record(ids);
        expect(after.entries).toEqual(before.entries);
        expect(after.order).toEqual(before.order);
        // Only the active grid is registered.
        expect(record(spell ? coreIds : letterIds).entries.size).toBe(0);
        // Order on screen is row-major by (row, col), whatever the size and spacing.
        const rowMajor = [...after.entries].sort(([, a], [, b]) => Number(a.row) - Number(b.row) || Number(a.col) - Number(b.col)).map(([id]) => id);
        expect(after.order).toEqual(rowMajor);
        shares[spell ? 'on' : 'off']++;
      }),
      { numRuns: 100 },
    );
    // Not vacuous: both Spell-mode cases were exercised, in comparable shares.
    expect(shares.on).toBeGreaterThan(25);
    expect(shares.off).toBeGreaterThan(25);
  }, 120_000);
});
