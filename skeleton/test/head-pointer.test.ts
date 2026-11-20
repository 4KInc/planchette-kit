import { describe, it, expect } from 'vitest';
import {
  FREEZE_EXPIRY_EXTRA_MS,
  LOCK_THRESHOLD,
  MIN_RANGE_DEG,
  cloneHeadPointerState,
  continuityScore,
  createHeadPointerState,
  relockFace,
  selectionPointer,
  stepHeadPointer,
  type DetectedFace,
  type FaceBox,
  type GestureScores,
  type HeadPointerEvent,
  type HeadPointerState,
} from '../src/engine/head-pointer';
import { defaultProfile, type Profile } from '../src/engine/profile';

const SCREEN = { width: 1920, height: 1080 };
const CENTRE = { yaw: 0, pitch: 0 };
// Reference calibration ±15°, gain 1, no dead zone, no smoothing lag on the first sample.
const P: Profile = { ...defaultProfile, headDeadZone: 0 };
const CX = Math.round(0.5 * 1919); // 960
const CY = Math.round(0.5 * 1079); // 540

const BOX: FaceBox = { cx: 0.5, cy: 0.5, w: 0.3, h: 0.4 };

function face(yaw: number, pitch: number, bbox: FaceBox = BOX, gestureScores?: GestureScores): DetectedFace {
  return { bbox, rotation: { yaw, pitch }, gestureScores };
}

function step(
  s: HeadPointerState,
  now: number,
  faces: DetectedFace[],
  p: Profile = P,
  extra: { gestureScores?: GestureScores; screen?: { width: number; height: number } } = {},
): HeadPointerEvent[] {
  return stepHeadPointer(
    s,
    { faces, gestureScores: extra.gestureScores, screen: extra.screen ?? SCREEN, centre: CENTRE },
    now,
    p,
  );
}

/** Hold one pose for long enough that the filter has settled. */
function settle(s: HeadPointerState, t0: number, f: DetectedFace, p: Profile = P, ms = 3000): number {
  let t = t0;
  for (; t <= t0 + ms; t += 16) step(s, t, [f], p);
  return t;
}

const moves = (ev: HeadPointerEvent[]) => ev.filter((e) => e.type === 'pointer-move');
const statuses = (ev: HeadPointerEvent[]) =>
  ev.filter((e): e is Extract<HeadPointerEvent, { type: 'tracking-status' }> => e.type === 'tracking-status').map((e) => e.status);

