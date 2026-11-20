/**
 * Every cancel path, end to end through createPlanchette and feedSamples (Req 6, Task 10):
 *  1. a cancel target selected by dwell, by gesture and by mouse click
 *  2. the scan's cancel item, and a cancel-role target scanned as an ordinary item
 *  3. hold-to-cancel on a switch and on a gesture
 *  4. the Escape key (`cancel: true`)
 *  5. the input-timeout reset
 * plus the undo target (Req 6 AC 5), which selects like any other target.
 */
import { describe, expect, it } from 'vitest';
import { PressState } from '../src/engine/press-machine';
import { FULL, harness } from './harness';

type H = ReturnType<typeof harness>;

const JAW_ON = { jawOpen: 0.9, browRaise: 0 };
const JAW_OFF = { jawOpen: 0, browRaise: 0 };

/** Tick the keyboard until the latest highlight has this kind (or id); returns false if it never does. */
function scanUntil(h: H, match: (d: { kind: string; targetId: string }) => boolean): boolean {
  for (let i = 0; i < 3000; i++) {
    const last = h.of('highlight').at(-1);
    if (last !== undefined && match(last)) return true;
    h.tick('keyboard', 1);
  }
  return false;
}

/** A press: held for 5 ticks, released. */
function press(h: H, source: 'keyboard' | 'mouse' | 'gamepad' | 'synthetic' = 'keyboard'): void {
  h.tick(source, 5, { signal: true });
  h.tick(source, 2, { signal: false });
}

describe('dwell on a cancel target (Req 6 AC 1, Task 10.1)', () => {
  function dwellHarness(extra: Record<string, unknown> = {}) {
    const h = harness({ mode: 'head + dwell', dwellTime: 1000, ...extra });
    h.p.registerTarget('cancel', FULL, { role: 'cancel' });
    h.settle();
    h.clear();
    return h;
  }

  it('emits cancel, not select, when the dwell time is reached', () => {
    const h = dwellHarness();
    h.cam(80);
    expect(h.of('cancel')).toEqual([{}]);
    expect(h.of('select')).toEqual([]);
  });

  it('fills the dwell ring first, then cancels', () => {
    const h = dwellHarness();
    h.cam(80);
    const types = h.log.map((l) => l.type);
    const full = h.log.findIndex((l) => l.type === 'dwell-progress' && (l.detail as { progress: number }).progress === 1);
    expect(full).toBeGreaterThan(-1);
    expect(types.indexOf('cancel')).toBeGreaterThan(full);
  });

  it('cancels once per stay: resting on the target does not cancel again', () => {
    const h = dwellHarness();
    h.cam(600); // 9.6 s
    expect(h.of('cancel')).toHaveLength(1);
  });

  it('ignores autoRepeat on a cancel target (it reads back as false)', () => {
    const h = harness({ mode: 'head + dwell', dwellTime: 1000, autoRepeatInterval: 500 });
    h.p.registerTarget('cancel', FULL, { role: 'cancel', autoRepeat: true });
    expect(h.p.getTargets()[0].autoRepeat).toBe(false);
    h.settle();
    h.clear();
    h.cam(600);
    expect(h.of('cancel')).toHaveLength(1);
  });

  it('autoRepeat still repeats the selection of an ordinary target', () => {
    const h = harness({ mode: 'head + dwell', dwellTime: 1000, autoRepeatInterval: 500, postSelectionPause: 200 });
    h.p.registerTarget('a', FULL, { autoRepeat: true });
    h.settle();
    h.clear();
    h.cam(300);
    expect(h.of('select').length).toBeGreaterThan(2);
    expect(h.of('cancel')).toEqual([]);
  });

  it('cancels again after the pointer leaves the target and comes back', () => {
    const h = harness({ mode: 'head + dwell', dwellTime: 1000 });
    h.p.registerTarget('cancel', { x: 0, y: 0, width: 1000, height: 400 }, { role: 'cancel' });
    h.settle();
    h.clear();
    h.cam(80, 0, 10); // up: on the target
    h.cam(40, 0, -10); // down: off it
    h.cam(80, 0, 10);
    expect(h.of('cancel')).toHaveLength(2);
  });

  it('returns the other engines to idle: a switch held at the time must be released first', () => {
    const h = harness({ mode: 'head + dwell', dwellTime: 1000, cancelByHold: false });
    h.p.registerTarget('cancel', FULL, { role: 'cancel' });
    h.settle();
    h.tick('keyboard', 3, { signal: true });
    h.cam(80);
    expect(h.of('cancel')).toHaveLength(1);
    expect(h.inspect().switches.keyboard).toBe(PressState.COOLDOWN);
  });

  it('a cancel target does not select, and an ordinary target next to it still selects', () => {
    const h = harness({ mode: 'head + dwell', dwellTime: 1000 });
    h.p.registerTarget('cancel', { x: 0, y: 0, width: 500, height: 800 }, { role: 'cancel' });
    h.p.registerTarget('ok', { x: 500, y: 0, width: 500, height: 800 });
    h.settle();
    h.clear();
    h.cam(80, 10, 0);
    expect(h.of('select')).toHaveLength(1);
    expect(h.of('select')[0]).toMatchObject({ targetId: 'ok' });
    expect(h.of('cancel')).toEqual([]);
  });

  it('is held during calibration like any other selection', () => {
    const h = dwellHarness();
    h.p.startCalibration();
    h.cam(200);
    expect(h.of('cancel')).toEqual([]);
  });
});

