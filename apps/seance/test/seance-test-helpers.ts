import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { InputMode, Rect, TargetOptions } from '@planchette/skeleton';
import { vi } from 'vitest';
import type { SeanceHost } from '../src/seance-dom';
const html = readFileSync(resolve(import.meta.dirname, '../../../seance/index.html'), 'utf8');
export const bodyHtml = /<body>([\s\S]*)<\/body>/.exec(html)![1]!.replace(/<script[\s\S]*?<\/script>/g, '');
const CELL_W = (848 - 6 * 16) / 7;
const SIDE: Record<string, [number, number]> = {
  'suggest-apply': [876, 8],
  'suggest-dismiss': [1041, 8],
  stop: [876, 120],
  undo: [1041, 120],
  cancel: [1205, 120],
  'camera-toggle': [876, 232],
  'sound-toggle': [1041, 232],
  'rest-area': [1205, 232],
};
/** The rectangle the real page gives each target at 1366x768 with the default sizes (checked in a browser). */
export function expectedRect(el: HTMLElement): Rect {
  const id = el.dataset.planchetteTarget ?? '';
  if (id in SIDE) return { x: SIDE[id]![0], y: SIDE[id]![1], width: 148.7, height: 96 };
  const inSummary = el.closest('#summary') !== null;
  const row = inSummary ? 5 : Number(el.dataset.row ?? 0);
  const col = id === 'carry-dwell' ? 0 : id === 'next-round' ? 4 : Number(el.dataset.col ?? 0);
  const span = id === 'carry-dwell' || id === 'next-round' ? 3 : Number(el.dataset.span ?? 1);
  return { x: 12 + col * (CELL_W + 16), y: 104 + row * 112, width: span * CELL_W + (span - 1) * 16, height: 96 };
}
/** jsdom has no layout: give every element the rectangle the real page gives it. Hidden ones get zero. */
export function stubLayout(): void {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    if (this.closest('[hidden]') !== null || this.dataset.planchetteTarget === undefined) return new DOMRect(0, 0, 0, 0);
    const r = expectedRect(this);
    return new DOMRect(r.x, r.y, r.width, r.height);
  };
}
export function installDialogStub(): void {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}
/** A fake Planchette host: records registrations (dropping empty rects as the real one does) and can emit events. */
export class FakeHost extends EventTarget {
  registered = new Map<string, { rect: Rect; options: TargetOptions | undefined }>();
  /** Every rectangle ever given to the host, by id (register and update). */
  history: Array<{ id: string; rect: Rect }> = [];
  profile = { mode: 'mouse' as InputMode, dwellTime: 2100, startCameraOnLoad: false, targetSize: 96, targetSpacing: 16 };
  setProfile = vi.fn((p: Partial<typeof this.profile>) => void Object.assign(this.profile, p));
  startCamera = vi.fn(() => Promise.resolve());
  registerTarget(id: string, rect: Rect, options?: TargetOptions): void {
    if (!(rect.width > 0) || !(rect.height > 0)) return;
    this.registered.set(id, { rect: { ...rect }, options });
    this.history.push({ id, rect: { ...rect } });
  }
  updateTarget(id: string, rect: Rect): void {
    const t = this.registered.get(id);
    if (t === undefined || !(rect.width > 0) || !(rect.height > 0)) return;
    t.rect = { ...rect };
    this.history.push({ id, rect: { ...rect } });
  }
  unregisterTarget(id: string): void {
    this.registered.delete(id);
  }
  setScreen = vi.fn();
  stopCamera = vi.fn();
  setMode = vi.fn((m: InputMode) => {
    this.profile.mode = m;
    this.emit('mode-change', { mode: m });
  });
  startCalibration = vi.fn();
  getTargets(): never[] {
    return [];
  }
  exportProfile(): string {
    return JSON.stringify(this.profile);
  }
  getProfile() {
    return this.profile;
  }
  emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
  select(targetId: string, now: number): void {
    this.emit('select', { targetId, now, source: 'mouse', role: 'default' });
  }
  asHost(): SeanceHost {
    return this as unknown as SeanceHost;
  }
}
/** The Board-target id of each Step of a Message text, for example 'MO' -> letter-m, letter-o; 'YES' -> yes. */
export function stepsOf(text: string): string[] {
  if (text === 'YES' || text === 'NO' || text === 'GOODBYE') return [text.toLowerCase()];
  return [...text].map((c) => `letter-${c.toLowerCase()}`);
}
