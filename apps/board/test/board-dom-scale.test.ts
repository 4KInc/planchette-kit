// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeHost, stubRectWith } from './board-dom-helpers';
import { mountBoardDom, type BoardDomApp, type BoardHost } from '../src/board-dom';

const html = readFileSync(resolve(import.meta.dirname, '../../../board/index.html'), 'utf8');
const SIZE = 96;
const GAP = 16;

/** A FakeHost that records, with each updateTarget, the --target-size set at that moment. */
class SpyHost extends FakeHost {
  updates: Array<{ id: string; sizeAtCall: string }> = [];
  override updateTarget(id: string, rect: Parameters<FakeHost['updateTarget']>[1]): void {
    this.updates.push({ id, sizeAtCall: document.documentElement.style.getPropertyValue('--target-size') });
    super.updateTarget(id, rect);
  }
}

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
}

function setup() {
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
  const model = { message: '', dispatch: () => {}, undo: () => {}, subscribe: () => () => {} };
  const app = { model, speakMessage: async () => ({ spoken: true }) };
  const host = new SpyHost();
  const dom = mountBoardDom({ host: host as unknown as BoardHost, app: app as unknown as BoardDomApp, document });
  return { host, dom };
}

const root = () => document.documentElement.style;

describe('board-dom scales the layout to the viewport', () => {
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  const originalSetAttribute = Element.prototype.setAttribute;
  const originalW = window.innerWidth;
  const originalH = window.innerHeight;
  let styleAttributeWrites: Element[] = [];

  beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('style');
    styleAttributeWrites = [];
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      return stubRectWith(this, SIZE, GAP);
    };
    Element.prototype.setAttribute = function (this: Element, name: string, value: string) {
      if (name === 'style') styleAttributeWrites.push(this);
      return originalSetAttribute.call(this, name, value);
    };
  });
  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    Element.prototype.setAttribute = originalSetAttribute;
    setViewport(originalW, originalH);
  });

  it('sets --target-size to 96px at 1366x768 and 139px at 1920x1080 after a resize', () => {
    setViewport(1366, 768);
    setup();
    expect(root().getPropertyValue('--target-size')).toBe('96px');
    setViewport(1920, 1080);
    window.dispatchEvent(new Event('resize'));
    expect(root().getPropertyValue('--target-size')).toBe('139px');
    setViewport(1366, 768);
    window.dispatchEvent(new Event('resize'));
    expect(root().getPropertyValue('--target-size')).toBe('96px');
  });

  it('keeps --target-gap at the Profile spacing at both sizes', () => {
    setViewport(1366, 768);
    setup();
    expect(root().getPropertyValue('--target-gap')).toBe('16px');
    setViewport(1920, 1080);
    window.dispatchEvent(new Event('resize'));
    expect(root().getPropertyValue('--target-gap')).toBe('16px');
  });

  it('updates every registered target after --target-size is set, on resize', () => {
    setViewport(1366, 768);
    const { host } = setup();
    const ids = [...host.registered.keys()];
    expect(ids.length).toBeGreaterThan(0);
    host.updates = [];
    setViewport(1920, 1080);
    window.dispatchEvent(new Event('resize'));
    for (const id of ids) {
      const calls = host.updates.filter((u) => u.id === id);
      expect(calls.length, id).toBeGreaterThanOrEqual(1);
      expect(calls.every((c) => c.sizeAtCall === '139px'), id).toBe(true);
    }
  });

  it('writes no style attribute with setAttribute', () => {
    setViewport(1366, 768);
    setup();
    setViewport(1920, 1080);
    window.dispatchEvent(new Event('resize'));
    expect(styleAttributeWrites).toEqual([]);
  });
});

