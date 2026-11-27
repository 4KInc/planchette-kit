/**
 * dwell-ring.ts — a ring at the pointer that fills as dwell time builds up (Task 16.1,
 * accessibility.md Feedback). Purely visual: it listens to the public `pointer-move`,
 * `dwell-progress` and `select` events and decides nothing.
 *
 * Not colour alone: progress is the length of the arc (a shape), drawn as a light arc on
 * a dark outline so it shows on light and dark pages, and a select adds a tick mark.
 *
 * prefers-reduced-motion: the ring does not move smoothly. It shows the progress in
 * quarter steps (a static ring at each level), with no transition and no pulse on select.
 * Otherwise the arc follows every progress event with a short transition, and a select
 * gives one short pulse (never more than one flash a second; WCAG 2.3.1).
 *
 * Nothing happens on import; `createDwellRing` adds the ring to the page.
 */
import type { Planchette } from '../api-types.js';
import { outlineGeometry, type OutlineStroke } from './dwell-outline-geometry.js';

export interface DwellRingOptions {
  /** Where the ring is added. Default: document.body. */
  container?: HTMLElement;
  /** Diameter in CSS px. Default 72. Ignored by the `'outline'` shape. */
  size?: number;
  /** Force reduced motion on or off. Default: follow prefers-reduced-motion. */
  reducedMotion?: boolean;
  /**
   * `'ring'` (default): a ring at the pointer. `'outline'`: progress drawn along the edge of the
   * target element, just inside its border, with no fill, so nothing covers the label.
   */
  shape?: DwellRingShape;
  /**
   * `'outline'` only. The element of a target id. Default: the element with
   * `data-planchette-target="<id>"`, else the element with that id.
   */
  elementFor?: (targetId: string) => HTMLElement | null;
}

export type DwellRingShape = 'ring' | 'outline';

export interface DwellRing {
  readonly element: SVGSVGElement;
  destroy(): void;
}

const SVG = 'http://www.w3.org/2000/svg';
/** How long the "selected" tick stays (ms). Visual only. */
const SELECTED_MS = 600;

/** The fraction shown for a progress value: quarter steps when motion is reduced. */
export function shownProgress(progress: number, reduced: boolean): number {
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  return reduced ? Math.floor(p * 4 + 1e-9) / 4 : p;
}

export function createDwellRing(planchette: Planchette, options: DwellRingOptions = {}): DwellRing {
  return options.shape === 'outline' ? createDwellOutline(planchette, options) : createRing(planchette, options);
}

