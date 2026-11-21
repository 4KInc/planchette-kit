import { describe, it, expect } from 'vitest';
import { messages } from '../src/messages';
import { createPlanchette } from '../src/index';
import { PressState } from '../src/engine/press-machine';
import { FULL, harness } from './harness';

describe('targets (Req 1 AC 1, 4)', () => {
  it('registers, reads, updates and unregisters targets by id', () => {
    const { p } = harness();
    p.registerTarget('a', { x: 0, y: 0, width: 100, height: 50 });
    p.registerTarget('b', { x: 200, y: 0, width: 100, height: 50 }, { autoRepeat: true, role: 'undo' });
    expect(p.getTargets()).toEqual([
      { id: 'a', rect: { x: 0, y: 0, width: 100, height: 50 }, autoRepeat: false, role: 'default' },
      { id: 'b', rect: { x: 200, y: 0, width: 100, height: 50 }, autoRepeat: true, role: 'undo' },
    ]);
    p.updateTarget('a', { x: 10, y: 20, width: 30, height: 40 });
    expect(p.getTargets()[0].rect).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    p.unregisterTarget('a');
    expect(p.getTargets().map((t) => t.id)).toEqual(['b']);
  });

  it('getTargets is serialisable and returns copies', () => {
    const { p } = harness();
    p.registerTarget('a', { x: 0, y: 0, width: 100, height: 50 });
    const t = p.getTargets();
    expect(JSON.parse(JSON.stringify(t))).toEqual(t);
    (t[0].rect as { x: number }).x = 999;
    expect(p.getTargets()[0].rect.x).toBe(0);
  });

  it('copies the rectangle it is given', () => {
    const { p } = harness();
    const r = { x: 0, y: 0, width: 100, height: 50 };
    p.registerTarget('a', r);
    r.x = 500;
    expect(p.getTargets()[0].rect.x).toBe(0);
  });

  it('registering an id again replaces it and keeps its place in the order', () => {
    const { p } = harness();
    p.registerTarget('a', { x: 0, y: 0, width: 10, height: 10 });
    p.registerTarget('b', { x: 20, y: 0, width: 10, height: 10 });
    p.registerTarget('a', { x: 5, y: 5, width: 10, height: 10 }, { role: 'cancel' });
    expect(p.getTargets().map((t) => t.id)).toEqual(['a', 'b']);
    expect(p.getTargets()[0]).toMatchObject({ rect: { x: 5 }, role: 'cancel' });
  });

  it('ignores a bad id, rectangle or role instead of throwing', () => {
    const { p } = harness();
    expect(() => {
      p.registerTarget('', { x: 0, y: 0, width: 10, height: 10 });
      p.registerTarget('$cancel', { x: 0, y: 0, width: 10, height: 10 });
      p.registerTarget('nan', { x: NaN, y: 0, width: 10, height: 10 });
      p.registerTarget('flat', { x: 0, y: 0, width: 0, height: 10 });
      p.registerTarget('null', null as never);
      p.registerTarget('role', { x: 0, y: 0, width: 10, height: 10 }, { role: 'bogus' as never });
      p.updateTarget('missing', { x: 0, y: 0, width: 10, height: 10 });
      p.updateTarget('role', { x: 0, y: 0, width: -1, height: 10 });
      p.unregisterTarget('missing');
    }).not.toThrow();
    expect(p.getTargets().map((t) => [t.id, t.role])).toEqual([['role', 'default']]);
    expect(p.getTargets()[0].rect.width).toBe(10);
  });

  it('a target id such as __proto__ is an ordinary id', () => {
    const { p } = harness();
    p.registerTarget('__proto__', { x: 0, y: 0, width: 10, height: 10 });
    expect(p.getTargets().map((t) => t.id)).toEqual(['__proto__']);
  });
});

describe('modes (Req 1 AC 5)', () => {
  it('switches mode without re-registering targets, and emits mode-change', () => {
    const h = harness();
    h.p.registerTarget('a', FULL);
    h.p.setMode('scan');
    expect(h.of('mode-change')).toEqual([{ mode: 'scan' }]);
    expect(h.p.getProfile().mode).toBe('scan');
    expect(h.p.getTargets().map((t) => t.id)).toEqual(['a']);
  });

  it('setting the mode it already has emits nothing', () => {
    const h = harness();
    h.p.setMode('head + dwell');
    expect(h.of('mode-change')).toEqual([]);
  });

  it('ignores a mode that does not exist', () => {
    const h = harness();
    h.p.setMode('teleport' as never);
    expect(h.of('mode-change')).toEqual([]);
    expect(h.p.getProfile().mode).toBe('head + dwell');
  });

  it('a mode change through setProfile or importProfile emits mode-change too', () => {
    const h = harness();
    h.p.setProfile({ mode: 'mouse' });
    expect(h.of('mode-change')).toEqual([{ mode: 'mouse' }]);
    h.p.importProfile(JSON.stringify({ ...h.p.getProfile(), mode: 'scan' }));
    expect(h.of('mode-change')).toEqual([{ mode: 'mouse' }, { mode: 'scan' }]);
  });

  it('a mode change returns the engines to idle', () => {
    const h = harness();
    h.p.registerTarget('a', FULL);
    h.settle();
    h.cam(30);
    expect(h.inspect().dwell.targetId).toBe('a');
    h.clear();
    h.p.setMode('scan');
    expect(h.inspect().dwell.targetId).toBeNull();
    expect(h.of('dwell-progress')).toEqual([{ targetId: 'a', progress: 0 }]);
    expect(h.of('cancel')).toEqual([]);
  });
});

