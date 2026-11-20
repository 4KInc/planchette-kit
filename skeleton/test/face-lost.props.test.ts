/**
 * P3 in full — face lost means no selection (Task 15.1; Req 2 AC 10, Req 5 AC 6).
 *
 * Through createPlanchette + feedSamples, in head + dwell and head + gesture mode: camera
 * samples alternate between found periods (the head resting on random targets, random
 * gesture scores) and lost periods of random length. Lost periods are of four kinds:
 *  - lost: frames with no face;
 *  - no-face-timeout: frames with no face for longer than the no-face timeout;
 *  - permission-denied and load-failed: the camera fails (a real failure from the fake
 *    camera environment: startCamera() is rejected, or the model does not load) and no
 *    camera frame arrives until it is retried.
 * Keyboard samples keep arriving through every period. No `select` and no `cancel` (no
 * press) may be emitted while a lost period lasts.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { InputMode, TimestampedSample } from '../src/api-types';
import { createPlanchetteInternal } from '../src/planchette';
import { FakeCameraEnv } from './fakes';
import { rotationFor } from './pointer-path';

const KINDS = ['found', 'lost', 'no-face-timeout', 'permission-denied', 'load-failed'] as const;
type Kind = (typeof KINDS)[number];

const TARGETS = [
  { id: 'a', rect: { x: 0, y: 0, width: 480, height: 380 } },
  { id: 'b', rect: { x: 520, y: 0, width: 480, height: 380 } },
  { id: 'c', rect: { x: 0, y: 420, width: 480, height: 380 } },
  { id: 'd', rect: { x: 520, y: 420, width: 480, height: 380 } },
];

const periodArb = fc.record({
  kind: fc.constantFrom<Kind>('found', 'found', 'found', 'lost', 'lost', 'no-face-timeout', 'permission-denied', 'load-failed'),
  ms: fc.integer({ min: 30, max: 3000 }),
  target: fc.integer({ min: 0, max: 3 }),
  jaw: fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 6 }), // scores cycled per frame
  jawFrames: fc.integer({ min: 1, max: 40 }), // frames per score
});

const caseArb = fc.record({
  mode: fc.constantFrom<InputMode>('head + dwell', 'head + gesture'),
  dwellTime: fc.integer({ min: 400, max: 1500 }),
  cancelByHold: fc.boolean(),
  periods: fc.array(periodArb, { minLength: 2, maxLength: 12 }),
  dt: fc.integer({ min: 16, max: 50 }),
});

let selectsInFound = 0; // over all runs: the property is not passing vacuously

describe('P3: face lost means no selection', () => {
  it('no select and no press during any lost period, whatever caused it', async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async (c) => {
        const cam = new FakeCameraEnv();
        const { planchette: p } = createPlanchetteInternal(
          {
            screen: { width: 1000, height: 800 },
            profile: { mode: c.mode, dwellTime: c.dwellTime, cancelByHold: c.cancelByHold, noFaceTimeout: 3000, gestureAcceptanceTime: 100 },
          },
          { camera: cam },
        );
        for (const t of TARGETS) p.registerTarget(t.id, t.rect);
        let lostNow = false;
        const bad: string[] = [];
        const onEvent = (type: string) => () => {
          if (lostNow) bad.push(type);
          else if (type === 'select') selectsInFound++;
        };
        p.addEventListener('select', onEvent('select'));
        p.addEventListener('cancel', onEvent('cancel'));

        let camT = 0;
        let keyT = 0;
        const tick = (camera: TimestampedSample | null): void => {
          // A keyboard sample (switch released) between camera frames, through every period.
          p.feedSamples([{ now: (keyT += c.dt), source: 'keyboard', signal: false }]);
          if (camera !== null) p.feedSamples([camera]);
        };
        // A found start, so the start-up centre step can complete early on.
        const periods = [{ kind: 'found' as Kind, ms: 1800, target: 0, jaw: [0], jawFrames: 1 }, ...c.periods];
        for (const period of periods) {
          const frames = Math.max(1, Math.round(period.ms / c.dt));
          if (period.kind === 'permission-denied' || period.kind === 'load-failed') {
            // A real camera failure, then no frames until the camera is retried.
            p.stopCamera();
            if (period.kind === 'permission-denied') cam.denyWith = 'NotAllowedError';
            else cam.failLoads = 1;
            lostNow = true;
            await p.startCamera();
            cam.denyWith = null;
            for (let i = 0; i < frames; i++) tick(null);
            lostNow = false;
            continue;
          }
          const lostKind = period.kind !== 'found';
          const n = period.kind === 'no-face-timeout' ? Math.ceil(3100 / c.dt) + frames : frames;
          const t = TARGETS[period.target].rect;
          const at = rotationFor(t.x + t.width / 2, t.y + t.height / 2);
          for (let i = 0; i < n; i++) {
            lostNow = lostKind;
            const jaw = period.jaw[Math.floor(i / period.jawFrames) % period.jaw.length];
            tick({
              now: (camT += c.dt),
              source: 'camera',
              faces: lostKind ? [] : [{ bbox: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.3 }, rotation: at, gestureScores: { jawOpen: jaw, browRaise: 0 } }],
            });
          }
          lostNow = false;
        }
        expect(bad).toEqual([]);
      }),
      { numRuns: 200 },
    );
    expect(selectsInFound).toBeGreaterThan(0);
  });
});