describe('mapping (design §1)', () => {
  it('zero deflection puts the pointer at the screen centre', () => {
    const s = createHeadPointerState();
    const ev = step(s, 0, [face(0, 0)]);
    expect(ev).toEqual([
      { type: 'tracking-status', status: 'found' },
      { type: 'pointer-move', x: CX, y: CY },
    ]);
  });

  it('the full calibrated range reaches each screen edge', () => {
    for (const [yaw, pitch, x, y] of [
      [15, 0, 1919, CY],
      [-15, 0, 0, CY],
      [0, 15, CX, 0], // looking up moves the pointer up
      [0, -15, CX, 1079],
      [15, 15, 1919, 0],
    ] as const) {
      const s = createHeadPointerState();
      step(s, 0, [face(yaw, pitch)]);
      expect([s.x, s.y]).toEqual([x, y]);
    }
  });

  it('uses each side\'s own range (asymmetric calibration)', () => {
    const p: Profile = { ...P, calibrationRangeLeft: 10, calibrationRangeRight: 30 };
    const s1 = createHeadPointerState();
    step(s1, 0, [face(-10, 0)], p);
    expect(s1.x).toBe(0);
    const s2 = createHeadPointerState();
    step(s2, 0, [face(15, 0)], p);
    expect(s2.x).toBe(Math.round(0.75 * 1919));
  });

  it('the dead zone leaves the pointer centred, and the edge is still reached at the full range', () => {
    const p: Profile = { ...P, headDeadZone: 2 };
    for (const yaw of [-2, -1, 0, 0.5, 2]) {
      const s = createHeadPointerState();
      step(s, 0, [face(yaw, 2)], p);
      expect([s.x, s.y]).toEqual([CX, CY]);
    }
    const s = createHeadPointerState();
    step(s, 0, [face(15, 0)], p);
    expect(s.x).toBe(1919);
    // just outside the dead zone the pointer moves off centre
    const s3 = createHeadPointerState();
    step(s3, 0, [face(3, 0)], p);
    expect(s3.x).toBe(Math.round((1 / 13 * 0.5 + 0.5) * 1919));
  });

  it('gain 2 needs half the rotation for the same pointer position', () => {
    const g2: Profile = { ...P, headGain: 2 };
    const a = createHeadPointerState();
    step(a, 0, [face(6, -3)], P);
    const b = createHeadPointerState();
    step(b, 0, [face(3, -1.5)], g2);
    expect([b.x, b.y]).toEqual([a.x, a.y]);
    // and the same rotation moves the pointer twice as far from the centre
    const c = createHeadPointerState();
    step(c, 0, [face(3, 0)], g2);
    const d = createHeadPointerState();
    step(d, 0, [face(3, 0)], P);
    expect(c.x - CX).toBeCloseTo(2 * (d.x - CX), -0.5);
  });

  it('subtracts the calibrated centre', () => {
    const s = createHeadPointerState();
    stepHeadPointer(s, { faces: [face(12, -7)], screen: SCREEN, centre: { yaw: 12, pitch: -7 } }, 0, P);
    expect([s.x, s.y]).toEqual([CX, CY]);
  });

  it('keeps the pointer on screen beyond the range, for extreme and non-finite rotations', () => {
    for (const [yaw, pitch] of [[1e6, -1e6], [1e308, 1e308], [-90, 90]] as const) {
      const s = createHeadPointerState();
      step(s, 0, [face(yaw, pitch)]);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(1919);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(1079);
    }
    const s = createHeadPointerState();
    step(s, 0, [face(5, 0)]);
    const before = [s.x, s.y];
    expect(moves(step(s, 16, [face(Infinity, NaN)]))).toEqual([]);
    expect([s.x, s.y]).toEqual(before);
  });

  it('smooths: a step change takes several frames, then settles on the mapped position', () => {
    const s = createHeadPointerState();
    step(s, 0, [face(0, 0)]);
    step(s, 16, [face(10, 0)]);
    expect(s.x).toBeGreaterThan(CX);
    expect(s.x).toBeLessThan(Math.round((10 / 15 * 0.5 + 0.5) * 1919));
    settle(s, 32, face(10, 0));
    expect(s.x).toBe(Math.round((10 / 15 * 0.5 + 0.5) * 1919));
  });

  it('emits pointer-move only when the pointer moves', () => {
    const s = createHeadPointerState();
    step(s, 0, [face(3, 3)]);
    expect(moves(step(s, 16, [face(3, 3)]))).toEqual([]);
  });

  it('a smaller screen keeps the pointer inside it, even while the face is lost', () => {
    const s = createHeadPointerState();
    step(s, 0, [face(15, -15)]);
    expect([s.x, s.y]).toEqual([1919, 1079]);
    step(s, 16, []);
    const ev = step(s, 32, [], P, { screen: { width: 800, height: 600 } });
    expect(moves(ev)).toEqual([{ type: 'pointer-move', x: 799, y: 599 }]);
  });

  it('MIN_RANGE_DEG is 3 degrees', () => {
    expect(MIN_RANGE_DEG).toBe(3);
  });
});