describe('head + dwell', () => {
  it('selects the target under the pointer after the dwell time', () => {
    const h = harness();
    h.p.registerTarget('a', FULL);
    h.settle();
    h.clear();
    h.cam(80);
    const sel = h.of('select');
    expect(sel).toHaveLength(1);
    expect(sel[0]).toMatchObject({ targetId: 'a', source: 'dwell', role: 'default' });
    expect(h.of('dwell-progress').length).toBeGreaterThan(5);
  });

  it('keeps dwell progress when the target is updated and the pointer is still inside (Req 1 AC 2)', () => {
    const plain = harness();
    plain.p.registerTarget('a', FULL);
    plain.settle();
    plain.clear();
    plain.cam(80);
    const plainAt = plain.of('select')[0].now;

    const h = harness();
    h.p.registerTarget('a', FULL);
    h.settle();
    h.clear();
    h.cam(40);
    h.p.updateTarget('a', { x: 10, y: 10, width: 980, height: 780 });
    h.cam(40);
    expect(h.of('select')).toHaveLength(1);
    expect(h.of('select')[0].now).toBe(plainAt);
  });

  it('does not select while it points at nothing', () => {
    const h = harness();
    h.p.registerTarget('a', { x: 0, y: 0, width: 50, height: 50 });
    h.settle();
    h.clear();
    h.cam(200);
    expect(h.of('select')).toEqual([]);
  });

  it('emits pointer-move and tracking-status found/lost', () => {
    const h = harness();
    h.cam(3);
    expect(h.of('tracking-status')).toEqual([{ status: 'found' }]);
    expect(h.of('pointer-move').length).toBeGreaterThan(0);
    h.noFace(2);
    expect(h.of('tracking-status')).toEqual([{ status: 'found' }, { status: 'lost', message: messages.lost }]);
  });

  it('a lost face ends the stay', () => {
    const h = harness();
    h.p.registerTarget('a', FULL);
    h.settle();
    h.cam(30);
    h.noFace(1);
    expect(h.inspect().dwell.targetId).toBeNull();
  });

  it('does not emit pointer-move in scan, gesture scan and mouse modes from the camera', () => {
    for (const mode of ['scan', 'gesture scan', 'mouse'] as const) {
      const h = harness({ mode });
      h.cam(5);
      expect(h.of('pointer-move')).toEqual([]);
      expect(h.of('tracking-status')).toEqual([{ status: 'found' }]);
    }
  });
});

describe('switch scanning with no camera (Req 8 AC 3)', () => {
  function scanHarness() {
    const h = harness({ mode: 'scan', cancelByHold: false, scanInterval: 500, postSelectionPause: 200 });
    h.p.registerTarget('a', { x: 0, y: 0, width: 100, height: 100 });
    h.p.registerTarget('b', { x: 200, y: 0, width: 100, height: 100 });
    return h;
  }

  it('highlights from the first sample and advances on the scan interval', () => {
    const h = scanHarness();
    h.tick('keyboard', 100);
    const hl = h.of('highlight');
    expect(hl.length).toBeGreaterThanOrEqual(2);
    expect(hl[0].kind).not.toBe('none');
  });

  it('a switch press selects the highlighted target, with source scan', () => {
    const h = scanHarness();
    h.tick('keyboard', 5);
    const first = h.of('highlight')[0];
    h.tick('keyboard', 20, { signal: true });
    h.tick('keyboard', 3, { signal: false });
    // the first highlight may be a row; keep pressing until something is selected
    for (let i = 0; i < 6 && h.of('select').length === 0; i++) {
      h.tick('keyboard', 5);
      h.tick('keyboard', 20, { signal: true });
      h.tick('keyboard', 3, { signal: false });
      h.tick('keyboard', 40);
    }
    const sel = h.of('select');
    expect(first).toBeDefined();
    expect(sel.length).toBeGreaterThan(0);
    expect(sel[0]).toMatchObject({ source: 'scan' });
    expect(['a', 'b']).toContain(sel[0].targetId);
  });

  it('works from a mouse-button switch too, and from synthetic samples', () => {
    for (const source of ['mouse', 'gamepad', 'synthetic'] as const) {
      const h = scanHarness();
      for (let i = 0; i < 8 && h.of('select').length === 0; i++) {
        h.tick(source, 5);
        h.tick(source, 20, { signal: true });
        h.tick(source, 3, { signal: false });
        h.tick(source, 40);
      }
      expect(h.of('select').length).toBeGreaterThan(0);
    }
  });

  it('a press from a second switch source at the same time as the first source is not lost', () => {
    const h = harness({ mode: 'scan', cancelByHold: false, scanInterval: 500 });
    h.p.registerTarget('a', { x: 0, y: 0, width: 100, height: 100 });
    h.p.feedSamples([
      { now: 10, source: 'keyboard', signal: false },
      { now: 20, source: 'keyboard', signal: false },
      { now: 20, source: 'gamepad', signal: true }, // the scan has already seen time 20
    ]);
    expect(h.of('select')).toEqual([{ targetId: 'a', now: expect.any(Number), source: 'scan', role: 'default' }]);
  });

  it('a camera that never starts changes nothing for scanning', () => {
    const h = scanHarness();
    h.tick('keyboard', 50);
    expect(h.inspect().head.tracking).toBe('none');
    expect(h.of('highlight').length).toBeGreaterThan(0);
  });

  it('holding the switch to the cancel hold time cancels and selects nothing (Req 6 AC 2)', () => {
    const h = harness({ mode: 'scan', cancelByHold: true, cancelHoldTime: 1000 });
    h.p.registerTarget('a', { x: 0, y: 0, width: 100, height: 100 });
    h.tick('keyboard', 3);
    h.tick('keyboard', 80, { signal: true }); // 1280 ms held
    h.tick('keyboard', 5, { signal: false });
    expect(h.of('cancel')).toHaveLength(1);
    expect(h.of('select')).toEqual([]);
  });

  it('a key held when the cancel fires needs a release before it can press again', () => {
    const h = harness({ mode: 'scan', cancelByHold: true, cancelHoldTime: 1000 });
    h.p.registerTarget('a', { x: 0, y: 0, width: 100, height: 100 });
    h.tick('keyboard', 3);
    h.tick('keyboard', 80, { signal: true });
    expect(h.inspect().switches.keyboard).toBe(PressState.COOLDOWN);
    h.tick('keyboard', 2, { signal: false });
    expect(h.inspect().switches.keyboard).toBe(PressState.IDLE);
  });
});