describe('gesture and mouse on a cancel target', () => {
  it('head + gesture: a gesture on a cancel target cancels and selects nothing', () => {
    const h = harness({ mode: 'head + gesture', cancelByHold: true });
    h.p.registerTarget('cancel', FULL, { role: 'cancel' });
    h.settle();
    h.clear();
    h.cam(10, 0, 0, JAW_OFF);
    h.cam(30, 0, 0, JAW_ON); // 480 ms
    h.cam(3, 0, 0, JAW_OFF); // released: the press counts
    expect(h.of('cancel')).toHaveLength(1);
    expect(h.of('select')).toEqual([]);
  });

  it('mouse: a click on a cancel target cancels', () => {
    const h = harness({ mode: 'mouse', cancelByHold: false });
    h.p.registerTarget('cancel', { x: 0, y: 0, width: 100, height: 100 }, { role: 'cancel' });
    h.tick('mouse', 2, { pointer: { x: 50, y: 50 } });
    h.tick('mouse', 5, { pointer: { x: 50, y: 50 }, signal: true });
    h.tick('mouse', 2, { pointer: { x: 50, y: 50 }, signal: false });
    expect(h.of('cancel')).toHaveLength(1);
    expect(h.of('select')).toEqual([]);
  });
});

describe('scan: the cancel item and cancel-role targets (Req 6 AC 1, Task 10.2)', () => {
  function scanHarness() {
    const h = harness({ mode: 'scan', cancelByHold: false, scanInterval: 400, postSelectionPause: 200 });
    h.p.registerTarget('a', { x: 0, y: 0, width: 100, height: 100 });
    h.p.registerTarget('b', { x: 0, y: 200, width: 100, height: 100 });
    return h;
  }

  it('a press on the cancel item cancels, selects nothing and returns to the top of the cycle', () => {
    const h = scanHarness();
    expect(scanUntil(h, (d) => d.kind === 'cancel')).toBe(true);
    expect(h.of('highlight').at(-1)).toMatchObject({ kind: 'cancel', targetId: '$cancel' });
    h.clear();
    press(h);
    expect(h.of('cancel')).toEqual([{}]);
    expect(h.of('select')).toEqual([]);
    expect(h.of('highlight').at(-1)).toMatchObject({ kind: 'item', targetId: 'a' });
  });

  it('the press that cancelled stays spent while the key is held: it must be released first', () => {
    const h = scanHarness();
    expect(scanUntil(h, (d) => d.kind === 'cancel')).toBe(true);
    h.tick('keyboard', 5, { signal: true }); // acceptance 0 and cancel-by-hold off: counts at once
    expect(h.of('cancel')).toHaveLength(1);
    expect(h.inspect().switches.keyboard).toBe(PressState.COOLDOWN);
    h.tick('keyboard', 2, { signal: false });
    expect(h.inspect().switches.keyboard).toBe(PressState.IDLE);
  });

  it('a cancel-role target registered as an ordinary scan item cancels when pressed', () => {
    const h = harness({ mode: 'scan', cancelByHold: false, scanInterval: 400, postSelectionPause: 200 });
    h.p.registerTarget('a', { x: 0, y: 0, width: 100, height: 100 });
    h.p.registerTarget('x', { x: 0, y: 200, width: 100, height: 100 }, { role: 'cancel' });
    expect(scanUntil(h, (d) => d.targetId === 'x')).toBe(true);
    h.clear();
    press(h);
    expect(h.of('cancel')).toEqual([{}]);
    expect(h.of('select')).toEqual([]);
    expect(h.of('highlight').at(-1)).toMatchObject({ targetId: 'a' });
  });

  it('the same two paths work from a gesture in gesture scan mode', () => {
    const h = harness({ mode: 'gesture scan', cancelByHold: false, scanInterval: 400, postSelectionPause: 200 });
    h.p.registerTarget('a', { x: 0, y: 0, width: 100, height: 100 });
    h.settle();
    h.clear();
    for (let i = 0; i < 3000 && h.of('highlight').at(-1)?.kind !== 'cancel'; i++) h.cam(1, 0, 0, JAW_OFF);
    h.clear();
    h.cam(30, 0, 0, JAW_ON);
    h.cam(3, 0, 0, JAW_OFF);
    expect(h.of('cancel')).toHaveLength(1);
    expect(h.of('select')).toEqual([]);
  });

  it('an ordinary press on an ordinary item still selects (the cancel changes are not too wide)', () => {
    const h = scanHarness();
    expect(scanUntil(h, (d) => d.targetId === 'b')).toBe(true);
    h.clear();
    press(h);
    expect(h.of('select')).toEqual([{ targetId: 'b', now: expect.any(Number), source: 'scan', role: 'default' }]);
    expect(h.of('cancel')).toEqual([]);
  });
});