describe('face lost and found (design §4)', () => {
  it('freezes the pointer, emits lost once, and offers no selection pointer', () => {
    const s = createHeadPointerState();
    settle(s, 0, face(6, 4));
    const pos = [s.x, s.y];
    const ev = step(s, 4000, []);
    expect(ev).toEqual([{ type: 'tracking-status', status: 'lost' }]);
    expect([s.x, s.y]).toEqual(pos);
    expect(selectionPointer(s)).toBeNull();
    for (let t = 4016; t < 5000; t += 16) expect(step(s, t, [])).toEqual([]);
  });

  it('re-acquire emits found, keeps no stale filter state, and goes straight to the new pose', () => {
    const s = createHeadPointerState();
    settle(s, 0, face(-10, 0));
    step(s, 4000, []);
    const ev = step(s, 4100, [face(10, 0)]);
    expect(statuses(ev)).toEqual(['found']);
    expect(s.x).toBe(Math.round((10 / 15 * 0.5 + 0.5) * 1919));
  });

  it('re-acquire with two faces locks the one closest to the last known position and size', () => {
    const s = createHeadPointerState();
    const user: FaceBox = { cx: 0.3, cy: 0.5, w: 0.2, h: 0.3 };
    settle(s, 0, face(0, 0, user));
    step(s, 4000, []);
    const nearUser = face(-12, 0, { cx: 0.33, cy: 0.5, w: 0.21, h: 0.3 });
    const other = face(12, 0, { cx: 0.8, cy: 0.5, w: 0.4, h: 0.5 }); // larger, but far away
    step(s, 4100, [other, nearUser]);
    expect(s.lock.cx).toBeCloseTo(0.33, 10);
    expect(s.x).toBe(Math.round(0.1 * 1919)); // the near face's yaw of −12°, not the other's 12°
    expect(s.lockWarning).toBe(false);
  });

  it('re-acquire flags a lock that scores above LOCK_THRESHOLD, but still locks the best face', () => {
    const s = createHeadPointerState();
    settle(s, 0, face(0, 0, { cx: 0.2, cy: 0.5, w: 0.2, h: 0.3 }));
    step(s, 4000, []);
    step(s, 4100, [
      face(0, 0, { cx: 0.6, cy: 0.5, w: 0.2, h: 0.3 }),
      face(0, 0, { cx: 0.9, cy: 0.5, w: 0.2, h: 0.3 }),
    ]);
    expect(s.lock.cx).toBe(0.6);
    expect(s.lockScore).toBeGreaterThan(LOCK_THRESHOLD);
    expect(s.lockWarning).toBe(true);
    expect(s.tracking).toBe('found');
  });

  it('re-acquire with one face locks it without scoring, wherever it is', () => {
    const s = createHeadPointerState();
    settle(s, 0, face(0, 0, { cx: 0.2, cy: 0.5, w: 0.2, h: 0.3 }));
    step(s, 4000, []);
    step(s, 4100, [face(0, 0, { cx: 0.9, cy: 0.1, w: 0.05, h: 0.05 })]);
    expect(s.lock.cx).toBe(0.9);
    expect(s.lockWarning).toBe(false);
  });

  it('ignores faces with invalid boxes', () => {
    const s = createHeadPointerState();
    const ev = step(s, 0, [face(0, 0, { cx: NaN, cy: 0.5, w: 0.2, h: 0.2 }), face(0, 0, { cx: 0.5, cy: 0.5, w: 0, h: 0.2 })]);
    expect(ev).toEqual([]);
    expect(s.tracking).toBe('none');
  });
});

describe('two faces: only the locked face moves the pointer', () => {
  const user: FaceBox = { cx: 0.4, cy: 0.5, w: 0.2, h: 0.3 };
  const bystander: FaceBox = { cx: 0.8, cy: 0.4, w: 0.45, h: 0.6 }; // larger

  it('first frame with two faces locks the larger one', () => {
    const s = createHeadPointerState();
    step(s, 0, [face(0, 0, user), face(0, 0, bystander)]);
    expect(s.lock).toEqual(bystander);
  });

  it('once locked, a larger second face that appears is ignored and its movement does nothing', () => {
    const s = createHeadPointerState();
    settle(s, 0, face(5, 5, user));
    const pos = [s.x, s.y];
    for (let t = 3100; t < 6000; t += 16) {
      // the bystander swings widely; the user holds still
      const swing = 40 * Math.sin(t / 100);
      step(s, t, [face(swing, -swing, bystander), face(5, 5, user)]);
      expect([s.x, s.y]).toEqual(pos);
    }
    expect(s.lock).toEqual(user);
  });

  it('follows the locked face as it moves, by continuity of position and size', () => {
    const s = createHeadPointerState();
    step(s, 0, [face(0, 0, user)]);
    let box = { ...user };
    for (let t = 16; t < 2000; t += 16) {
      box = { ...box, cx: box.cx + 0.002, w: box.w * 1.002 };
      step(s, t, [face(-30, 0, bystander), face(10, 0, box)]);
      expect(s.lock.cx).toBeCloseTo(box.cx, 10);
    }
    expect(s.x).toBeGreaterThan(CX);
  });

  it('continuity score follows the design formula', () => {
    const lock = { cx: 0.5, cy: 0.5, w: 0.2, h: 0.2 };
    expect(continuityScore({ cx: 0.8, cy: 0.9, w: 0.4, h: 0.4 }, lock)).toBeCloseTo(0.5 + 0.5 * 1, 12);
    expect(continuityScore({ cx: 0.5, cy: 0.5, w: 0.1, h: 0.1 }, lock)).toBeCloseTo(0.5, 12);
  });

  it('a carer can re-lock onto the other face', () => {
    const s = createHeadPointerState();
    settle(s, 0, face(0, 0, user));
    step(s, 3100, [face(12, 0, bystander), face(0, 0, user)]);
    const ev = relockFace(s, 0);
    expect(ev).toEqual([{ type: 'tracking-status', status: 'found' }]);
    expect(s.lock).toEqual(bystander);
    step(s, 3116, [face(12, 0, bystander), face(0, 0, user)]);
    // the filter was reset, so the pointer goes straight to the bystander's pose
    expect(s.x).toBe(Math.round((12 / 15 * 0.5 + 0.5) * 1919));
    expect(s.lock).toEqual(bystander);
  });

  it('relockFace with an invalid index does nothing', () => {
    const s = createHeadPointerState();
    step(s, 0, [face(0, 0, user)]);
    const snap = cloneHeadPointerState(s);
    for (const i of [-1, 1, 2, 0.5, NaN]) expect(relockFace(s, i)).toEqual([]);
    expect(s).toEqual(snap);
    step(s, 16, []);
    expect(relockFace(s, 0)).toEqual([]);
  });
});