describe('mouse mode', () => {
  function mouseHarness() {
    const h = harness({ mode: 'mouse', cancelByHold: false });
    h.p.registerTarget('a', { x: 100, y: 100, width: 100, height: 100 });
    h.p.registerTarget('rest', { x: 400, y: 100, width: 100, height: 100 }, { role: 'rest-area' });
    return h;
  }

  it('moves the pointer to the mouse position and clamps it to the screen', () => {
    const h = mouseHarness();
    h.tick('mouse', 1, { pointer: { x: 150, y: 150 } });
    h.tick('mouse', 1, { pointer: { x: 5000, y: -20 } });
    expect(h.of('pointer-move')).toEqual([
      { x: 150, y: 150 },
      { x: 999, y: 0 },
    ]);
  });

  it('does not repeat pointer-move for the same position', () => {
    const h = mouseHarness();
    h.tick('mouse', 5, { pointer: { x: 150, y: 150 } });
    expect(h.of('pointer-move')).toHaveLength(1);
  });

  it('a click selects the target under the pointer, with source mouse', () => {
    const h = mouseHarness();
    h.tick('mouse', 2, { pointer: { x: 150, y: 150 } });
    h.tick('mouse', 10, { pointer: { x: 150, y: 150 }, signal: true });
    h.tick('mouse', 2, { pointer: { x: 150, y: 150 }, signal: false });
    expect(h.of('select')).toEqual([{ targetId: 'a', now: expect.any(Number), source: 'mouse', role: 'default' }]);
  });

  it('a click on empty space or a rest area selects nothing', () => {
    const h = mouseHarness();
    for (const pointer of [{ x: 700, y: 700 }, { x: 450, y: 150 }]) {
      h.tick('mouse', 2, { pointer });
      h.tick('mouse', 10, { pointer, signal: true });
      h.tick('mouse', 2, { pointer, signal: false });
    }
    expect(h.of('select')).toEqual([]);
  });

  it('works with the camera unavailable and does not use camera samples', () => {
    const h = mouseHarness();
    h.cam(100);
    expect(h.of('select')).toEqual([]);
    expect(h.of('pointer-move')).toEqual([]);
  });
});