describe('hold-to-cancel (Req 6 AC 2, 3, Task 10.3)', () => {
  it('switch: held to the cancel hold time cancels and counts no press, even on release', () => {
    const h = harness({ mode: 'scan', cancelByHold: true, cancelHoldTime: 1000, scanInterval: 400 });
    h.p.registerTarget('a', { x: 0, y: 0, width: 100, height: 100 });
    h.tick('keyboard', 3);
    h.tick('keyboard', 80, { signal: true }); // 1280 ms
    h.tick('keyboard', 5, { signal: false });
    expect(h.of('cancel')).toHaveLength(1);
    expect(h.of('select')).toEqual([]);
  });

  it('switch: a press released before the cancel hold time selects on release', () => {
    const h = harness({ mode: 'scan', cancelByHold: true, cancelHoldTime: 1000, scanInterval: 2000 });
    h.p.registerTarget('a', { x: 0, y: 0, width: 100, height: 100 });
    h.tick('keyboard', 3);
    h.tick('keyboard', 30, { signal: true }); // 480 ms
    expect(h.of('select')).toEqual([]);
    h.tick('keyboard', 2, { signal: false });
    expect(h.of('select')).toHaveLength(1);
    expect(h.of('cancel')).toEqual([]);
  });

  it('switch: with cancel-by-hold off a long hold is a press, never a cancel', () => {
    const h = harness({ mode: 'scan', cancelByHold: false, cancelHoldTime: 1000, scanInterval: 400 });
    h.p.registerTarget('a', { x: 0, y: 0, width: 100, height: 100 });
    h.tick('keyboard', 3);
    h.tick('keyboard', 150, { signal: true }); // 2400 ms
    h.tick('keyboard', 2, { signal: false });
    expect(h.of('cancel')).toEqual([]);
    expect(h.of('select')).toHaveLength(1);
  });

  it('switch: works from every switch source', () => {
    for (const source of ['keyboard', 'mouse', 'gamepad', 'synthetic'] as const) {
      const h = harness({ mode: 'scan', cancelByHold: true, cancelHoldTime: 1000 });
      h.p.registerTarget('a', { x: 0, y: 0, width: 100, height: 100 });
      h.tick(source, 3);
      h.tick(source, 80, { signal: true });
      expect(h.of('cancel'), source).toHaveLength(1);
      expect(h.of('select'), source).toEqual([]);
    }
  });

  it('switch: cancel-by-hold also works in head modes (a cancel input exists in every mode)', () => {
    for (const mode of ['head + dwell', 'head + gesture', 'gesture scan', 'mouse'] as const) {
      const h = harness({ mode, cancelByHold: true, cancelHoldTime: 1000 });
      h.tick('keyboard', 3);
      h.tick('keyboard', 80, { signal: true });
      expect(h.of('cancel'), mode).toHaveLength(1);
    }
  });

  it('switch: after the cancel the key must be released before it can press again', () => {
    const h = harness({ mode: 'scan', cancelByHold: true, cancelHoldTime: 1000, scanInterval: 400 });
    h.p.registerTarget('a', { x: 0, y: 0, width: 100, height: 100 });
    h.tick('keyboard', 3);
    h.tick('keyboard', 80, { signal: true });
    h.tick('keyboard', 80, { signal: true }); // still held after the cancel
    h.tick('keyboard', 2, { signal: false });
    expect(h.of('cancel')).toHaveLength(1);
    expect(h.of('select')).toEqual([]);
  });

  it('gesture: held to the cancel hold time cancels and counts no press', () => {
    const h = harness({ mode: 'gesture scan', cancelByHold: true, cancelHoldTime: 1000, scanInterval: 400 });
    h.p.registerTarget('a', { x: 0, y: 0, width: 100, height: 100 });
    h.settle();
    h.clear();
    h.cam(80, 0, 0, JAW_ON); // 1280 ms
    h.cam(5, 0, 0, JAW_OFF);
    expect(h.of('cancel')).toHaveLength(1);
    expect(h.of('select')).toEqual([]);
  });

  it('gesture: in head + gesture mode too', () => {
    const h = harness({ mode: 'head + gesture', cancelByHold: true, cancelHoldTime: 1000 });
    h.p.registerTarget('a', FULL);
    h.settle();
    h.clear();
    h.cam(80, 0, 0, JAW_ON);
    h.cam(5, 0, 0, JAW_OFF);
    expect(h.of('cancel')).toHaveLength(1);
    expect(h.of('select')).toEqual([]);
  });

  it('gesture: a face lost during the hold gives neither a cancel nor a press', () => {
    const h = harness({ mode: 'head + gesture', cancelByHold: true, cancelHoldTime: 1000 });
    h.p.registerTarget('a', FULL);
    h.settle();
    h.clear();
    h.cam(30, 0, 0, JAW_ON);
    h.noFace(80);
    h.cam(5, 0, 0, JAW_OFF);
    expect(h.of('cancel')).toEqual([]);
    expect(h.of('select')).toEqual([]);
  });
});