function createRing(planchette: Planchette, options: DwellRingOptions): DwellRing {
  const doc = document;
  const size = options.size ?? 72;
  const stroke = Math.max(6, Math.round(size / 9));
  const r = (size - stroke * 2) / 2;
  const circumference = 2 * Math.PI * r;

  const media = options.reducedMotion === undefined && typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduced = options.reducedMotion ?? media?.matches ?? false;

  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('data-planchette', 'dwell-ring');
  svg.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:2147483646;display:none;overflow:visible';

  const c = size / 2;
  const circle = (cls: string, color: string, width: number): SVGCircleElement => {
    const el = doc.createElementNS(SVG, 'circle');
    el.setAttribute('cx', String(c));
    el.setAttribute('cy', String(c));
    el.setAttribute('r', String(r));
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', color);
    el.setAttribute('stroke-width', String(width));
    el.setAttribute('class', cls);
    return el;
  };
  // A dark track with a light edge, so the ring is visible on any page (3:1 for UI parts).
  const edge = circle('planchette-ring-edge', '#fff', stroke + 4);
  const track = circle('planchette-ring-track', '#111', stroke);
  const arc = circle('planchette-ring-arc', '#ffd400', stroke - 2);
  arc.setAttribute('stroke-linecap', 'butt');
  arc.setAttribute('stroke-dasharray', String(circumference));
  arc.setAttribute('transform', `rotate(-90 ${c} ${c})`); // start at 12 o'clock, fill clockwise
  const tick = doc.createElementNS(SVG, 'path');
  tick.setAttribute('d', `M ${c - r * 0.45} ${c} L ${c - r * 0.1} ${c + r * 0.35} L ${c + r * 0.5} ${c - r * 0.35}`);
  tick.setAttribute('fill', 'none');
  tick.setAttribute('stroke', '#fff');
  tick.setAttribute('stroke-width', String(stroke - 2));
  tick.setAttribute('stroke-linecap', 'round');
  tick.setAttribute('stroke-linejoin', 'round');
  tick.setAttribute('class', 'planchette-ring-tick');
  tick.style.display = 'none';
  svg.append(edge, track, arc, tick);
  (options.container ?? doc.body).appendChild(svg);

  let state: 'idle' | 'filling' | 'selected' = 'idle';
  let shown = 0;
  let selectedTimer: ReturnType<typeof setTimeout> | null = null;

  function applyMotion(): void {
    svg.setAttribute('data-reduced-motion', String(reduced));
    arc.style.transition = reduced ? 'none' : 'stroke-dashoffset 80ms linear';
    svg.style.transition = 'none';
  }

  function render(): void {
    svg.setAttribute('data-state', state);
    svg.setAttribute('data-progress', String(shown));
    arc.setAttribute('stroke-dashoffset', String(circumference * (1 - shown)));
    tick.style.display = state === 'selected' ? '' : 'none';
    svg.style.display = state === 'idle' ? 'none' : '';
  }

  function clearSelected(): void {
    if (selectedTimer !== null) clearTimeout(selectedTimer);
    selectedTimer = null;
    svg.getAnimations?.().forEach((a) => a.cancel());
  }

  const onMove = (e: Event): void => {
    const { x, y } = (e as CustomEvent<{ x: number; y: number }>).detail;
    svg.style.transform = `translate(${x - c}px, ${y - c}px)`;
  };
  const onProgress = (e: Event): void => {
    const { progress } = (e as CustomEvent<{ targetId: string; progress: number }>).detail;
    if (state === 'selected' && progress === 0) return; // keep the tick until it times out
    if (state === 'selected') clearSelected();
    shown = shownProgress(progress, reduced);
    state = progress > 0 ? 'filling' : 'idle';
    render();
  };
  const onSelect = (e: Event): void => {
    // Scanning has no pointer: its feedback is the scan highlight.
    if ((e as CustomEvent<{ source: string }>).detail.source === 'scan') return;
    clearSelected();
    state = 'selected';
    shown = 1;
    render();
    if (!reduced && typeof svg.animate === 'function') {
      svg.animate([{ scale: '1' }, { scale: '1.15' }, { scale: '1' }], { duration: 250, easing: 'ease-out' });
    }
    selectedTimer = setTimeout(() => {
      selectedTimer = null;
      state = 'idle';
      shown = 0;
      render();
    }, SELECTED_MS);
  };
  const onMediaChange = (): void => {
    reduced = media?.matches ?? reduced;
    applyMotion();
  };

  planchette.addEventListener('pointer-move', onMove);
  planchette.addEventListener('dwell-progress', onProgress);
  planchette.addEventListener('select', onSelect);
  media?.addEventListener('change', onMediaChange);
  applyMotion();
  render();

  return {
    element: svg,
    destroy(): void {
      clearSelected();
      planchette.removeEventListener('pointer-move', onMove);
      planchette.removeEventListener('dwell-progress', onProgress);
      planchette.removeEventListener('select', onSelect);
      media?.removeEventListener('change', onMediaChange);
      svg.remove();
    },
  };
}

// ---- the outline shape --------------------------------------------------------------

function defaultElementFor(id: string): HTMLElement | null {
  const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&');
  return document.querySelector<HTMLElement>(`[data-planchette-target="${escaped}"]`) ?? document.getElementById(id);
}