describe('cancel input (Req 6 AC 4)', () => {
  it('cancel: true emits exactly one cancel and nothing else of that sample is used', () => {
    const h = harness({ mode: 'mouse' });
    h.p.registerTarget('a', { x: 100, y: 100, width: 100, height: 100 });
    h.tick('mouse', 1, { pointer: { x: 150, y: 150 }, signal: true, cancel: true });
    expect(h.of('cancel')).toEqual([{ now: expect.any(Number) }]);
    expect(h.of('pointer-move')).toEqual([]);
  });

  it('ends a dwell stay and returns scanning to the top of the cycle', () => {
    const h = harness();
    h.p.registerTarget('a', FULL);
    h.settle();
    h.cam(30);
    expect(h.inspect().dwell.targetId).toBe('a');
    h.clear();
    h.tick('keyboard', 1, { cancel: true });
    expect(h.inspect().dwell.targetId).toBeNull();
    expect(h.of('cancel')).toHaveLength(1);
    expect(h.of('dwell-progress')).toEqual([{ targetId: 'a', progress: 0 }]);
    expect(h.of('select')).toEqual([]);

    const s = harness({ mode: 'scan', scanInterval: 500 });
    s.p.registerTarget('a', { x: 0, y: 0, width: 10, height: 10 });
    s.p.registerTarget('b', { x: 20, y: 0, width: 10, height: 10 });
    s.tick('keyboard', 60);
    s.tick('keyboard', 1, { cancel: true });
    expect(s.inspect().scan.started).toBe(false);
    s.tick('keyboard', 1);
    expect(s.inspect().scan).toMatchObject({ started: true, index: 0, loops: 0 });
  });

  it('a held switch must be released before it can press after a cancel', () => {
    const h = harness({ mode: 'scan', cancelByHold: false });
    h.p.registerTarget('a', { x: 0, y: 0, width: 10, height: 10 });
    h.tick('keyboard', 3);
    h.tick('keyboard', 5, { signal: true });
    h.tick('synthetic', 1, { cancel: true });
    expect(h.inspect().switches.keyboard).toBe(PressState.COOLDOWN);
  });

  it('one cancel per cancel sample, and a repeated timestamp does nothing', () => {
    const h = harness();
    h.p.feedSamples([
      { now: 100, source: 'keyboard', cancel: true },
      { now: 100, source: 'keyboard', cancel: true },
      { now: 90, source: 'keyboard', cancel: true },
      { now: 110, source: 'keyboard', cancel: true },
    ]);
    expect(h.of('cancel')).toHaveLength(2);
  });

  it('does not touch a running calibration (cancelCalibration does that)', () => {
    const h = harness();
    h.p.startCalibration();
    h.cam(3);
    h.tick('keyboard', 1, { cancel: true });
    expect(h.inspect().calibration).not.toBeNull();
  });

  it('gesture hold-to-cancel emits cancel through the API and selects nothing', () => {
    const h = harness({ mode: 'gesture scan', cancelByHold: true, cancelHoldTime: 1000 });
    h.p.registerTarget('a', { x: 0, y: 0, width: 10, height: 10 });
    h.settle();
    h.cam(80, 0, 0, { jawOpen: 0.9, browRaise: 0 }); // 1280 ms
    h.cam(5, 0, 0, { jawOpen: 0, browRaise: 0 });
    expect(h.of('cancel')).toHaveLength(1);
    expect(h.of('select')).toEqual([]);
  });
});

describe('per-source clocks (Req 9 AC 4, P16)', () => {
  it('ignores a sample that is not later than the previous one from the same source', () => {
    const h = harness({ mode: 'mouse', cancelByHold: false });
    h.p.registerTarget('a', { x: 0, y: 0, width: 1000, height: 800 });
    h.p.feedSamples([
      { now: 100, source: 'mouse', pointer: { x: 10, y: 10 } },
      { now: 100, source: 'mouse', pointer: { x: 20, y: 20 } },
      { now: 50, source: 'mouse', pointer: { x: 30, y: 30 } },
      { now: Number.NaN, source: 'mouse', pointer: { x: 40, y: 40 } },
      { now: 101, source: 'mouse', pointer: { x: 50, y: 50 } },
    ]);
    expect(h.of('pointer-move')).toEqual([
      { x: 10, y: 10 },
      { x: 50, y: 50 },
    ]);
  });

  it('a switch sample never makes an older camera sample invalid', () => {
    const h = harness();
    h.p.feedSamples([
      { now: 1000, source: 'keyboard', signal: false },
      { now: 960, source: 'camera', faces: [{ bbox: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.3 }, rotation: { yaw: 0, pitch: 0 } }] },
    ]);
    expect(h.of('tracking-status')).toEqual([{ status: 'found' }]);
  });

  it('keyboard and gamepad each keep their own clock', () => {
    const h = harness({ mode: 'scan', cancelByHold: false });
    h.p.registerTarget('a', { x: 0, y: 0, width: 10, height: 10 });
    h.p.feedSamples([
      { now: 100, source: 'keyboard', signal: true },
      { now: 100, source: 'gamepad', signal: false },
    ]);
    expect(Object.keys(h.inspect().switches).sort()).toEqual(['gamepad', 'keyboard']);
  });

  it('ignores samples that are not objects, have no time or an unknown source', () => {
    const h = harness();
    expect(() =>
      h.p.feedSamples([null, 5, 'x', {}, { now: 1 }, { now: 1, source: 'nope' }, { source: 'camera' }] as never),
    ).not.toThrow();
    expect(() => h.p.feedSamples(undefined as never)).not.toThrow();
    expect(h.log).toEqual([]);
  });

  it('survives malformed faces and scores', () => {
    const h = harness();
    expect(() =>
      h.p.feedSamples([
        { now: 1, source: 'camera', faces: [null, 3, { bbox: null }, { bbox: { cx: 'a' } }] as never },
        { now: 2, source: 'camera', faces: 'nope' as never },
        { now: 3, source: 'camera', faces: [], gestureScores: null as never },
        { now: 4, source: 'camera', faces: [{ bbox: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.3 }, rotation: null as never, gestureScores: { jawOpen: 'x' } as never }] },
      ]),
    ).not.toThrow();
  });
});