describe('no-face timeout', () => {
  const p: Profile = { ...P, noFaceTimeout: 3000 };

  it('is emitted once per loss, not on every frame while the face stays lost', () => {
    const s = createHeadPointerState();
    step(s, 0, [face(0, 0)], p);
    const all: HeadPointerEvent[] = [];
    for (let t = 1000; t <= 20000; t += 16) all.push(...step(s, t, [], p));
    expect(statuses(all)).toEqual(['lost', 'no-face-timeout']);
  });

  it('fires at noFaceTimeout after the first frameless sample', () => {
    const s = createHeadPointerState();
    step(s, 0, [face(0, 0)], p);
    step(s, 1000, [], p);
    expect(step(s, 3999, [], p)).toEqual([]);
    expect(statuses(step(s, 4000, [], p))).toEqual(['no-face-timeout']);
  });

  it('fires again after the face is found and lost again', () => {
    const s = createHeadPointerState();
    const all: HeadPointerEvent[] = [];
    all.push(...step(s, 0, [face(0, 0)], p));
    for (let t = 100; t <= 5000; t += 100) all.push(...step(s, t, [], p));
    all.push(...step(s, 5100, [face(0, 0)], p));
    for (let t = 5200; t <= 10000; t += 100) all.push(...step(s, t, [], p));
    expect(statuses(all)).toEqual(['found', 'lost', 'no-face-timeout', 'found', 'lost', 'no-face-timeout']);
  });

  it('a face returning before the timeout cancels it', () => {
    const s = createHeadPointerState();
    const all: HeadPointerEvent[] = [];
    all.push(...step(s, 0, [face(0, 0)], p));
    for (let t = 100; t <= 2900; t += 100) all.push(...step(s, t, [], p));
    all.push(...step(s, 3000, [face(0, 0)], p));
    for (let t = 3100; t <= 5000; t += 100) all.push(...step(s, t, [], p));
    expect(statuses(all)).toEqual(['found', 'lost', 'found', 'lost']);
  });

  it('also fires when no face was ever found, without a lost status', () => {
    const s = createHeadPointerState();
    const all: HeadPointerEvent[] = [];
    for (let t = 0; t <= 5000; t += 100) all.push(...step(s, t, [], p));
    expect(statuses(all)).toEqual(['no-face-timeout']);
  });
});

