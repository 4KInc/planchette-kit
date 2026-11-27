// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Planchette } from '../src/api-types.js';
import { createDwellRing } from '../src/ui/dwell-ring.js';

function fake(): { p: Planchette; emit: (type: string, detail: unknown) => void } {
  const t = new EventTarget();
  const p = {
    addEventListener: (type: string, fn: EventListener) => t.addEventListener(type, fn),
    removeEventListener: (type: string, fn: EventListener) => t.removeEventListener(type, fn),
    getTargets: () => [{ id: 'a', rect: { x: 10, y: 20, width: 100, height: 80 }, autoRepeat: false, role: 'normal' }],
  } as unknown as Planchette;
  return { p, emit: (type, detail) => t.dispatchEvent(new CustomEvent(type, { detail })) };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('createDwellRing shape', () => {
  it('default shape builds the circles and tick', () => {
    const { p } = fake();
    const ring = createDwellRing(p, { reducedMotion: true });
    expect(ring.element.querySelectorAll('circle').length).toBe(3);
    expect(ring.element.querySelector('.planchette-ring-tick')).not.toBeNull();
    expect(ring.element.hasAttribute('data-shape')).toBe(false);
  });

  it('outline: unfilled rects on the registered rect when no element exists, quarter steps when reduced', () => {
    const { p, emit } = fake();
    const ring = createDwellRing(p, { shape: 'outline', reducedMotion: true });
    emit('dwell-progress', { targetId: 'a', progress: 0.6 });
    const svg = ring.element;
    expect(svg.getAttribute('data-shape')).toBe('outline');
    expect(svg.getAttribute('fill')).toBe('none');
    expect(svg.querySelector('circle')).toBeNull();
    for (const r of svg.querySelectorAll('rect')) {
      expect(r.getAttribute('fill')).toBe('none');
      expect(r.style.fill).toBe('none');
    }
    expect(svg.style.left).toBe('10px');
    expect(svg.getAttribute('data-progress')).toBe('0.5');
    const arc = svg.querySelector('.planchette-ring-arc')!;
    const len = Number(arc.getAttribute('stroke-dasharray'));
    expect(Number(arc.getAttribute('stroke-dashoffset'))).toBeCloseTo(len * 0.5);
    expect((arc as SVGElement).style.transition).toBe('none');
  });

  function makeCell(rect: { left: number; top: number; width: number; height: number }, border: string, radius: string): { el: HTMLElement; setRect: (r: typeof rect) => void } {
    const el = document.createElement('button');
    el.setAttribute('data-planchette-target', 'a');
    el.style.borderTopWidth = border;
    el.style.borderTopStyle = 'solid';
    el.style.borderTopLeftRadius = radius;
    document.body.appendChild(el);
    let current = rect;
    el.getBoundingClientRect = () => ({ ...current, right: current.left + current.width, bottom: current.top + current.height, x: current.left, y: current.top, toJSON: () => ({}) }) as DOMRect;
    return { el, setRect: (r) => (current = r) };
  }
  const num = (e: Element, a: string): number => Number(e.getAttribute(a));

  it('outline: no circle, every rect unfilled, and a page rule rect { fill: #fff } cannot fill them', () => {
    const style = document.createElement('style');
    style.textContent = 'rect { fill: #fff }';
    document.head.appendChild(style);
    makeCell({ left: 30, top: 40, width: 128, height: 96 }, '2px', '8px');
    const { p, emit } = fake();
    const ring = createDwellRing(p, { shape: 'outline', reducedMotion: false });
    emit('dwell-progress', { targetId: 'a', progress: 0.5 });
    expect(ring.element.getAttribute('fill')).toBe('none');
    expect(ring.element.querySelectorAll('circle').length).toBe(0);
    expect(ring.element.querySelectorAll('rect').length).toBe(3);
    for (const el of ring.element.querySelectorAll('*')) {
      expect(el.tagName.toLowerCase()).toBe('rect');
      expect((el as SVGElement).style.fill).toBe('none');
      expect(el.getAttribute('fill')).toBe('none');
    }
    style.remove();
  });

  it('outline: the three rects take the element rect, border width and radius with the insets, and follow a change', () => {
    vi.useFakeTimers();
    const cell = makeCell({ left: 30, top: 40, width: 128, height: 96 }, '2px', '8px');
    const { p, emit } = fake();
    const ring = createDwellRing(p, { shape: 'outline', reducedMotion: false });
    emit('dwell-progress', { targetId: 'a', progress: 0.5 });
    const svg = ring.element;
    expect([svg.style.left, svg.style.top, svg.style.width, svg.style.height]).toEqual(['30px', '40px', '128px', '96px']);
    const [edge, track, arc] = ['edge', 'track', 'arc'].map((n) => svg.querySelector(`.planchette-ring-${n}`)!);
    // border 2: centre lines at 2.5, 5, 5; widths 1, 4, 2; radius 8 - inset
    expect([num(edge, 'x'), num(track, 'x'), num(arc, 'x')]).toEqual([2.5, 5, 5]);
    expect([num(edge, 'stroke-width'), num(track, 'stroke-width'), num(arc, 'stroke-width')]).toEqual([1, 4, 2]);
    expect([num(edge, 'width'), num(track, 'width'), num(arc, 'width')]).toEqual([123, 118, 118]);
    expect([num(edge, 'rx'), num(track, 'rx'), num(arc, 'rx')]).toEqual([5.5, 3, 3]);
    // arc length is progress of the perimeter, and the dash is that perimeter
    const perimeter = 2 * (118 + 86) - 8 * 3 + 2 * Math.PI * 3;
    expect(num(arc, 'stroke-dasharray')).toBeCloseTo(perimeter, 6);
    expect(num(arc, 'stroke-dashoffset')).toBeCloseTo(perimeter * 0.5, 6);
    expect((arc as SVGElement).style.transition).toContain('80ms');

    // the cell grows: a resize plus one frame re-measures, keeping the same progress
    cell.setRect({ left: 50, top: 60, width: 197, height: 148 });
    cell.el.style.borderTopWidth = '4px';
    window.dispatchEvent(new Event('resize'));
    expect(svg.style.width).toBe('128px'); // not until the frame
    vi.advanceTimersByTime(20);
    expect([svg.style.left, svg.style.top, svg.style.width, svg.style.height]).toEqual(['50px', '60px', '197px', '148px']);
    expect(num(edge, 'x')).toBe(4.5);
    expect(num(arc, 'x')).toBe(7);
    expect(num(arc, 'width')).toBe(197 - 14);
    expect(num(arc, 'rx')).toBe(1);
    const p2 = 2 * (183 + 134) - 8 + 2 * Math.PI;
    expect(num(arc, 'stroke-dasharray')).toBeCloseTo(p2, 6);
    expect(num(arc, 'stroke-dashoffset')).toBeCloseTo(p2 * 0.5, 6);
    ring.destroy();
  });

  it('outline: the arc is progress of the perimeter for several progress values', () => {
    makeCell({ left: 0, top: 0, width: 100, height: 100 }, '0px', '0px');
    const { p, emit } = fake();
    const ring = createDwellRing(p, { shape: 'outline', reducedMotion: false });
    for (const progress of [0.1, 0.37, 0.99]) {
      emit('dwell-progress', { targetId: 'a', progress });
      const arc = ring.element.querySelector('.planchette-ring-arc')!;
      const len = num(arc, 'stroke-dasharray');
      expect(len).toBe(4 * 94);
      expect(len - num(arc, 'stroke-dashoffset')).toBeCloseTo(len * progress, 6);
    }
    emit('dwell-progress', { targetId: 'a', progress: 0 });
    expect(ring.element.style.display).toBe('none');
  });

  it('outline: reduced motion gives quarter steps and no transition', () => {
    makeCell({ left: 0, top: 0, width: 100, height: 100 }, '0px', '0px');
    const { p, emit } = fake();
    const ring = createDwellRing(p, { shape: 'outline', reducedMotion: true });
    const seen: string[] = [];
    for (const progress of [0.1, 0.26, 0.5, 0.74, 0.99, 1]) {
      emit('dwell-progress', { targetId: 'a', progress });
      seen.push(ring.element.getAttribute('data-progress')!);
    }
    expect(seen).toEqual(['0', '0.25', '0.5', '0.5', '0.75', '1']);
    expect((ring.element.querySelector('.planchette-ring-arc') as SVGElement).style.transition).toBe('none');
  });

  it('outline: destroy removes the SVG and the resize and scroll listeners', () => {
    vi.useFakeTimers();
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    makeCell({ left: 0, top: 0, width: 100, height: 100 }, '0px', '0px');
    const { p, emit } = fake();
    const ring = createDwellRing(p, { shape: 'outline', reducedMotion: true });
    emit('dwell-progress', { targetId: 'a', progress: 0.5 });
    ring.destroy();
    for (const type of ['resize', 'scroll']) {
      const added = add.mock.calls.filter((c) => c[0] === type).map((c) => c[1]);
      const removed = remove.mock.calls.filter((c) => c[0] === type).map((c) => c[1]);
      expect(added.length).toBeGreaterThan(0);
      for (const fn of added) expect(removed).toContain(fn);
    }
    expect(document.querySelector('[data-planchette="dwell-ring"]')).toBeNull();
    add.mockRestore();
    remove.mockRestore();
  });

  it('outline: a non-scan select shows a closed loop for 600 ms, a scan select nothing; destroy cleans up', () => {
    vi.useFakeTimers();
    const { p, emit } = fake();
    const ring = createDwellRing(p, { shape: 'outline', reducedMotion: true });
    emit('select', { targetId: 'a', source: 'scan' });
    expect(ring.element.style.display).toBe('none');
    emit('select', { targetId: 'a', source: 'dwell' });
    expect(ring.element.getAttribute('data-progress')).toBe('1');
    expect(ring.element.style.display).toBe('');
    expect(ring.element.querySelector('.planchette-ring-tick')).toBeNull();
    vi.advanceTimersByTime(601);
    expect(ring.element.style.display).toBe('none');
    ring.destroy();
    expect(document.querySelector('[data-planchette="dwell-ring"]')).toBeNull();
    emit('dwell-progress', { targetId: 'a', progress: 0.5 }); // no listener left
    expect(document.querySelector('[data-planchette="dwell-ring"]')).toBeNull();
  });
});