function px(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Progress drawn along the target's edge (design.md "Dwell progress outline"): an overlay on the
 * border box, three unfilled rects (edge, track, arc), so nothing lies over the label.
 */
function createDwellOutline(planchette: Planchette, options: DwellRingOptions): DwellRing {
  const doc = document;
  const elementFor = options.elementFor ?? defaultElementFor;

  const media = options.reducedMotion === undefined && typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduced = options.reducedMotion ?? media?.matches ?? false;

  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('data-planchette', 'dwell-ring');
  svg.setAttribute('data-shape', 'outline');
  svg.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:2147483646;display:none;overflow:hidden';
  svg.style.fill = 'none';

  const makeRect = (cls: string, g: OutlineStroke): SVGRectElement => {
    const el = doc.createElementNS(SVG, 'rect');
    el.setAttribute('fill', 'none');
    el.style.fill = 'none';
    el.setAttribute('stroke', g.colour);
    el.setAttribute('class', cls);
    return el;
  };
  const initial = outlineGeometry({ width: 0, height: 0 }, 0, 0);
  const edge = makeRect('planchette-ring-edge', initial.edge);
  const track = makeRect('planchette-ring-track', initial.track);
  const arc = makeRect('planchette-ring-arc', initial.arc);
  arc.setAttribute('stroke-linecap', 'butt');
  svg.append(edge, track, arc);
  (options.container ?? doc.body).appendChild(svg);

  let state: 'idle' | 'filling' | 'selected' = 'idle';
  let shown = 0;
  let targetId: string | null = null;
  let observed: HTMLElement | null = null;
  let perimeter = 0;
  let selectedTimer: ReturnType<typeof setTimeout> | null = null;
  let frame: { kind: 'raf' | 'timeout'; id: number | ReturnType<typeof setTimeout> } | null = null;
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => measure()) : null;

  function applyMotion(): void {
    svg.setAttribute('data-reduced-motion', String(reduced));
    arc.style.transition = reduced ? 'none' : 'stroke-dashoffset 80ms linear';
    svg.style.transition = 'none';
  }

  function place(rect: ReadonlyArray<number>, border: number, radius: number): void {
    const [left, top, width, height] = rect as [number, number, number, number];
    const g = outlineGeometry({ width, height }, border, radius);
    svg.style.left = `${left}px`;
    svg.style.top = `${top}px`;
    svg.style.width = `${width}px`;
    svg.style.height = `${height}px`;
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    for (const [el, s] of [[edge, g.edge], [track, g.track], [arc, g.arc]] as const) {
      el.setAttribute('x', String(s.x));
      el.setAttribute('y', String(s.y));
      el.setAttribute('width', String(s.width));
      el.setAttribute('height', String(s.height));
      el.setAttribute('rx', String(s.radius));
      el.setAttribute('ry', String(s.radius));
      el.setAttribute('stroke-width', String(s.strokeWidth));
    }
    perimeter = g.arc.perimeter;
    arc.setAttribute('stroke-dasharray', String(perimeter));
    arc.setAttribute('stroke-dashoffset', String(perimeter * (1 - shown)));
  }

  function observe(el: HTMLElement | null): void {
    if (el === observed) return;
    if (observed) observer?.unobserve(observed);
    observed = el;
    if (el) observer?.observe(el);
  }

  /** Re-measure the element (or the registered rectangle) and redraw the three rects. */
  function measure(): void {
    if (state === 'idle' || targetId === null) return;
    const el = elementFor(targetId);
    observe(el);
    if (el) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      place([r.left, r.top, r.width, r.height], px(cs.borderTopWidth), px(cs.borderTopLeftRadius));
      return;
    }
    const info = planchette.getTargets().find((t) => t.id === targetId);
    if (info) place([info.rect.x, info.rect.y, info.rect.width, info.rect.height], 0, 0);
  }

  function render(): void {
    svg.setAttribute('data-state', state);
    svg.setAttribute('data-progress', String(shown));
    arc.setAttribute('stroke-dashoffset', String(perimeter * (1 - shown)));
    svg.style.display = state === 'idle' ? 'none' : '';
  }

  function cancelFrame(): void {
    if (frame === null) return;
    if (frame.kind === 'raf') cancelAnimationFrame(frame.id as number);
    else clearTimeout(frame.id as ReturnType<typeof setTimeout>);
    frame = null;
  }
  /** Re-measure in the next animation frame, after the page's own handlers have run. */
  function measureNextFrame(): void {
    if (frame !== null) return;
    const run = (): void => {
      frame = null;
      measure();
      render();
    };
    frame = typeof requestAnimationFrame === 'function' ? { kind: 'raf', id: requestAnimationFrame(run) } : { kind: 'timeout', id: setTimeout(run, 16) };
  }

  function clearSelected(): void {
    if (selectedTimer !== null) clearTimeout(selectedTimer);
    selectedTimer = null;
  }

  const onProgress = (e: Event): void => {
    const detail = (e as CustomEvent<{ targetId: string; progress: number }>).detail;
    if (state === 'selected' && detail.progress === 0) return; // keep the closed loop until it times out
    if (state === 'selected') clearSelected();
    targetId = detail.targetId;
    shown = shownProgress(detail.progress, reduced);
    state = detail.progress > 0 ? 'filling' : 'idle';
    measure();
    render();
  };
  const onSelect = (e: Event): void => {
    const detail = (e as CustomEvent<{ targetId: string; source: string }>).detail;
    if (detail.source === 'scan') return; // scanning has its own highlight
    clearSelected();
    targetId = detail.targetId;
    state = 'selected';
    shown = 1;
    measure();
    render();
    measureNextFrame();
    selectedTimer = setTimeout(() => {
      selectedTimer = null;
      state = 'idle';
      shown = 0;
      render();
    }, SELECTED_MS);
  };
  const onViewport = (): void => measureNextFrame();
  const onMediaChange = (): void => {
    reduced = media?.matches ?? reduced;
    applyMotion();
  };

  planchette.addEventListener('dwell-progress', onProgress);
  planchette.addEventListener('select', onSelect);
  window.addEventListener('resize', onViewport);
  window.addEventListener('scroll', onViewport, true);
  media?.addEventListener('change', onMediaChange);
  applyMotion();
  render();

  return {
    element: svg,
    destroy(): void {
      clearSelected();
      cancelFrame();
      planchette.removeEventListener('dwell-progress', onProgress);
      planchette.removeEventListener('select', onSelect);
      window.removeEventListener('resize', onViewport);
      window.removeEventListener('scroll', onViewport, true);
      media?.removeEventListener('change', onMediaChange);
      observer?.disconnect();
      observed = null;
      svg.remove();
    },
  };
}