describe('profile (Req 7)', () => {
  it('starts from the defaults, with the given profile clamped', () => {
    const p = createPlanchette({ screen: { width: 100, height: 100 }, profile: { headGain: 9, dwellTime: 1500 } });
    expect(p.getProfile()).toMatchObject({ headGain: 2, dwellTime: 1500, mode: 'head + dwell' });
  });

  it('setProfile clamps before applying, in the order the profile uses', () => {
    const { p } = harness();
    p.setProfile({ headGain: 0, gestureThreshold: 0.2, gestureReleaseThreshold: 0.9, cancelHoldTime: 1000, gestureAcceptanceTime: 5000 });
    const got = p.getProfile();
    expect(got.headGain).toBe(1);
    expect(got.gestureReleaseThreshold).toBeLessThanOrEqual(got.gestureThreshold - 0.05 + 1e-9);
    expect(got.gestureAcceptanceTime).toBeLessThan(got.cancelHoldTime);
  });

  it('setProfile keeps the fields it was not given', () => {
    const { p } = harness({ dwellTime: 1500 });
    p.setProfile({ graceTime: 100 });
    expect(p.getProfile()).toMatchObject({ dwellTime: 1500, graceTime: 100 });
  });

  it('getProfile returns a copy', () => {
    const { p } = harness();
    const a = p.getProfile();
    a.dwellTime = 3000;
    expect(p.getProfile().dwellTime).toBe(1000);
  });

  it('round-trips through exportProfile and importProfile', () => {
    const a = harness({ dwellTime: 1500, mode: 'scan', headGain: 1.5 });
    const json = a.p.exportProfile();
    const b = harness();
    const result = b.p.importProfile(json);
    expect(b.p.getProfile()).toEqual(a.p.getProfile());
    expect(result.profile).toEqual(a.p.getProfile());
    expect(result.changes).toEqual([]);
  });

  it('importProfile clamps, reports what changed and keeps the profile when the file is not a profile', () => {
    const { p } = harness({ dwellTime: 1500 });
    const r = p.importProfile(JSON.stringify({ headGain: 9 }));
    expect(p.getProfile().headGain).toBe(2);
    expect(r.changes.some((c) => c.startsWith('headGain'))).toBe(true);

    const before = p.getProfile();
    for (const bad of ['nope', '[]', 'null', '5', '']) {
      const res = p.importProfile(bad);
      expect(p.getProfile()).toEqual(before);
      expect(res.changes.length).toBeGreaterThan(0);
    }
    expect(() => p.importProfile(undefined as never)).not.toThrow();
  });

  it('a profile change takes effect on the next sample', () => {
    const h = harness();
    h.p.registerTarget('a', FULL);
    h.settle();
    h.p.setProfile({ dwellTime: 400 });
    h.clear();
    h.cam(40);
    expect(h.of('select')).toHaveLength(1);
  });
});

describe('screen (Req 2 AC 3)', () => {
  it('setScreen changes the bounds the pointer is clamped to on the next sample', () => {
    const h = harness();
    h.settle();
    h.cam(5, 15, 0); // full range to the right
    const wide = h.of('pointer-move').at(-1)!;
    expect(wide.x).toBeGreaterThan(900);
    h.clear();
    h.p.setScreen({ width: 400, height: 300 });
    h.cam(5, 15, 0);
    const narrow = h.of('pointer-move').at(-1)!;
    expect(narrow.x).toBeLessThanOrEqual(399);
    expect(narrow.y).toBeLessThanOrEqual(299);
  });

  it('shrinking the screen re-clamps the mouse pointer', () => {
    const h = harness({ mode: 'mouse' });
    h.tick('mouse', 1, { pointer: { x: 900, y: 700 } });
    h.p.setScreen({ width: 500, height: 500 });
    h.tick('mouse', 1, { pointer: { x: 900, y: 700 } });
    expect(h.of('pointer-move').at(-1)).toEqual({ x: 499, y: 499 });
  });

  it('an invalid screen size does not break anything', () => {
    const h = harness();
    h.p.setScreen({ width: Number.NaN, height: -4 });
    expect(() => h.cam(5)).not.toThrow();
  });
});

