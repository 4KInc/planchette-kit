/**
 * scan-highlight.ts — shows the scan highlight on the page (Task 16.2, accessibility.md
 * Feedback). Purely visual: it listens to the public `highlight` event.
 *
 * Not colour alone: the highlighted element gets a thick (6 px) dark outline outside a
 * light ring, so the shape changes and it shows on light and dark pages, plus a fill
 * change (a tint over the element). A row highlights every item in it. The virtual
 * "Back" and "Cancel" items, which are not registered targets, are drawn in a small bar
 * of their own. There are no transitions, so prefers-reduced-motion needs nothing more.
 *
 * Nothing happens on import; `createScanHighlight` starts it.
 */
import type { Planchette, ScanHighlightKind } from '../api-types.js';
import { messages } from '../messages.js';

export interface ScanHighlightOptions {
  /**
   * The element of a target id. Default: the element with `data-planchette-target="<id>"`,
   * else the element with that id.
   */
  elementFor?: (targetId: string) => HTMLElement | null;
  /** Where the bar for the virtual Back and Cancel items goes. Default: document.body. */
  container?: HTMLElement;
}

export interface ScanHighlight {
  destroy(): void;
}

const OUTLINE = '6px solid #111';
const OUTLINE_OFFSET = '4px';
// The light ring sits in the outline offset; the inset shadow is the fill change.
const SHADOW = '0 0 0 4px #fff, inset 0 0 0 9999px rgba(255, 212, 0, 0.45)';

interface Saved {
  outline: string;
  outlineOffset: string;
  boxShadow: string;
}

function defaultElementFor(id: string): HTMLElement | null {
  const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&');
  return document.querySelector<HTMLElement>(`[data-planchette-target="${escaped}"]`) ?? document.getElementById(id);
}

export function createScanHighlight(planchette: Planchette, options: ScanHighlightOptions = {}): ScanHighlight {
  const elementFor = options.elementFor ?? defaultElementFor;
  const marked = new Map<HTMLElement, Saved>();

  const bar = document.createElement('div');
  bar.setAttribute('data-planchette', 'scan-virtual-item');
  // A labelled region, so the bar is not loose content outside the page's landmarks.
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', messages.scanItemLabel);
  bar.style.cssText =
    'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483645;display:none;' +
    'padding:16px 32px;font:bold 24px/1.2 system-ui,sans-serif;color:#111;background:#fff;border-radius:8px';
  (options.container ?? document.body).appendChild(bar);

  function mark(el: HTMLElement, kind: ScanHighlightKind): void {
    if (!marked.has(el)) marked.set(el, { outline: el.style.outline, outlineOffset: el.style.outlineOffset, boxShadow: el.style.boxShadow });
    el.setAttribute('data-planchette-highlight', kind);
    el.style.outline = OUTLINE;
    el.style.outlineOffset = OUTLINE_OFFSET;
    el.style.boxShadow = SHADOW;
  }

  function clear(): void {
    for (const [el, saved] of marked) {
      el.removeAttribute('data-planchette-highlight');
      el.style.outline = saved.outline;
      el.style.outlineOffset = saved.outlineOffset;
      el.style.boxShadow = saved.boxShadow;
    }
    marked.clear();
    bar.style.display = 'none';
    bar.textContent = '';
    bar.removeAttribute('data-planchette-highlight');
  }

  const onHighlight = (e: Event): void => {
    const { kind, targetIds } = (e as CustomEvent<{ kind: ScanHighlightKind; targetId: string; targetIds: string[] }>).detail;
    clear();
    if (kind === 'item' || kind === 'row') {
      for (const id of targetIds) {
        const el = elementFor(id);
        if (el !== null) mark(el, kind);
      }
    } else if (kind === 'back' || kind === 'cancel') {
      bar.textContent = kind === 'back' ? messages.scanBack : messages.scanCancel;
      bar.style.display = '';
      mark(bar, kind);
    }
    // 'none': scanning paused; nothing highlighted.
  };

  planchette.addEventListener('highlight', onHighlight);
  return {
    destroy(): void {
      planchette.removeEventListener('highlight', onHighlight);
      clear();
      bar.remove();
    },
  };
}
