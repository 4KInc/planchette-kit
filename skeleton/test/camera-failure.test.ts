/**
 * Task 14.7 — each camera failure case, with a fake camera (no real camera): the right
 * `tracking-status`, and switch scanning and mouse mode still select during and after the
 * failure (Req 8 AC 1–4).
 */
import { describe, expect, it } from 'vitest';
import type { InputMode, PlanchetteEventMap, TimestampedSample } from '../src/api-types';
import { createPlanchetteInternal } from '../src/planchette';
import { FakeCameraEnv, FakeDom, faceResult } from './fakes';

type Reason = 'permission-denied' | 'load-failed' | 'no-face-timeout';

function setup(mode: InputMode) {
  const cam = new FakeCameraEnv();
  const { planchette: p } = createPlanchetteInternal(
    { screen: { width: 1000, height: 800 }, profile: { mode, cancelByHold: false, scanInterval: 600, noFaceTimeout: 3000 } },
    { camera: cam, dom: new FakeDom() },
  );
  p.registerTarget('a', { x: 0, y: 0, width: 400, height: 400 });
  p.registerTarget('b', { x: 500, y: 0, width: 400, height: 400 });
  const status: Array<PlanchetteEventMap['tracking-status']> = [];
  const selects: Array<PlanchetteEventMap['select']> = [];
  p.addEventListener('tracking-status', (e) => status.push(e.detail));
  p.addEventListener('select', (e) => selects.push(e.detail));
  let t = 0;
  /** Switch presses from the keyboard source, 16 ms samples. */
  const press = (): void => {
    const s: TimestampedSample[] = [];
    for (let i = 0; i < 3; i++) s.push({ now: (t += 16), source: 'keyboard', signal: false });
    for (let i = 0; i < 4; i++) s.push({ now: (t += 16), source: 'keyboard', signal: true });
    for (let i = 0; i < 3; i++) s.push({ now: (t += 16), source: 'keyboard', signal: false });
    p.feedSamples(s);
  };
  /** A mouse click at (x, y). */
  const click = (x: number, y: number): void => {
    const s: TimestampedSample[] = [];
    for (const signal of [false, true, true, false, false]) s.push({ now: (t += 16), source: 'mouse', pointer: { x, y }, signal });
    p.feedSamples(s);
  };
  async function fail(reason: Reason): Promise<void> {
    if (reason === 'permission-denied') cam.denyWith = 'NotAllowedError';
    if (reason === 'load-failed') cam.failLoads = 1;
    await p.startCamera();
    if (reason === 'no-face-timeout') for (let i = 0; i < 100; i++) cam.frame({ faceLandmarks: [] }); // 3.3 s, no face
  }
  return { cam, p, status, selects, press, click, fail };
}

const REASONS: Reason[] = ['permission-denied', 'load-failed', 'no-face-timeout'];

describe.each(REASONS)('camera failure: %s', (reason) => {
  it('emits tracking-status with that reason, once', async () => {
    const t = setup('scan');
    await t.fail(reason);
    expect(t.status.filter((s) => s.status === reason)).toHaveLength(1);
    expect(t.status.find((s) => s.status === reason)!.alternatives).toEqual(['scan', 'mouse']);
  });

  it('switch scanning selects during the failure and after a retry', async () => {
    const t = setup('scan');
    await t.fail(reason);
    t.press();
    expect(t.selects).toHaveLength(1);
    expect(t.selects[0].source).toBe('scan');
    // the camera comes back
    t.cam.denyWith = null;
    t.p.stopCamera();
    await t.p.startCamera();
    t.cam.frame(faceResult());
    t.press();
    expect(t.selects).toHaveLength(2);
  });

  it('mouse mode selects during the failure and after it', async () => {
    const t = setup('mouse');
    await t.fail(reason);
    t.click(100, 100);
    t.click(600, 100);
    expect(t.selects.map((s) => [s.targetId, s.source])).toEqual([
      ['a', 'mouse'],
      ['b', 'mouse'],
    ]);
    t.p.stopCamera();
    t.click(100, 100);
    expect(t.selects).toHaveLength(3);
  });

  it('switching to a mode offered by the failure works without re-registering targets', async () => {
    const t = setup('head + dwell');
    await t.fail(reason);
    t.p.setMode('scan');
    t.press();
    expect(t.selects).toHaveLength(1);
  });
});

describe('the no-face timeout through the camera adapter (14.4)', () => {
  it('fires once per loss, from frameless frames sent by the adapter', async () => {
    const t = setup('scan');
    await t.p.startCamera();
    for (let i = 0; i < 300; i++) t.cam.frame({ faceLandmarks: [] }); // 10 s
    expect(t.status.filter((s) => s.status === 'no-face-timeout')).toHaveLength(1);
    t.cam.frame(faceResult());
    for (let i = 0; i < 100; i++) t.cam.frame({ faceLandmarks: [] });
    expect(t.status.map((s) => s.status)).toEqual(['no-face-timeout', 'found', 'lost', 'no-face-timeout']);
  });

  it('does not fire while a face is seen', async () => {
    const t = setup('scan');
    await t.p.startCamera();
    for (let i = 0; i < 300; i++) t.cam.frame(faceResult());
    expect(t.status.map((s) => s.status)).toEqual(['found']);
  });
});

describe('the head modes do not select while the camera has failed', () => {
  it.each(REASONS)('%s: no dwell or gesture selection', async (reason) => {
    for (const mode of ['head + dwell', 'head + gesture'] as const) {
      const t = setup(mode);
      await t.fail(reason);
      expect(t.selects).toEqual([]);
    }
  });
});