describe('the Escape key (Req 6 AC 1, 4)', () => {
  const MODES = ['head + dwell', 'head + gesture', 'scan', 'gesture scan', 'mouse'] as const;

  it('cancel: true emits exactly one cancel in every mode', () => {
    for (const mode of MODES) {
      const h = harness({ mode });
      h.p.registerTarget('a', FULL);
      h.tick('keyboard', 1, { cancel: true });
      expect(h.of('cancel'), mode).toHaveLength(1);
    }
  });

  it('works from every source, and as the only content of a sample', () => {
    for (const source of ['keyboard', 'mouse', 'gamepad', 'synthetic', 'camera'] as const) {
      const h = harness();
      h.p.feedSamples([{ now: 10, source, cancel: true }]);
      expect(h.of('cancel'), source).toHaveLength(1);
    }
  });

  it('ends a dwell stay in progress, so it does not select afterwards', () => {
    const h = harness({ mode: 'head + dwell', dwellTime: 1000 });
    h.p.registerTarget('a', FULL);
    h.settle();
    h.cam(40); // 640 ms into the stay
    h.tick('keyboard', 1, { cancel: true });
    expect(h.of('dwell-progress').at(-1)).toEqual({ targetId: 'a', progress: 0 });
    h.clear();
    h.cam(30); // a new stay needs the full dwell time again
    expect(h.of('select')).toEqual([]);
  });

  it('returns scanning to the top of the cycle', () => {
    const h = harness({ mode: 'scan', scanInterval: 300 });
    h.p.registerTarget('a', { x: 0, y: 0, width: 10, height: 10 });
    h.p.registerTarget('b', { x: 0, y: 100, width: 10, height: 10 });
    expect(scanUntil(h, (d) => d.targetId === 'b')).toBe(true);
    h.tick('keyboard', 1, { cancel: true });
    h.clear();
    h.tick('keyboard', 1);
    expect(h.of('highlight').at(-1)).toMatchObject({ targetId: 'a' });
  });

  it('cancels a switch press in progress: it does not select when released', () => {
    const h = harness({ mode: 'scan', cancelByHold: true, scanInterval: 400 });
    h.p.registerTarget('a', { x: 0, y: 0, width: 10, height: 10 });
    h.tick('keyboard', 3);
    h.tick('keyboard', 10, { signal: true });
    h.p.feedSamples([{ now: h.clock.synthetic + 16, source: 'synthetic', cancel: true }]);
    h.tick('keyboard', 3, { signal: false });
    expect(h.of('cancel')).toHaveLength(1);
    expect(h.of('select')).toEqual([]);
  });

  it('cancels a gesture in progress: it does not select when it ends', () => {
    const h = harness({ mode: 'head + gesture', cancelByHold: true });
    h.p.registerTarget('a', FULL);
    h.settle();
    h.clear();
    h.cam(10, 0, 0, JAW_OFF);
    h.cam(20, 0, 0, JAW_ON);
    h.tick('keyboard', 1, { cancel: true });
    h.cam(10, 0, 0, JAW_ON);
    h.cam(3, 0, 0, JAW_OFF);
    expect(h.of('select')).toEqual([]);
    expect(h.of('cancel')).toHaveLength(1);
  });

  it('works while the camera never started and while the face is lost', () => {
    const h = harness({ mode: 'head + dwell' });
    h.tick('keyboard', 1, { cancel: true });
    h.noFace(5);
    h.tick('keyboard', 1, { cancel: true });
    expect(h.of('cancel')).toHaveLength(2);
  });

  it('is not held back by a calibration run', () => {
    const h = harness();
    h.p.startCalibration();
    h.cam(5);
    h.tick('keyboard', 1, { cancel: true });
    expect(h.of('cancel')).toHaveLength(1);
  });
});

