// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Rect, TargetOptions } from '@planchette/skeleton';
import { mountBoardDom, type BoardDomApp, type BoardHost } from '../src/board-dom';
import { messages } from '../src/messages';

const html = readFileSync(resolve(import.meta.dirname, '../../../board/index.html'), 'utf8');

class FakeHost extends EventTarget {
  registered = new Map<string, { rect: Rect; options: TargetOptions | undefined }>();
  registerTarget(id: string, rect: Rect, options?: TargetOptions): void {
    this.registered.set(id, { rect, options });
  }
  updateTarget(): void {}
  unregisterTarget(): void {}
  getProfile() {
    return { targetSize: 96, targetSpacing: 16 };
  }
  setScreen(): void {}
  select(targetId: string): void {
    this.dispatchEvent(new CustomEvent('select', { detail: { targetId, now: 0, source: 'mouse', role: 'default' } }));
  }
}

function setup(message: string) {
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
  const calls: string[] = [];
  const listeners = new Set<(m: string) => void>();
  const model = {
    message,
    dispatch: (a: { type: string }, spell: boolean) => void calls.push(`dispatch:${a.type}:${spell}`),
    undo: () => void calls.push('undo'),
    subscribe: (fn: (m: string) => void) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
  const app = { model, speakMessage: async () => (calls.push('speak'), { spoken: true }) };
  const host = new FakeHost();
  mountBoardDom({ host: host as unknown as BoardHost, app: app as unknown as BoardDomApp, document });
  return { host, calls, model, listeners };
}

describe('board-dom actions', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('registers each action target with the right role', () => {
    const { host } = setup('');
    const role = (id: string) => host.registered.get(id)?.options?.role;
    for (const id of ['speak', 'backspace-action', 'clear', 'spell-toggle']) {
      expect(host.registered.has(id), id).toBe(true);
      expect(role(id), id).toBeUndefined(); // no role given: the skeleton uses 'default'
    }
    expect(role('undo')).toBe('undo');
    expect(role('cancel')).toBe('cancel');
    expect(role('rest-area')).toBe('rest-area');
  });

  it('maps each action id to exactly one model or app call', () => {
    const { host, calls } = setup('hello');
    const expected: Array<[string, string]> = [
      ['speak', 'speak'],
      ['backspace-action', 'dispatch:backspace:false'],
      ['clear', 'dispatch:clear:false'],
      ['undo', 'undo'],
    ];
    for (const [id, call] of expected) {
      calls.length = 0;
      host.select(id);
      expect(calls, id).toEqual([call]);
    }
  });

  it('makes no call for Cancel, the rest area, or an unknown id', () => {
    const { host, calls } = setup('hello');
    for (const id of ['cancel', 'rest-area', 'nope']) host.select(id);
    expect(calls).toEqual([]);
  });

  it('does not speak an empty Message', () => {
    const { host, calls } = setup('');
    host.select('speak');
    expect(calls).toEqual([]);
  });

  it('makes Backspace character-wise after the Spell toggle', () => {
    const { host, calls } = setup('hi');
    host.select('spell-toggle');
    host.select('backspace-action');
    expect(calls).toEqual(['dispatch:backspace:true']);
    expect(document.querySelector('[data-planchette-target="spell-toggle"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the Message in the bar and follows changes', () => {
    const { listeners } = setup('hello');
    const bar = document.getElementById('message-bar')!;
    expect(bar.textContent).toBe('hello');
    for (const fn of listeners) fn('hello there');
    expect(bar.textContent).toBe('hello there');
  });

  it('fills the action labels from messages.ts', () => {
    setup('');
    const label = (id: string) => document.querySelector(`[data-planchette-target="${id}"]`)?.textContent;
    expect(label('speak')).toBe(messages.actions.speak);
    expect(label('backspace-action')).toBe(messages.actions.backspace);
    expect(label('clear')).toBe(messages.actions.clear);
    expect(label('undo')).toBe(messages.actions.undo);
    expect(label('spell-toggle')).toBe(messages.actions.spell);
    expect(label('cancel')).toBe(messages.actions.cancel);
  });

  it('shows the not-a-medical-device notice on the page', () => {
    setup('');
    expect(document.getElementById('notice')?.textContent).toBe(messages.notMedicalDevice);
  });
});
