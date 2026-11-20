/**
 * P21 — camera unavailable, other modes still work (Task 14.8, Req 8 AC 3).
 *
 * With the camera put into each failure state before any input (permission denied, load
 * failure, no-face timeout), random switch-scanning and mouse input sequences still
 * produce selections without error, and `tracking-status` carries the right reason.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { PlanchetteEventMap, TimestampedSample } from '../src/api-types';
import { createPlanchetteInternal } from '../src/planchette';
import { FakeCameraEnv, FakeDom } from './fakes';

const REASONS = ['permission-denied', 'load-failed', 'no-face-timeout'] as const;
type Reason = (typeof REASONS)[number];

async function failedInstance(reason: Reason, mode: 'scan' | 'mouse', profile: Record<string, unknown>) {
  const cam = new FakeCameraEnv();
  const { planchette: p } = createPlanchetteInternal(
    { screen: { width: 1000, height: 800 }, profile: { mode, noFaceTimeout: 3000, ...profile } },
    { camera: cam, dom: new FakeDom() },
  );
  const status: Array<PlanchetteEventMap['tracking-status']> = [];
  const selects: Array<PlanchetteEventMap['select']> = [];
  p.addEventListener('tracking-status', (e) => status.push(e.detail));
  p.addEventListener('select', (e) => selects.push(e.detail));
  if (reason === 'permission-denied') cam.denyWith = 'NotAllowedError';
  if (reason === 'load-failed') cam.failLoads = 1;
  await p.startCamera();
  if (reason === 'no-face-timeout') for (let i = 0; i < 100; i++) cam.frame({ faceLandmarks: [] });
  return { p, status, selects };
}

/** A press: released for `gap` ms, then held for `hold` ms, sampled every `dt` ms. */
const pressArb = fc.record({
  gap: fc.integer({ min: 40, max: 3000 }),
  hold: fc.integer({ min: 40, max: 900 }), // below the cancel hold time (1000 ms here)
});

const targetsArb = fc.uniqueArray(fc.integer({ min: 0, max: 11 }), { minLength: 1, maxLength: 8 }).map((cells) =>
  cells.map((c) => ({ id: `t${c}`, rect: { x: (c % 4) * 250 + 10, y: Math.floor(c / 4) * 260 + 10, width: 200, height: 200 } })),
);

describe('P21: camera unavailable, scanning and mouse still select', () => {
  it('switch scanning: the failure changes nothing, and presses still select', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...REASONS),
        targetsArb,
        fc.array(pressArb, { minLength: 0, maxLength: 8 }),
        fc.constantFrom('keyboard', 'gamepad', 'mouse', 'synthetic'),
        fc.integer({ min: 8, max: 40 }),
        async (reason, targets, presses, source, dt) => {
          const profile = { cancelByHold: true, cancelHoldTime: 1000, scanInterval: 500, postSelectionPause: 200 };
          const failed = await failedInstance(reason, 'scan', profile);
          expect(failed.status.filter((x) => x.status === reason)).toHaveLength(1);
          // The same input to an instance whose camera was never started.
          const clean = createPlanchetteInternal({ screen: { width: 1000, height: 800 }, profile: { mode: 'scan', noFaceTimeout: 3000, ...profile } }).planchette;
          const runs = [failed.p, clean].map((p) => {
            const log: string[] = [];
            for (const type of ['highlight', 'select', 'cancel'] as const) p.addEventListener(type, (e) => log.push(`${type}:${JSON.stringify((e as CustomEvent).detail)}`));
            for (const x of targets) p.registerTarget(x.id, x.rect);
            return log;
          });
          let now = 0;
          const samples: TimestampedSample[] = [];
          const add = (ms: number, signal: boolean): void => {
            for (let e = 0; e < ms; e += dt) samples.push({ now: (now += dt), source, signal });
          };
          for (const { gap, hold } of presses) {
            add(gap, false);
            add(hold, true);
          }
          // Then: silence past the input timeout (back to the top of the cycle), and up to
          // three quick presses: one may resume a paused scan, one may enter a row, and the
          // next selects the first item.
          add(2100, false);
          for (let k = 0; k < 3; k++) {
            add(250, false);
            add(100, true);
          }
          add(100, false);
          for (const p of [failed.p, clean]) expect(() => p.feedSamples(samples)).not.toThrow();
          expect(runs[0]).toEqual(runs[1]);
          expect(failed.selects.length).toBeGreaterThan(0);
          expect(failed.selects.every((x) => x.source === 'scan')).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('mouse mode: a click on any target selects it', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...REASONS),
        targetsArb,
        fc.array(fc.tuple(fc.integer({ min: 0, max: 7 }), fc.double({ min: 0.05, max: 0.95, noNaN: true }), fc.double({ min: 0.05, max: 0.95, noNaN: true })), { minLength: 1, maxLength: 6 }),
        fc.integer({ min: 8, max: 40 }),
        async (reason, targets, clicks, dt) => {
          const t = await failedInstance(reason, 'mouse', { cancelByHold: true, cancelHoldTime: 1000 });
          for (const x of targets) t.p.registerTarget(x.id, x.rect);
          expect(t.status.filter((s) => s.status === reason)).toHaveLength(1);
          let now = 0;
          const expected: string[] = [];
          for (const [i, fx, fy] of clicks) {
            const target = targets[i % targets.length];
            const pointer = { x: target.rect.x + fx * target.rect.width, y: target.rect.y + fy * target.rect.height };
            expected.push(target.id);
            const s: TimestampedSample[] = [];
            for (const signal of [false, false, true, true, true, false, false]) s.push({ now: (now += dt), source: 'mouse', pointer, signal });
            expect(() => t.p.feedSamples(s)).not.toThrow();
          }
          expect(t.selects.map((s) => s.targetId)).toEqual(expected);
          expect(t.selects.every((s) => s.source === 'mouse')).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