describe('the input-timeout reset (Req 6 AC 6, Task 10.4)', () => {
  it('a dwell stay ends after the input timeout, with no select and no cancel', () => {
    const h = harness({ mode: 'head + dwell', dwellTime: 1000, inputTimeout: 2000 });
    h.p.registerTarget('a', FULL);
    h.settle();
    h.cam(40); // 640 ms into the stay
    h.clear();
    h.clock.camera += 2100; // silence
    h.cam(40); // a new stay: needs the full dwell time again
    expect(h.of('select')).toEqual([]);
    expect(h.of('cancel')).toEqual([]);
    expect(h.of('dwell-progress')[0]).toEqual({ targetId: 'a', progress: 0 });
    h.cam(40);
    expect(h.of('select')).toHaveLength(1);
  });

  it('a switch held when the input stops does not press when it starts again', () => {
    const h = harness({ mode: 'scan', cancelByHold: false, inputTimeout: 2000, scanInterval: 400 });
    h.p.registerTarget('a', { x: 0, y: 0, width: 10, height: 10 });
    h.tick('keyboard', 3);
    h.tick('keyboard', 1, { signal: true }); // acceptance 0: with cancel-by-hold off this presses at once
    h.clear();
    h.clock.keyboard += 2100;
    h.tick('keyboard', 1, { signal: false });
    expect(h.of('cancel')).toEqual([]);
    expect(h.inspect().switches.keyboard).toBe(PressState.IDLE);
  });

  it('scanning returns to the top of the cycle', () => {
    const h = harness({ mode: 'scan', inputTimeout: 2000, scanInterval: 300 });
    h.p.registerTarget('a', { x: 0, y: 0, width: 10, height: 10 });
    h.p.registerTarget('b', { x: 0, y: 100, width: 10, height: 10 });
    expect(scanUntil(h, (d) => d.targetId === 'b')).toBe(true);
    h.clock.keyboard += 2100;
    h.clear();
    h.tick('keyboard', 1);
    expect(h.of('highlight').at(-1)).toMatchObject({ targetId: 'a' });
    expect(h.of('cancel')).toEqual([]);
  });

  it('a gesture held when the camera stops does not press afterwards', () => {
    const h = harness({ mode: 'head + gesture', cancelByHold: true, inputTimeout: 2000 });
    h.p.registerTarget('a', FULL);
    h.settle();
    h.cam(20, 0, 0, JAW_ON);
    h.clear();
    h.clock.camera += 2100;
    h.cam(5, 0, 0, JAW_OFF);
    expect(h.of('select')).toEqual([]);
    expect(h.of('cancel')).toEqual([]);
  });
});