describe('head + gesture', () => {
  const jawOn = { jawOpen: 0.9, browRaise: 0 };
  const jawOff = { jawOpen: 0, browRaise: 0 };

  function gestureHarness() {
    const h = harness({ mode: 'head + gesture', cancelByHold: true });
    h.p.registerTarget('left', { x: 0, y: 0, width: 500, height: 800 });
    h.p.registerTarget('right', { x: 500, y: 0, width: 500, height: 800 });
    h.settle(); // centre (0, 0)
    h.clear();
    return h;
  }

  it('selects the target under the pointer when the gesture began, even if the head moves during it (P13)', () => {
    const h = gestureHarness();
    h.cam(10, -10, 0, jawOff); // pointer on the left
    h.cam(5, -10, 0, jawOn);
    h.cam(30, 10, 0, jawOn); // head swings to the right while the jaw is open
    h.cam(5, 10, 0, jawOff); // release: the press counts now
    expect(h.of('select')).toEqual([{ targetId: 'left', now: expect.any(Number), source: 'gesture', role: 'default' }]);
  });

  it('a short gesture selects nothing', () => {
    const h = gestureHarness();
    h.cam(10, -10, 0, jawOff);
    h.cam(5, -10, 0, jawOn); // 80 ms
    h.cam(5, -10, 0, jawOff);
    expect(h.of('select')).toEqual([]);
  });

  it('a face that is not detected presses nothing', () => {
    const h = gestureHarness();
    h.cam(10, -10, 0, jawOff);
    h.cam(10, -10, 0, jawOn);
    h.noFace(30);
    h.cam(5, -10, 0, jawOff);
    expect(h.of('select')).toEqual([]);
  });

  it('holds the gesture while calibration runs', () => {
    const h = gestureHarness();
    h.p.recentre();
    h.cam(10, -10, 0, jawOff);
    h.cam(30, -10, 0, jawOn);
    h.cam(3, -10, 0, jawOff);
    expect(h.of('select')).toEqual([]);
  });
});

describe('gesture scan', () => {
  it('a gesture is the scan switch', () => {
    const h = harness({ mode: 'gesture scan', cancelByHold: false, scanInterval: 500 });
    h.p.registerTarget('a', { x: 0, y: 0, width: 10, height: 10 });
    h.p.registerTarget('b', { x: 20, y: 0, width: 10, height: 10 });
    h.settle();
    for (let i = 0; i < 8 && h.of('select').length === 0; i++) {
      h.cam(10, 0, 0, { jawOpen: 0, browRaise: 0 });
      h.cam(30, 0, 0, { jawOpen: 0.9, browRaise: 0 });
      h.cam(3, 0, 0, { jawOpen: 0, browRaise: 0 });
      h.cam(40, 0, 0, { jawOpen: 0, browRaise: 0 });
    }
    expect(h.of('highlight').length).toBeGreaterThan(0);
    expect(h.of('select')[0]).toMatchObject({ source: 'scan' });
  });

  it('keeps scanning with no face and presses nothing', () => {
    const h = harness({ mode: 'gesture scan', scanInterval: 500 });
    h.p.registerTarget('a', { x: 0, y: 0, width: 10, height: 10 });
    h.noFace(200);
    expect(h.of('highlight').length).toBeGreaterThan(0);
    expect(h.of('select')).toEqual([]);
  });
});

