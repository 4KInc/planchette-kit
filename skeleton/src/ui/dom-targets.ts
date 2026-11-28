/**
 * dom-targets.ts: registering page elements as Planchette targets (moved here from the Board's
 * board-dom.ts, where `rectOf` and the role lookup lived). An element is a target when it has
 * `data-planchette-target="<id>"`; its optional `data-role` ("cancel", "undo", "rest-area" or
 * "default") becomes the target's role. Nothing happens on import.
 */
import type { Planchette, Rect, TargetRole } from '../api-types.js';
const ROLES: ReadonlySet<string> = new Set<TargetRole>(['default', 'cancel', 'undo', 'rest-area']);
/** The element's rectangle in the viewport, as a Planchette `Rect`. */
export function elementRect(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}
/** The registration options for an element's `data-role`, or `undefined` when it has none (or an unknown one). */
export function roleOptionsOf(el: HTMLElement): { role: TargetRole } | undefined {
  const role = el.dataset.role;
  return role !== undefined && ROLES.has(role) ? { role: role as TargetRole } : undefined;
}
export type TargetHost = Pick<Planchette, 'registerTarget' | 'updateTarget' | 'unregisterTarget'>;
export interface TargetRegistry {
  /** Registers the element under its `data-planchette-target` id and returns that rectangle. */
  register(el: HTMLElement): Rect;
  /** Unregisters the element; does nothing if it is not registered. */
  unregister(el: HTMLElement): void;
  /** Re-measures every registered element and calls `updateTarget` (after a resize or a layout change). */
  update(): void;
  /** True when the id is registered. */
  has(id: string): boolean;
  /** The rectangle each registered id was last given. */
  rects(): ReadonlyMap<string, Rect>;
}
export function createTargetRegistry(host: TargetHost): TargetRegistry {
  const elements = new Map<string, HTMLElement>();
  const last = new Map<string, Rect>();
  const idOf = (el: HTMLElement): string => {
    const id = el.dataset.planchetteTarget;
    if (id === undefined || id === '') throw new Error('target registry: the element has no data-planchette-target id');
    return id;
  };
  return {
    register(el) {
      const id = idOf(el);
      const rect = elementRect(el);
      host.registerTarget(id, rect, roleOptionsOf(el));
      elements.set(id, el);
      last.set(id, rect);
      return rect;
    },
    unregister(el) {
      const id = idOf(el);
      last.delete(id);
      if (elements.delete(id)) host.unregisterTarget(id);
    },
    update() {
      for (const [id, el] of elements) {
        const rect = elementRect(el);
        host.updateTarget(id, rect);
        last.set(id, rect);
      }
    },
    has: (id) => elements.has(id),
    rects: () => last,
  };
}