describe('board-dom Message bar custom properties (Req 14 AC 14 to 17)', () => {
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  const originalSetAttribute = Element.prototype.setAttribute;
  const originalW = window.innerWidth;
  const originalH = window.innerHeight;
  let styleWrites: Element[] = [];
  beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('style');
    styleWrites = [];
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      return stubRectWith(this, SIZE, GAP);
    };
    Element.prototype.setAttribute = function (this: Element, name: string, value: string) {
      if (name === 'style') styleWrites.push(this);
      return originalSetAttribute.call(this, name, value);
    };
  });
  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    Element.prototype.setAttribute = originalSetAttribute;
    setViewport(originalW, originalH);
  });

  it('sets the bar height, lines and size at 1366x768, then at 1920x1080 after a resize', () => {
    setViewport(1366, 768);
    setup();
    expect(root().getPropertyValue('--bar-height')).toBe('80px');
    expect(root().getPropertyValue('--bar-lines')).toBe('1');
    expect(root().getPropertyValue('--target-size')).toBe('96px');
    expect(root().getPropertyValue('--page-min-height')).toBe('768px');
    setViewport(1920, 1080);
    window.dispatchEvent(new Event('resize'));
    expect(root().getPropertyValue('--bar-height')).toBe('131px');
    expect(root().getPropertyValue('--bar-lines')).toBe('2');
    expect(root().getPropertyValue('--target-size')).toBe('139px');
    expect(root().getPropertyValue('--page-min-height')).toBe('1077px');
  });

  it('updates every registered id after the properties are set', () => {
    setViewport(1366, 768);
    const { host } = setup();
    const ids = [...host.registered.keys()];
    // The Message bar (`<p id="message-bar" role="status">`) carries no data-planchette-target, so it
    // is not a registered target; its height reaches the targets below it through their rectangles.
    expect(ids.length).toBeGreaterThan(0);
    const props: Array<[string, string]> = [['--bar-height', '131px'], ['--bar-lines', '2'], ['--page-min-height', '1077px'], ['--target-size', '139px']];
    const seen: Array<{ id: string; ok: boolean }> = [];
    const original = host.updateTarget.bind(host);
    host.updateTarget = (id, rect) => {
      seen.push({ id, ok: props.every(([k, v]) => root().getPropertyValue(k) === v) });
      original(id, rect);
    };
    setViewport(1920, 1080);
    window.dispatchEvent(new Event('resize'));
    for (const id of ids) {
      const calls = seen.filter((c) => c.id === id);
      expect(calls.length, id).toBeGreaterThanOrEqual(1);
      expect(calls.every((c) => c.ok), id).toBe(true);
    }
    expect(styleWrites).toEqual([]);
  });
});

describe('board-dom right-column targets across view changes (1920x1080)', () => {
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  const originalW = window.innerWidth;
  const originalH = window.innerHeight;
  beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('style');
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      return stubRectWith(this, SIZE, GAP);
    };
  });
  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    setViewport(originalW, originalH);
  });

  /**
   * jsdom has no layout. The fake rectangles come from data-row / data-col, so this checks
   * only that no view change alters or loses a right-column registration while the right
   * column keeps its place. That the real column keeps its place (`.side` with
   * `align-content: start`, `.page` held at the Core height) is pinned in board-layout.test.ts
   * and measured in board-viewport.e2e.ts.
   */
  it('registers each right-column target at its current element rect after every view change', () => {
    setViewport(1920, 1080);
    const { host } = setup();
    const side = document.querySelector('.side')!;
    const rightIds = [...side.querySelectorAll<HTMLElement>('[data-planchette-target]')].map((el) => el.dataset.planchetteTarget!);
    expect(rightIds).toEqual(expect.arrayContaining(['speak', 'undo', 'cancel', 'spell-toggle', 'camera-toggle', 'phrases-toggle', 'rest-area']));
    const toggles = ['spell-toggle', 'spell-toggle', 'phrases-toggle', 'phrases-toggle', 'phrases-toggle', 'spell-toggle', 'phrases-toggle'];
    for (const toggle of toggles) {
      host.select(toggle); // Core <-> Spell <-> Phrases
      for (const id of rightIds) {
        const el = document.querySelector<HTMLElement>(`[data-planchette-target="${id}"]`)!;
        const r = el.getBoundingClientRect();
        expect(host.registered.get(id)?.rect, `${id} after ${toggle}`).toEqual({ x: r.x, y: r.y, width: r.width, height: r.height });
      }
    }
  });
});