describe('gesture freeze (head + gesture mode)', () => {
  // release 0.3, threshold 0.5, gesture acceptance 300 ms: expiry 600 ms after the crossing
  const G: Profile = { ...P, mode: 'head + gesture', switchGesture: 'jaw open' };
  const jaw = (v: number): GestureScores => ({ jawOpen: v, browRaise: 0 });
  const brow = (v: number): GestureScores => ({ jawOpen: 0, browRaise: v });

  function setup(p: Profile = G): { s: HeadPointerState; t: number; pos: [number, number] } {
    const s = createHeadPointerState();
    const t = settle(s, 0, face(4, 2), p);
    return { s, t, pos: [s.x, s.y] };
  }

  it('starts when the score rises above the release threshold, not the gesture threshold', () => {
    const { s, t, pos } = setup();
    step(s, t, [face(4, 2, BOX, jaw(0.3))], G);
    expect(s.frozen).toBe(false);
    step(s, t + 16, [face(4, 2, BOX, jaw(0.31))], G);
    expect(s.frozen).toBe(true);
    expect([s.freezeX, s.freezeY]).toEqual(pos);
  });

  it('holds the pointer at the freeze position while the head moves, then resumes without a jump', () => {
    const { s, t, pos } = setup();
    step(s, t, [face(4, 2, BOX, jaw(0.6))], G);
    for (let k = 1; k < 40; k++) {
      const ev = step(s, t + k * 16, [face(4 + k * 0.2, 2 - k * 0.2, BOX, jaw(0.7))], G);
      expect(moves(ev)).toEqual([]);
      expect([s.x, s.y]).toEqual(pos);
      expect(selectionPointer(s)).toEqual({ x: pos[0], y: pos[1] });
    }
    const liveBefore = [s.liveX, s.liveY];
    const ev = step(s, t + 40 * 16, [face(4 + 40 * 0.2, 2 - 40 * 0.2, BOX, jaw(0.1))], G);
    expect(s.frozen).toBe(false);
    // the filter kept running, so the pointer goes to the live position, one frame on
    expect(moves(ev)).toHaveLength(1);
    expect(Math.abs(s.x - liveBefore[0])).toBeLessThan(40);
  });

  it('the freeze position is the pointer shown before the crossing sample, even if the head moves on it', () => {
    const { s, t, pos } = setup();
    step(s, t, [face(14, -14, BOX, jaw(0.5))], G);
    expect([s.freezeX, s.freezeY]).toEqual(pos);
  });

  it('expires after gestureAcceptanceTime + 300 ms if the gesture threshold is not reached', () => {
    const { s, t } = setup();
    expect(FREEZE_EXPIRY_EXTRA_MS).toBe(300);
    step(s, t, [face(4, 2, BOX, jaw(0.4))], G);
    expect(s.frozen).toBe(true);
    step(s, t + 599, [face(4, 2, BOX, jaw(0.45))], G);
    expect(s.frozen).toBe(true);
    const ev = step(s, t + 600, [face(10, 2, BOX, jaw(0.45))], G);
    expect(s.frozen).toBe(false);
    // only pointer events: the head pointer never emits a press
    expect(ev.every((e) => e.type === 'pointer-move')).toBe(true);
    expect(selectionPointer(s)).toEqual({ x: s.x, y: s.y });
  });

  it('after expiry it does not freeze again until the score drops below the release threshold', () => {
    const { s, t } = setup();
    step(s, t, [face(4, 2, BOX, jaw(0.4))], G);
    step(s, t + 600, [face(4, 2, BOX, jaw(0.4))], G);
    expect(s.frozen).toBe(false);
    step(s, t + 700, [face(4, 2, BOX, jaw(0.9))], G);
    expect(s.frozen).toBe(false);
    step(s, t + 800, [face(4, 2, BOX, jaw(0.1))], G);
    step(s, t + 900, [face(4, 2, BOX, jaw(0.6))], G);
    expect(s.frozen).toBe(true);
  });

  it('does not expire once the gesture threshold was reached within the window', () => {
    const { s, t } = setup();
    step(s, t, [face(4, 2, BOX, jaw(0.4))], G);
    step(s, t + 600, [face(4, 2, BOX, jaw(0.5))], G); // reached exactly at the expiry time
    step(s, t + 3000, [face(4, 2, BOX, jaw(0.45))], G);
    expect(s.frozen).toBe(true);
  });

  it('a brow raise does not freeze the pointer when the switch gesture is jaw open', () => {
    const { s, t, pos } = setup();
    for (let k = 0; k < 30; k++) step(s, t + k * 16, [face(4 + k, 2, BOX, brow(0.95))], G);
    expect(s.frozen).toBe(false);
    expect(s.x).not.toBe(pos[0]);
  });

  it('a jaw open does not freeze the pointer when the switch gesture is brow raise', () => {
    const p: Profile = { ...G, switchGesture: 'brow raise' };
    const { s, t } = setup(p);
    step(s, t, [face(4, 2, BOX, jaw(0.95))], p);
    expect(s.frozen).toBe(false);
    step(s, t + 16, [face(4, 2, BOX, brow(0.95))], p);
    expect(s.frozen).toBe(true);
  });

  it('never freezes in head + dwell mode', () => {
    const p: Profile = { ...P, mode: 'head + dwell' };
    const { s, t } = setup(p);
    for (let k = 0; k < 30; k++) step(s, t + k * 16, [face(4 + k, 2, BOX, jaw(0.95))], p);
    expect(s.frozen).toBe(false);
  });

  it('uses the locked face\'s scores, not a bystander\'s', () => {
    const user: FaceBox = { cx: 0.4, cy: 0.5, w: 0.2, h: 0.3 };
    const other: FaceBox = { cx: 0.8, cy: 0.5, w: 0.4, h: 0.5 };
    const s = createHeadPointerState();
    settle(s, 0, face(4, 2, user), G);
    step(s, 4000, [face(0, 0, other, jaw(0.95)), face(4, 2, user, jaw(0))], G);
    expect(s.frozen).toBe(false);
    step(s, 4016, [face(0, 0, other, jaw(0)), face(4, 2, user, jaw(0.95))], G);
    expect(s.frozen).toBe(true);
  });

  it('falls back to the sample-level scores when the face has none', () => {
    const { s, t } = setup();
    step(s, t, [face(4, 2)], G, { gestureScores: jaw(0.9) });
    expect(s.frozen).toBe(true);
  });

  it('losing the face clears the freeze', () => {
    const { s, t } = setup();
    step(s, t, [face(4, 2, BOX, jaw(0.9))], G);
    step(s, t + 16, [], G);
    expect(s.frozen).toBe(false);
    expect(selectionPointer(s)).toBeNull();
  });

  it('P10 counterexample: a screen that shrinks during a freeze keeps the selection pointer on screen', () => {
    // Found by P10: the freeze position kept y = 1 after the screen shrank to 1 x 1.
    const p: Profile = { ...G, switchGesture: 'brow raise', gestureThreshold: 0.1, gestureReleaseThreshold: 0.05 };
    const s = createHeadPointerState();
    step(s, 1, [face(0, 0)], p, { screen: { width: 1, height: 2 } });
    expect(s.y).toBe(1);
    step(s, 2, [face(0, Infinity, BOX, { jawOpen: Infinity, browRaise: 1e308 })], p, { screen: { width: 1, height: 1 } });
    expect(s.frozen).toBe(true);
    expect(selectionPointer(s)).toEqual({ x: 0, y: 0 });
  });

  it('switching out of head + gesture mode clears the freeze', () => {
    const { s, t } = setup();
    step(s, t, [face(4, 2, BOX, jaw(0.9))], G);
    step(s, t + 16, [face(4, 2, BOX, jaw(0.9))], { ...G, mode: 'head + dwell' });
    expect(s.frozen).toBe(false);
  });
});

describe('timestamps and cloning', () => {
  it('ignores duplicate, backwards and non-finite timestamps', () => {
    const s = createHeadPointerState();
    step(s, 100, [face(3, 3)]);
    const snap = cloneHeadPointerState(s);
    for (const t of [100, 50, NaN, Infinity]) expect(step(s, t, [face(10, 10)])).toEqual([]);
    expect(s).toEqual(snap);
  });

  it('a clone evolves identically and independently', () => {
    const s = createHeadPointerState();
    settle(s, 0, face(3, 3), P, 500);
    const c = cloneHeadPointerState(s);
    for (let t = 600; t < 1500; t += 16) {
      expect(step(c, t, [face(8, -2)])).toEqual(step(s, t, [face(8, -2)]));
    }
    const d = cloneHeadPointerState(c);
    step(c, 2000, []);
    expect(d.tracking).toBe('found');
    expect(c.tracking).toBe('lost');
    expect(d.lock).not.toBe(c.lock);
    expect(d.smootherX).not.toBe(c.smootherX);
  });
});
