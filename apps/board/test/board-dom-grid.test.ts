// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeHost, stubRectWith } from './board-dom-helpers';
import { mountBoardDom, type BoardDomApp, type BoardHost } from '../src/board-dom';
import { CORE_VOCABULARY } from '../src/core-vocabulary';
import { LETTER_BOARD } from '../src/letter-board';
import { messages } from '../src/messages';

const html = readFileSync(resolve(import.meta.dirname, '../../../board/index.html'), 'utf8');

const SIZE = 96;
const GAP = 16;

function stubRect(this: HTMLElement): DOMRect {
  return stubRectWith(this, SIZE, GAP);
}

function setup() {
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
  const dispatched: Array<{ action: unknown; spell: boolean }> = [];
  const model = {
    message: '',
    dispatch: (action: unknown, spell: boolean) => void dispatched.push({ action, spell }),
    undo: () => {},
    subscribe: () => () => {},
  };
  const app = { model, speakMessage: async () => ({ spoken: true }) };
  const host = new FakeHost();
  const dom = mountBoardDom({ host: host as unknown as BoardHost, app: app as unknown as BoardDomApp, document });
  return { host, dom, dispatched };
}

const ACTION_IDS = ['speak', 'backspace-action', 'clear', 'undo', 'spell-toggle', 'cancel', 'rest-area'];
const gridIds = (host: FakeHost, prefixes: string[]) =>
  [...host.registered.keys()].filter((id) => !ACTION_IDS.includes(id) && prefixes.some((p) => id.startsWith(p)));
const snapshot = (host: FakeHost) => JSON.stringify([...host.registered].filter(([id]) => id.startsWith('core-')));

describe('board-dom grids and Spell mode', () => {
  const original = HTMLElement.prototype.getBoundingClientRect;
  beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('style');
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      return stubRect.call(this);
    };
    return () => {
      HTMLElement.prototype.getBoundingClientRect = original;
    };
  });

  it('registers exactly the 36 core targets in core-grid mode, with non-zero rects', () => {
    const { host } = setup();
    const ids = gridIds(host, ['core-', 'letter-', 'space', 'backspace']);
    expect(ids).toEqual(CORE_VOCABULARY.map((b) => `core-${b.id}`));
    expect(ids).toHaveLength(36);
    for (const b of CORE_VOCABULARY) {
      expect(host.registered.get(`core-${b.id}`)!.rect).toEqual({
        x: b.col * (SIZE + GAP),
        y: b.row * (SIZE + GAP),
        width: SIZE,
        height: SIZE,
      });
    }
  });

  it('registers exactly the 28 Letter-board targets in Spell mode, and no core targets', () => {
    const { host } = setup();
    host.select('spell-toggle');
    expect([...host.registered.keys()].filter((id) => id.startsWith('core-'))).toEqual([]);
    const ids = gridIds(host, ['letter-', 'space', 'backspace']);
    expect(ids).toEqual(LETTER_BOARD.map((k) => k.id));
    expect(ids).toHaveLength(28);
    for (const k of LETTER_BOARD) {
      const t = host.registered.get(k.id)!;
      expect(t.rect.x, k.id).toBe(k.col * (SIZE + GAP));
      expect(t.label, k.id).toBe(k.label);
    }
    // The action targets stay registered.
    for (const id of ACTION_IDS) expect(host.registered.has(id), id).toBe(true);
  });

  it('places Letter-board keys by row and column and leaves (4,4) and (4,5) empty', () => {
    const { host } = setup();
    host.select('spell-toggle');
    const cells = [...document.querySelectorAll<HTMLElement>('#letter-grid [data-planchette-target]')];
    expect(cells).toHaveLength(28);
    expect(cells.filter((el) => el.dataset.row === '4' && Number(el.dataset.col) >= 4)).toEqual([]);
    for (const k of LETTER_BOARD) {
      const el = document.querySelector<HTMLElement>(`[data-planchette-target="${k.id}"]`)!;
      expect(el.dataset.row).toBe(String(k.row));
      expect(el.dataset.col).toBe(String(k.col));
    }
    expect(document.querySelector('#core-grid')!.hasAttribute('hidden')).toBe(true);
    expect(document.querySelector('#letter-grid')!.hasAttribute('hidden')).toBe(false);
  });

  it('takes the Space and Backspace labels from messages.ts', () => {
    const { host } = setup();
    host.select('spell-toggle');
    expect(host.registered.get('space')!.label).toBe(messages.letterBoard.space);
    expect(host.registered.get('backspace')!.label).toBe(messages.letterBoard.backspace);
  });

  it('returns to the identical 36 core registrations after toggling Spell mode twice', () => {
    const { host } = setup();
    const before = snapshot(host);
    host.select('spell-toggle');
    host.select('spell-toggle');
    expect(gridIds(host, ['letter-', 'space', 'backspace'])).toEqual([]);
    expect(gridIds(host, ['core-'])).toHaveLength(36);
    expect(snapshot(host)).toBe(before);
    expect(document.querySelector('[data-planchette-target="spell-toggle"]')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('dispatches add-letter, add-space and backspace from the Letter board, in spell mode', () => {
    const { host, dispatched } = setup();
    host.select('spell-toggle');
    for (const k of LETTER_BOARD) {
      dispatched.length = 0;
      host.select(k.id);
      const action =
        k.id === 'space' ? { type: 'add-space' } : k.id === 'backspace' ? { type: 'backspace' } : { type: 'add-letter', char: k.label };
      expect(dispatched, k.id).toEqual([{ action, spell: true }]);
    }
  });

  it('keeps the action-row Backspace character-wise in Spell mode and word-wise otherwise', () => {
    const { host, dispatched } = setup();
    host.select('backspace-action');
    host.select('spell-toggle');
    host.select('backspace-action');
    host.select('spell-toggle');
    host.select('backspace-action');
    expect(dispatched.map((d) => d.spell)).toEqual([false, true, false]);
  });
});
