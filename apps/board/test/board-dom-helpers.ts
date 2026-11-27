import type { Rect, TargetOptions } from '@planchette/skeleton';

/**
 * Shared test helpers for the board-dom grid tests: a fake Planchette host that records
 * registrations, and a getBoundingClientRect stub derived from each element's row / col.
 *
 * The real skeleton's registerTarget stores the rect it is given, and silently drops a rect
 * that is non-finite or has a non-positive width or height. jsdom reports an all-zero
 * getBoundingClientRect, which the real skeleton would reject, so the fake applies the same
 * rule.
 */
export class FakeHost extends EventTarget {
  registered = new Map<
    string,
    { rect: Rect; options: TargetOptions | undefined; label: string; row: string | undefined; col: string | undefined }
  >();
  profile = { targetSize: 96, targetSpacing: 16 };
  registerTarget(id: string, rect: Rect, options?: TargetOptions): void {
    if (!(rect.width > 0) || !(rect.height > 0)) return;
    const el = document.querySelector<HTMLElement>(`[data-planchette-target="${id}"]`);
    this.registered.set(id, {
      rect: { ...rect },
      options,
      label: el?.textContent ?? '',
      row: el?.dataset.row,
      col: el?.dataset.col,
    });
  }
  updateTarget(id: string, rect: Rect): void {
    const t = this.registered.get(id);
    if (t !== undefined && rect.width > 0 && rect.height > 0) t.rect = { ...rect };
  }
  unregisterTarget(id: string): void {
    this.registered.delete(id);
  }
  setScreen(): void {}
  getProfile() {
    return this.profile;
  }
  select(targetId: string): void {
    this.dispatchEvent(new CustomEvent('select', { detail: { targetId, now: performance.now(), source: 'mouse', role: 'default' } }));
  }
}

/**
 * A rect from the element's data-row / data-col, with the given size and gap; a hidden grid
 * has a zero rect, as in a browser. The letter grid is offset by 1000px vertically.
 */
export function stubRectWith(el: HTMLElement, size: number, gap: number): DOMRect {
  const row = el.dataset.row;
  const col = el.dataset.col;
  const inLetters = el.closest('#letter-grid') !== null;
  if (el.closest('[hidden]') !== null) return new DOMRect(0, 0, 0, 0);
  // Phrases view: 2 columns of 416px, offset by 2000px vertically.
  if (el.closest('#phrases-grid') !== null && row !== undefined && col !== undefined) {
    return new DOMRect(Number(col) * (416 + gap), 2000 + Number(row) * (size + gap), 416, size);
  }
  if (row === undefined || col === undefined) return new DOMRect(5000, 0, size, size); // action targets
  return new DOMRect(Number(col) * (size + gap), (inLetters ? 1000 : 0) + Number(row) * (size + gap), size, size);
}

/**
 * jsdom has no `showModal` / `close` on `<dialog>`. This stub sets and clears `open` and fires
 * `close` (as the browser does after Escape or `close()`). `escape()` mimics the Escape key:
 * a `cancel` event, then close. The real focus trap and Escape handling are checked in Playwright.
 */
export function installDialogStub(): { escape(dialog: HTMLDialogElement): void } {
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  return {
    escape(dialog) {
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
      dialog.close();
    },
  };
}
