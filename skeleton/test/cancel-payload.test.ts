/**
 * The cancel payload `{ now, targetId? }` per source, and backward compatibility (Req 9 AC 5, 6).
 */
import { describe, expect, it } from 'vitest';
import { FULL, harness } from './harness';
const JAW_ON = { jawOpen: 0.9, browRaise: 0 };
const JAW_OFF = { jawOpen: 0, browRaise: 0 };
const BOX = { x: 0, y: 0, width: 100, height: 100 };
function scanUntil(h: ReturnType<typeof harness>, match: (d: { kind: string; targetId: string }) => boolean): boolean {
  for (let i = 0; i < 3000; i++) {
    const last = h.of('highlight').at(-1);
    if (last !== undefined && match(last)) return true;
    h.tick('keyboard', 1);
  }
  return false;
}
function press(h: ReturnType<typeof harness>): void {
  h.tick('keyboard', 5, { signal: true });
  h.tick('keyboard', 2, { signal: false });
}
function expectNoTargetId(detail: object): void {
  expect(Object.keys(detail)).toEqual(['now']);
}
describe('cancel payload per source (Req 9 AC 5)', () => {
  it('dwell on a cancel-role target: { targetId, now }', () => {
    const h = harness({ mode: 'head + dwell', dwellTime: 1000 });
    h.p.registerTarget('c', FULL, { role: 'cancel' });
    h.settle();
    h.clear();
    h.cam(80);
    expect(h.of('cancel')).toEqual([{ targetId: 'c', now: expect.any(Number) }]);
  });
  it('scan virtual cancel item: { now } with no targetId key', () => {
    const h = harness({ mode: 'scan', cancelByHold: false, scanInterval: 400, postSelectionPause: 200 });
    h.p.registerTarget('a', BOX);
    expect(scanUntil(h, (d) => d.kind === 'cancel')).toBe(true);
    h.clear();
    press(h);
    const c = h.of('cancel');
    expect(c).toHaveLength(1);
    expectNoTargetId(c[0]);
    expect(typeof c[0].now).toBe('number');
  });
  it('cancel-role item selected as an ordinary scan item: { targetId, now }', () => {
    const h = harness({ mode: 'scan', cancelByHold: false, scanInterval: 400, postSelectionPause: 200 });
    h.p.registerTarget('a', BOX);
    h.p.registerTarget('x', { x: 0, y: 200, width: 100, height: 100 }, { role: 'cancel' });
    expect(scanUntil(h, (d) => d.targetId === 'x')).toBe(true);
    h.clear();
    press(h);
    expect(h.of('cancel')).toEqual([{ targetId: 'x', now: expect.any(Number) }]);
  });
  it('Escape (cancel: true sample): { now } with no targetId key', () => {
    const h = harness({ mode: 'mouse' });
    h.p.registerTarget('a', BOX);
    h.tick('keyboard', 1, { cancel: true });
    const c = h.of('cancel');
    expect(c).toHaveLength(1);
    expectNoTargetId(c[0]);
  });
  it('hold-to-cancel from a switch: { now }', () => {
    const h = harness({ mode: 'scan', cancelByHold: true, cancelHoldTime: 1000, scanInterval: 400 });
    h.p.registerTarget('a', BOX);
    h.tick('keyboard', 3);
    h.tick('keyboard', 80, { signal: true });
    h.tick('keyboard', 5, { signal: false });
    const c = h.of('cancel');
    expect(c).toHaveLength(1);
    expectNoTargetId(c[0]);
  });
  it('hold-to-cancel from a gesture: { now }', () => {
    const h = harness({ mode: 'head + gesture', cancelByHold: true, cancelHoldTime: 1000 });
    h.p.registerTarget('a', FULL);
    h.settle();
    h.clear();
    h.cam(80, 0, 0, JAW_ON);
    h.cam(5, 0, 0, JAW_OFF);
    const c = h.of('cancel');
    expect(c).toHaveLength(1);
    expectNoTargetId(c[0]);
  });
});
describe('backward compatibility (Req 9 AC 6)', () => {
  it('a listener that ignores the payload is called once per cancel and does not throw', () => {
    const h = harness({ mode: 'head + dwell', dwellTime: 1000 });
    let calls = 0;
    h.p.addEventListener('cancel', () => {
      calls++;
    });
    h.p.registerTarget('c', FULL, { role: 'cancel' });
    h.settle();
    expect(() => h.cam(80)).not.toThrow();
    expect(calls).toBe(1);
    expect(() => h.tick('keyboard', 1, { cancel: true })).not.toThrow();
    expect(calls).toBe(2);
  });
});