describe('calibration (Req 7 AC 1, 2; Task 11.6, 11.6a)', () => {
  function stepsOf(h: ReturnType<typeof harness>): string[] {
    return h
      .of('calibration-step')
      .map((e) => `${e.run}:${e.step}:${e.completed ? 'end' : 'start'}${e.timeout ? ':timeout' : ''}`);
  }
  /** Feed camera samples until the current calibration step has changed. */
  function until(h: ReturnType<typeof harness>, yaw: number, pitch: number, scores?: { jawOpen: number; browRaise: number }): void {
    const from = h.inspect().calibration?.step;
    for (let i = 0; i < 2000 && h.inspect().calibration?.step === from; i++) h.cam(1, yaw, pitch, scores);
  }

  it('startCalibration runs the full sequence, reports each step and applies the result', () => {
    const h = harness();
    h.settle(); // start-up centre
    h.clear();
    h.p.startCalibration();
    h.cam(1);
    until(h, 0, 0);
    until(h, -10, 0);
    until(h, 12, 0);
    until(h, 0, 8);
    until(h, 0, -6);
    until(h, 0, 0, { jawOpen: 0.1, browRaise: 0 });
    until(h, 0, 0, { jawOpen: 0.8, browRaise: 0 });
    expect(stepsOf(h)).toEqual([
      'full:centre:start', 'full:centre:end',
      'full:left:start', 'full:left:end',
      'full:right:start', 'full:right:end',
      'full:up:start', 'full:up:end',
      'full:down:start', 'full:down:end',
      'full:rest:start', 'full:rest:end',
      'full:gesture:start', 'full:gesture:end',
      'full:done:end',
    ]);
    const done = h.of('calibration-step').at(-1)!;
    expect(done.result).toMatchObject({ run: 'full', rejected: null, suggestHighTremor: false });
    expect(h.p.getProfile()).toMatchObject({
      calibrationRangeLeft: 10,
      calibrationRangeRight: 12,
      calibrationRangeUp: 8,
      calibrationRangeDown: 6,
    });
    expect(h.p.getProfile().gestureThreshold).toBeCloseTo(0.52, 5);
    expect(h.inspect().calibration).toBeNull();
  });

  it('a rejected range leaves the profile ranges alone', () => {
    const h = harness();
    h.settle();
    h.p.startCalibration();
    h.cam(1);
    until(h, 0, 0);
    until(h, -1, 0); // 1 degree: below the minimum range
    until(h, 12, 0);
    until(h, 0, 8);
    until(h, 0, -6);
    until(h, 0, 0, { jawOpen: 0.1, browRaise: 0 });
    until(h, 0, 0, { jawOpen: 0.8, browRaise: 0 });
    const done = h.of('calibration-step').at(-1)!;
    expect(done.result!.rejected).toBe('range-too-small');
    expect(h.p.getProfile().calibrationRangeRight).toBe(15);
  });

  it('cancelCalibration stops the run, reports it and changes nothing', () => {
    const h = harness();
    h.settle();
    h.clear();
    h.p.startCalibration();
    h.cam(10);
    h.p.cancelCalibration();
    expect(h.of('calibration-step').at(-1)).toEqual({ run: 'full', step: 'done', completed: false, timeout: false });
    expect(h.inspect().calibration).toBeNull();
    expect(h.p.getProfile().calibrationRangeLeft).toBe(15);
    h.clear();
    h.p.cancelCalibration();
    expect(h.log).toEqual([]);
  });

  it('startCalibration while a run is going does nothing', () => {
    const h = harness();
    h.settle();
    h.clear();
    h.p.startCalibration();
    h.p.startCalibration();
    h.cam(1);
    expect(stepsOf(h)).toEqual(['full:centre:start']);
  });

  it('startCalibration while a run is going does not restart it', () => {
    const h = harness();
    h.settle();
    h.clear();
    h.p.startCalibration();
    h.cam(60); // 960 ms of the centre step
    h.p.startCalibration();
    h.cam(40); // the original window completes at 1500 ms; a restarted one would not
    expect(stepsOf(h)).toContain('full:centre:end');
  });

  it('a camera sample is never read as a switch, whatever it carries', () => {
    const h = harness({ mode: 'scan', cancelByHold: false });
    h.p.registerTarget('a', { x: 0, y: 0, width: 10, height: 10 });
    h.p.feedSamples([
      { now: 10, source: 'camera', faces: [], signal: true },
      { now: 20, source: 'camera', faces: [], signal: false },
    ]);
    expect(h.inspect().switches).toEqual({});
    expect(h.of('select')).toEqual([]);
  });

  it('holds dwell selection while a calibration runs, and resumes afterwards', () => {
    const h = harness();
    h.p.registerTarget('a', FULL);
    h.settle();
    h.clear();
    h.p.startCalibration();
    h.cam(200); // 3.2 s on the target
    expect(h.of('select')).toEqual([]);
    h.p.cancelCalibration();
    h.cam(80);
    expect(h.of('select')).toHaveLength(1);
  });

  describe('the centre is session state (11.6a)', () => {
    it('is (0, 0) until the first centre step completes', () => {
      const h = harness();
      expect(h.inspect().centre).toEqual({ yaw: 0, pitch: 0 });
      h.cam(10, 8, 0);
      expect(h.inspect().centre).toEqual({ yaw: 0, pitch: 0 });
    });

    it('the first camera sample after creation starts a centre-only run', () => {
      const h = harness();
      expect(h.inspect().calibration).toBeNull();
      h.cam(1, 5, 2);
      expect(h.inspect().calibration).toEqual({ run: 'centre', step: 'centre' });
      expect(stepsOf(h)).toEqual(['centre:centre:start']);
    });

    it('the centre is the mean pose over the stillness window, and then the pointer is centred', () => {
      const h = harness();
      h.settle(8, -3);
      expect(h.inspect().calibration).toBeNull();
      expect(h.inspect().centre.yaw).toBeCloseTo(8, 5);
      expect(h.inspect().centre.pitch).toBeCloseTo(-3, 5);
      expect(stepsOf(h)).toEqual(['centre:centre:start', 'centre:centre:end', 'centre:done:end']);
      h.clear();
      h.cam(20, 8, -3);
      const p = h.inspect().head;
      expect(Math.abs(p.x - 499.5)).toBeLessThan(2);
      expect(Math.abs(p.y - 399.5)).toBeLessThan(2);
    });

    it('the centre run reports a result with the centre and no profile changes', () => {
      const h = harness();
      h.settle(4, 1);
      const done = h.of('calibration-step').at(-1)!;
      expect(done.result).toMatchObject({ run: 'centre', ranges: null, gesture: null, profile: {} });
      expect(done.result!.centre!.yaw).toBeCloseTo(4, 5);
    });

    it('holds dwell and gesture selection until the centre step completes', () => {
      const h = harness();
      h.p.registerTarget('a', FULL);
      h.cam(90); // 1440 ms, step not complete yet
      expect(h.of('select')).toEqual([]);
      h.cam(10); // completes
      h.cam(80);
      expect(h.of('select')).toHaveLength(1);
    });

    it('the pointer moves while the centre step runs, using the previous centre', () => {
      const h = harness();
      h.cam(20, 15, 0);
      expect(h.of('pointer-move').length).toBeGreaterThan(0);
      expect(h.inspect().head.x).toBeGreaterThan(900);
    });

    it('scanning, keyboard and mouse input are not held', () => {
      const h = harness({ mode: 'scan', cancelByHold: false, scanInterval: 500 });
      h.p.registerTarget('a', { x: 0, y: 0, width: 10, height: 10 });
      h.cam(1); // starts the centre step
      expect(h.inspect().calibration).not.toBeNull();
      h.tick('keyboard', 60);
      expect(h.of('highlight').length).toBeGreaterThan(0);
    });

    it('recentre() runs the centre step again and keeps the old centre until it completes', () => {
      const h = harness();
      h.settle(8, 0);
      h.clear();
      h.p.recentre();
      h.cam(10, -6, 0);
      expect(h.inspect().centre.yaw).toBeCloseTo(8, 5);
      h.cam(100, -6, 0);
      expect(h.inspect().centre.yaw).toBeCloseTo(-6, 5);
      expect(stepsOf(h)).toEqual(['centre:centre:start', 'centre:centre:end', 'centre:done:end']);
    });

    it('recentre() while a calibration or centre step runs does nothing', () => {
      const h = harness();
      h.cam(1);
      h.clear();
      h.p.recentre();
      expect(h.log).toEqual([]);
      h.settle();
      h.p.startCalibration();
      h.cam(1);
      h.clear();
      h.p.recentre();
      h.cam(1);
      expect(stepsOf(h)).toEqual([]);
      expect(h.inspect().calibration).toEqual({ run: 'full', step: 'centre' });
    });

    it('a full calibration measures the centre itself: no start-up centre run follows', () => {
      const h = harness();
      h.p.startCalibration();
      h.cam(1);
      expect(stepsOf(h)).toEqual(['full:centre:start']);
    });

    it('stopCamera() makes the next camera sample start a centre step again', () => {
      const h = harness();
      h.settle(8, 0);
      h.clear();
      h.p.stopCamera();
      h.clock.camera = 0; // a new camera session starts its clock again
      h.cam(1, 8, 0);
      expect(stepsOf(h)).toEqual(['centre:centre:start']);
      expect(h.inspect().centre.yaw).toBeCloseTo(8, 5); // kept until the new step completes
    });

    it('startCamera() starts the centre step on the next camera sample, also as a retry', async () => {
      const h = harness();
      h.settle();
      h.clear();
      await h.p.startCamera();
      h.cam(1);
      expect(stepsOf(h)).toEqual(['centre:centre:start']);
    });

    it('stopCamera() cancels a running calibration', () => {
      const h = harness();
      h.p.startCalibration();
      h.cam(5);
      h.clear();
      h.p.stopCamera();
      expect(h.of('calibration-step')).toEqual([{ run: 'full', step: 'done', completed: false, timeout: false }]);
    });

    it('when the centre step sees no face the previous centre is kept', () => {
      const h = harness();
      h.settle(8, 0);
      h.p.recentre();
      h.noFace(400); // runs to the step timeout
      expect(h.inspect().calibration).toBeNull();
      expect(h.inspect().centre.yaw).toBeCloseTo(8, 5);
    });

    it('the start-up centre step runs once per camera session, even when it saw no face', () => {
      const h = harness();
      h.noFace(400);
      h.clear();
      h.cam(5);
      expect(stepsOf(h)).toEqual([]);
    });
  });
});

