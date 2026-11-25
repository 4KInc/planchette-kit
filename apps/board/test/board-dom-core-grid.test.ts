// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Rect, TargetOptions } from '@planchette/skeleton';
import { mountBoardDom, type BoardDomApp, type BoardHost } from '../src/board-dom';
import { CORE_VOCABULARY } from '../src/core-vocabulary';

const html = readFileSync(resolve(import.meta.dirname, '../../../board/index.html'), 'utf8');

class FakeHost extends EventTarget {
  registered = new Map<string, { rect: Rect; options: TargetOptions | undefined }>();
  profile = { targetSize: 96, targetSpacing: 16 };
  registerTarget(id: string, rect: Rect, options?: TargetOptions): void {
    this.registered.set(id, { rect, options });
  }
  updateTarget(): void {}
  unregisterTarget(id: string): void {
    this.registered.delete(id);
  }
  setScreen(): void {}
  getProfile() {
    return this.profile;
  }
  select(targetId: string): void {
    this.dispatchEvent(new CustomEvent('select', { detail: { targetId, now: 0, source: 'mouse', role: 'default' } }));
  }
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

describe('board-dom core grid', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('style');
  });

  it('registers exactly the 36 core targets, as default-role targets', () => {
    const { host } = setup();
    const core = [...host.registered].filter(([id]) => id.startsWith('core-'));
    expect(core.map(([id]) => id)).toEqual(CORE_VOCABULARY.map((b) => `core-${b.id}`));
    for (const [, t] of core) expect(t.options?.role).toBeUndefined();
  });

  it('places each button by its entry row and column, whatever the DOM order', () => {
    setup();
    for (const b of CORE_VOCABULARY) {
      const el = document.querySelector<HTMLElement>(`[data-planchette-target="core-${b.id}"]`)!;
      expect(el.dataset.row).toBe(String(b.row));
      expect(el.dataset.col).toBe(String(b.col));
      expect(el.textContent).toBe(b.label);
    }
  });

  it('dispatches add-word with the word on select', () => {
    const { host, dispatched } = setup();
    for (const b of CORE_VOCABULARY) {
      dispatched.length = 0;
      host.select(`core-${b.id}`);
      expect(dispatched, b.id).toEqual([{ action: { type: 'add-word', text: b.label }, spell: false }]);
    }
  });

  it('sets the size and spacing variables from the profile, and follows changes', () => {
    const { host, dom } = setup();
    const root = document.documentElement.style;
    expect(root.getPropertyValue('--target-size')).toBe('96px');
    expect(root.getPropertyValue('--target-gap')).toBe('16px');
    host.profile = { targetSize: 140, targetSpacing: 24 };
    dom.syncTargets();
    expect(root.getPropertyValue('--target-size')).toBe('140px');
    expect(root.getPropertyValue('--target-gap')).toBe('24px');
    host.profile = { targetSize: 80, targetSpacing: 8 };
    host.dispatchEvent(new CustomEvent('mode-change', { detail: { mode: 'head' } }));
    expect(root.getPropertyValue('--target-size')).toBe('80px');
    expect(root.getPropertyValue('--target-gap')).toBe('8px');
  });
});