describe('the undo target (Req 6 AC 5)', () => {
  it('is selected by dwell, by gesture and by scanning, with role undo', () => {
    const dwell = harness({ mode: 'head + dwell', dwellTime: 1000 });
    dwell.p.registerTarget('undo', FULL, { role: 'undo' });
    dwell.settle();
    dwell.clear();
    dwell.cam(80);
    expect(dwell.of('select')).toEqual([{ targetId: 'undo', now: expect.any(Number), source: 'dwell', role: 'undo' }]);

    const gesture = harness({ mode: 'head + gesture', cancelByHold: true });
    gesture.p.registerTarget('undo', FULL, { role: 'undo' });
    gesture.settle();
    gesture.clear();
    gesture.cam(30, 0, 0, JAW_ON);
    gesture.cam(3, 0, 0, JAW_OFF);
    expect(gesture.of('select')).toEqual([{ targetId: 'undo', now: expect.any(Number), source: 'gesture', role: 'undo' }]);

    const scan = harness({ mode: 'scan', cancelByHold: false, scanInterval: 400 });
    scan.p.registerTarget('undo', { x: 0, y: 0, width: 10, height: 10 }, { role: 'undo' });
    expect(scanUntil(scan, (d) => d.targetId === 'undo')).toBe(true);
    scan.clear();
    press(scan);
    expect(scan.of('select')).toEqual([{ targetId: 'undo', now: expect.any(Number), source: 'scan', role: 'undo' }]);
    expect(scan.of('cancel')).toEqual([]);
  });
});