describe('relockFace', () => {
  it('locks the chosen face and emits tracking-status found', () => {
    const h = harness();
    h.p.feedSamples([
      {
        now: 16,
        source: 'camera',
        faces: [
          { bbox: { cx: 0.3, cy: 0.5, w: 0.3, h: 0.3 }, rotation: { yaw: 0, pitch: 0 } },
          { bbox: { cx: 0.7, cy: 0.5, w: 0.2, h: 0.2 }, rotation: { yaw: 0, pitch: 0 } },
        ],
      },
    ]);
    h.clear();
    h.p.relockFace(1);
    expect(h.of('tracking-status')).toEqual([{ status: 'found' }]);
    h.clear();
    h.p.relockFace(7);
    expect(h.log).toEqual([]);
  });
});

describe('instances are independent (no module-level state)', () => {
  it('two instances do not share targets, profile or events', () => {
    const a = harness();
    const b = harness();
    a.p.registerTarget('x', FULL);
    a.p.setProfile({ dwellTime: 2000 });
    a.p.setMode('mouse');
    expect(b.p.getTargets()).toEqual([]);
    expect(b.p.getProfile().dwellTime).toBe(1000);
    expect(b.log).toEqual([]);
  });
});

describe('events', () => {
  it('are CustomEvents with the payload in detail, on an EventTarget', () => {
    const p = createPlanchette({ screen: { width: 100, height: 100 } });
    expect(p).toBeInstanceOf(EventTarget);
    let seen: unknown;
    p.addEventListener('mode-change', (e) => {
      expect(e).toBeInstanceOf(CustomEvent);
      seen = e.detail;
    });
    p.setMode('scan');
    expect(seen).toEqual({ mode: 'scan' });
  });

  it('an event listener can be removed', () => {
    const p = createPlanchette({ screen: { width: 100, height: 100 } });
    let n = 0;
    const f = (): void => {
      n++;
    };
    p.addEventListener('mode-change', f);
    p.setMode('scan');
    p.removeEventListener('mode-change', f);
    p.setMode('mouse');
    expect(n).toBe(1);
  });
});
