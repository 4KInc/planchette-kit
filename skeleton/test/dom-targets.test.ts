// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createTargetRegistry, elementRect, roleOptionsOf } from '../src/ui/dom-targets.js';
function el(id: string, role?: string, rect = { x: 1, y: 2, width: 30, height: 40 }): HTMLElement {
  const e = document.createElement('button');
  e.dataset.planchetteTarget = id;
  if (role !== undefined) e.dataset.role = role;
  e.getBoundingClientRect = () => ({ ...rect, left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height, toJSON: () => ({}) }) as DOMRect;
  return e;
}
const host = () => ({ registerTarget: vi.fn(), updateTarget: vi.fn(), unregisterTarget: vi.fn() });
describe('dom-targets', () => {
  it('elementRect reads the element rectangle', () => {
    expect(elementRect(el('a'))).toEqual({ x: 1, y: 2, width: 30, height: 40 });
  });
  it('roleOptionsOf maps the four known roles and ignores others', () => {
    expect(roleOptionsOf(el('a', 'cancel'))).toEqual({ role: 'cancel' });
    expect(roleOptionsOf(el('a', 'undo'))).toEqual({ role: 'undo' });
    expect(roleOptionsOf(el('a', 'rest-area'))).toEqual({ role: 'rest-area' });
    expect(roleOptionsOf(el('a', 'default'))).toEqual({ role: 'default' });
    expect(roleOptionsOf(el('a', 'bogus'))).toBeUndefined();
    expect(roleOptionsOf(el('a'))).toBeUndefined();
  });
  it('the registry registers with the role, updates, and unregisters once', () => {
    const h = host();
    const reg = createTargetRegistry(h);
    const a = el('a', 'cancel');
    const b = el('b');
    expect(reg.register(a)).toEqual({ x: 1, y: 2, width: 30, height: 40 });
    reg.register(b);
    expect(h.registerTarget).toHaveBeenCalledWith('a', { x: 1, y: 2, width: 30, height: 40 }, { role: 'cancel' });
    expect(h.registerTarget).toHaveBeenCalledWith('b', { x: 1, y: 2, width: 30, height: 40 }, undefined);
    expect(reg.has('a')).toBe(true);
    reg.update();
    expect(h.updateTarget).toHaveBeenCalledTimes(2);
    expect(reg.rects().get('b')).toEqual({ x: 1, y: 2, width: 30, height: 40 });
    reg.unregister(a);
    reg.unregister(a);
    expect(h.unregisterTarget).toHaveBeenCalledTimes(1);
    expect(reg.has('a')).toBe(false);
    expect(reg.rects().has('a')).toBe(false);
  });
  it('an element with no id is an error', () => {
    const reg = createTargetRegistry(host());
    expect(() => reg.register(document.createElement('div'))).toThrow(/no data-planchette-target/);
  });
});
