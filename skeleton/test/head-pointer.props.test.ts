/**
 * Head-pointer properties:
 *  P10 pointer bounded
 *  P11 every target reachable (inverse formula, then fed forward through the real engine)
 *  P13 gesture does not drift the selection
 *  P20 talking does not freeze the pointer in head + dwell mode
 *  P16 per-source timestamp ordering: camera samples delayed 20–80 ms behind a switch
 *      stream are never dropped
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  createHeadPointerState,
  selectionPointer,
  stepHeadPointer,
  type DetectedFace,
  type FaceBox,
  type HeadPointerEvent,
} from '../src/engine/head-pointer';
import { createPressMachineState, stepPress, type PressEvent } from '../src/engine/press-machine';
import { clampProfile, defaultProfile, type Profile } from '../src/engine/profile';

const f32 = Math.fround;
const BOX: FaceBox = { cx: 0.5, cy: 0.5, w: 0.3, h: 0.4 };

/** Valid profiles over the ranges the head pointer reads. clampProfile enforces D ≤ 0.5 × min R. */
const profileArb: fc.Arbitrary<Profile> = fc
  .record({
    calibrationRangeLeft: fc.double({ min: 3, max: 90, noNaN: true }),
    calibrationRangeRight: fc.double({ min: 3, max: 90, noNaN: true }),
    calibrationRangeUp: fc.double({ min: 3, max: 90, noNaN: true }),
    calibrationRangeDown: fc.double({ min: 3, max: 90, noNaN: true }),
    headDeadZone: fc.oneof(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 45, noNaN: true })),
    headGain: fc.double({ min: 1, max: 2, noNaN: true }),
    smoothingStrength: fc.double({ min: 0, max: 1, noNaN: true }),
    gestureThreshold: fc.double({ min: 0.1, max: 0.95, noNaN: true }),
    gestureReleaseThreshold: fc.double({ min: 0.05, max: 0.9, noNaN: true }),
    gestureAcceptanceTime: fc.integer({ min: 100, max: 2000 }),
    noFaceTimeout: fc.integer({ min: 3000, max: 60000 }),
    switchGesture: fc.constantFrom('jaw open' as const, 'brow raise' as const),
  })
  .map((r) => clampProfile(r));

const screenArb = fc.record({ width: fc.integer({ min: 1, max: 5000 }), height: fc.integer({ min: 1, max: 5000 }) });

describe('P10 pointer bounded', () => {
  const wildNumber = fc.oneof(
    fc.double(), // includes NaN, ±Infinity, ±0 and extremes
    fc.constantFrom(Infinity, -Infinity, NaN, Number.MAX_VALUE, -Number.MAX_VALUE),
    fc.double({ min: -200, max: 200, noNaN: true }),
  );
  const faceArb = fc.record({
    bbox: fc.record({
      cx: fc.oneof(fc.double({ min: 0, max: 1, noNaN: true }), wildNumber),
      cy: fc.double({ min: 0, max: 1, noNaN: true }),
      w: fc.oneof(fc.double({ min: 0.01, max: 1, noNaN: true }), wildNumber),
      h: fc.double({ min: 0.01, max: 1, noNaN: true }),
    }),
    rotation: fc.record({ yaw: wildNumber, pitch: wildNumber }),
    gestureScores: fc.option(fc.record({ jawOpen: wildNumber, browRaise: wildNumber }), { nil: undefined }),
  });

  it('every pointer-move and the stored pointer stay inside the current screen, whatever the input', () => {
    fc.assert(
      fc.property(
        profileArb,
        fc.constantFrom('head + dwell' as const, 'head + gesture' as const),
        fc.record({ yaw: wildNumber, pitch: wildNumber }),
        fc.array(
          fc.record({
            gap: fc.integer({ min: 1, max: 500 }),
            faces: fc.array(faceArb, { maxLength: 3 }),
            screen: fc.option(screenArb, { nil: undefined }),
          }),
          { minLength: 1, maxLength: 80 },
        ),
        screenArb,
        (p, mode, centre, samples, firstScreen) => {
          const profile = { ...p, mode };
          const s = createHeadPointerState();
          let screen = firstScreen;
          let t = 0;
          for (const smp of samples) {
            t += smp.gap;
            if (smp.screen) screen = smp.screen;
            const ev = stepHeadPointer(s, { faces: smp.faces as DetectedFace[], screen, centre }, t, profile);
            for (const e of ev) {
              if (e.type !== 'pointer-move') continue;
              expect(Number.isInteger(e.x) && Number.isInteger(e.y)).toBe(true);
              expect(e.x).toBeGreaterThanOrEqual(0);
              expect(e.x).toBeLessThanOrEqual(screen.width - 1);
              expect(e.y).toBeGreaterThanOrEqual(0);
              expect(e.y).toBeLessThanOrEqual(screen.height - 1);
            }
            if (s.hasPointer) {
              expect(s.x).toBeGreaterThanOrEqual(0);
              expect(s.x).toBeLessThanOrEqual(screen.width - 1);
              expect(s.y).toBeGreaterThanOrEqual(0);
              expect(s.y).toBeLessThanOrEqual(screen.height - 1);
            }
            const sel = selectionPointer(s);
            if (sel !== null) {
              expect(sel.x).toBeGreaterThanOrEqual(0);
              expect(sel.x).toBeLessThanOrEqual(screen.width - 1);
              expect(sel.y).toBeGreaterThanOrEqual(0);
              expect(sel.y).toBeLessThanOrEqual(screen.height - 1);
            }
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('P11 every target reachable', () => {
  /**
   * Inverse of the design §1 mapping for one axis. `u` in [0, 1]; positive deflection uses rPos.
   * Returns the centred rotation δ (degrees) that should map to u.
   */
  function inverse(u: number, rPos: number, rNeg: number, D: number, G: number): number {
    const rEff = (u >= 0.5 ? rPos : rNeg) - D;
    const dz = (u - 0.5) * 2 * (rEff / G);
    if (dz === 0) return 0;
    return Math.sign(dz) * (Math.abs(dz) + D);
  }

  function targetAngles(p: Profile, screen: { width: number; height: number }, px: number, py: number) {
    const ux = screen.width > 1 ? px / (screen.width - 1) : 0.5;
    const uyUp = screen.height > 1 ? 1 - py / (screen.height - 1) : 0.5; // up is smaller y
    const D = p.headDeadZone;
    const G = p.headGain;
    return {
      dx: inverse(ux, p.calibrationRangeRight, p.calibrationRangeLeft, D, G),
      dy: inverse(uyUp, p.calibrationRangeUp, p.calibrationRangeDown, D, G),
    };
  }

  const caseArb = fc
    .record({
      profile: profileArb,
      screen: screenArb,
      fx: fc.double({ min: 0, max: 1, noNaN: true }),
      fy: fc.double({ min: 0, max: 1, noNaN: true }),
      centre: fc.record({
        yaw: fc.double({ min: -30, max: 30, noNaN: true }),
        pitch: fc.double({ min: -30, max: 30, noNaN: true }),
      }),
      edge: fc.constantFrom('none', 'left', 'right', 'top', 'bottom', 'corner'),
    })
    .map((c) => {
      let px = Math.min(c.screen.width - 1, Math.floor(c.fx * c.screen.width));
      let py = Math.min(c.screen.height - 1, Math.floor(c.fy * c.screen.height));
      if (c.edge === 'left') px = 0;
      if (c.edge === 'right') px = c.screen.width - 1;
      if (c.edge === 'top') py = 0;
      if (c.edge === 'bottom') py = c.screen.height - 1;
      if (c.edge === 'corner') {
        px = c.screen.width - 1;
        py = 0;
      }
      return { ...c, px, py };
    });

  it('the inverse rotation stays within the calibrated range, and the real engine maps it to the target pixel', () => {
    fc.assert(
      fc.property(caseArb, ({ profile, screen, centre, px, py }) => {
        const { dx, dy } = targetAngles(profile, screen, px, py);
        // The rotation needed never exceeds the calibrated range on its side.
        const rx = dx >= 0 ? profile.calibrationRangeRight : profile.calibrationRangeLeft;
        const ry = dy >= 0 ? profile.calibrationRangeUp : profile.calibrationRangeDown;
        expect(Math.abs(dx)).toBeLessThanOrEqual(rx + 1e-9);
        expect(Math.abs(dy)).toBeLessThanOrEqual(ry + 1e-9);

        // Feed forward through the real engine (smoother, dead zone, gain, clamp, rounding).
        const s = createHeadPointerState();
        const f: DetectedFace = { bbox: BOX, rotation: { yaw: centre.yaw + dx, pitch: centre.pitch + dy } };
        stepHeadPointer(s, { faces: [f], screen, centre }, 0, profile);
        expect(Math.abs(s.x - px)).toBeLessThanOrEqual(1);
        expect(Math.abs(s.y - py)).toBeLessThanOrEqual(1);
      }),
      { numRuns: 2000 },
    );
  });

  it('also lands on the target after moving there from another pose and holding still', () => {
    fc.assert(
      fc.property(
        caseArb,
        fc.record({ yaw: fc.double({ min: -20, max: 20, noNaN: true }), pitch: fc.double({ min: -20, max: 20, noNaN: true }) }),
        ({ profile, screen, centre, px, py }, startOffset) => {
          const { dx, dy } = targetAngles(profile, screen, px, py);
          const s = createHeadPointerState();
          const at = (yaw: number, pitch: number): DetectedFace => ({ bbox: BOX, rotation: { yaw, pitch } });
          stepHeadPointer(s, { faces: [at(centre.yaw + startOffset.yaw, centre.pitch + startOffset.pitch)], screen, centre }, 0, profile);
          // Hold the target pose for 40 s at 30 fps: the filter settles on it.
          for (let k = 1; k <= 1200; k++) {
            stepHeadPointer(s, { faces: [at(centre.yaw + dx, centre.pitch + dy)], screen, centre }, k * (1000 / 30), profile);
          }
          expect(Math.abs(s.x - px)).toBeLessThanOrEqual(1);
          expect(Math.abs(s.y - py)).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('a mapping that ignored the dead zone would be caught (sanity check of this test)', () => {
    const p = clampProfile({ ...defaultProfile, headDeadZone: 1.5, calibrationRangeRight: 10 });
    const screen = { width: 1920, height: 1080 };
    // Without adding D back in the inverse, the engine would land short of the edge.
    const dzOnly = (0.5 * 2 * (10 - 1.5)) / 1;
    const s = createHeadPointerState();
    stepHeadPointer(s, { faces: [{ bbox: BOX, rotation: { yaw: dzOnly, pitch: 0 } }], screen, centre: { yaw: 0, pitch: 0 } }, 0, p);
    expect(s.x).toBeLessThan(1919 - 1);
    expect(f32(1)).toBe(1);
  });
});

describe('P13 gesture does not drift the selection', () => {
  it('during a freeze the selection pointer stays at the pointer shown before the release-threshold crossing', () => {
    fc.assert(
      fc.property(
        profileArb,
        fc.record({ yaw: fc.double({ min: -10, max: 10, noNaN: true }), pitch: fc.double({ min: -10, max: 10, noNaN: true }) }),
        fc.array(
          fc.record({
            yaw: fc.double({ min: -40, max: 40, noNaN: true }),
            pitch: fc.double({ min: -40, max: 40, noNaN: true }),
            gap: fc.integer({ min: 5, max: 60 }),
          }),
          { minLength: 1, maxLength: 120 },
        ),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (p, pose, headPath, scoreFrac) => {
          const profile: Profile = { ...p, mode: 'head + gesture' };
          const screen = { width: 1920, height: 1080 };
          const centre = { yaw: 0, pitch: 0 };
          const key = profile.switchGesture === 'jaw open' ? 'jawOpen' : 'browRaise';
          const scores = (v: number) => ({ jawOpen: 0, browRaise: 0, [key]: v });
          const at = (yaw: number, pitch: number, v: number): DetectedFace => ({
            bbox: BOX,
            rotation: { yaw, pitch },
            gestureScores: scores(v),
          });
          const s = createHeadPointerState();
          let t = 0;
          for (let k = 0; k < 60; k++, t += 16) stepHeadPointer(s, { faces: [at(pose.yaw, pose.pitch, 0)], screen, centre }, t, profile);
          const shownBefore = { x: s.x, y: s.y };

          // The score crosses the release threshold, reaches the gesture threshold, and stays
          // at or above it (so above the release threshold) while the head moves anywhere.
          const rel = profile.gestureReleaseThreshold;
          const thr = profile.gestureThreshold;
          const held = thr + (1 - thr) * scoreFrac;
          stepHeadPointer(s, { faces: [at(headPath[0].yaw, headPath[0].pitch, held)], screen, centre }, t, profile);
          expect(held).toBeGreaterThan(rel);
          expect(s.frozen).toBe(true);
          for (const step of headPath) {
            t += step.gap;
            const ev = stepHeadPointer(s, { faces: [at(step.yaw, step.pitch, held)], screen, centre }, t, profile);
            expect(ev.filter((e) => e.type === 'pointer-move')).toEqual([]);
            expect(selectionPointer(s)).toEqual(shownBefore);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('P20 talking does not freeze the pointer', () => {
  it('in head + dwell mode, gesture scores never change the pointer events', () => {
    const scoreArb = fc.oneof(fc.double({ min: 0, max: 1, noNaN: true }), fc.constant(1), fc.constant(0.99));
    fc.assert(
      fc.property(
        profileArb,
        fc.array(
          fc.record({
            gap: fc.integer({ min: 1, max: 200 }),
            present: fc.boolean(),
            yaw: fc.double({ min: -60, max: 60, noNaN: true }),
            pitch: fc.double({ min: -60, max: 60, noNaN: true }),
            jaw: scoreArb,
            brow: scoreArb,
            onFace: fc.boolean(),
          }),
          { minLength: 1, maxLength: 150 },
        ),
        (p, samples) => {
          const profile: Profile = { ...p, mode: 'head + dwell' };
          const screen = { width: 1920, height: 1080 };
          const centre = { yaw: 0, pitch: 0 };
          const a = createHeadPointerState();
          const b = createHeadPointerState();
          let t = 0;
          for (const smp of samples) {
            t += smp.gap;
            const g = { jawOpen: smp.jaw, browRaise: smp.brow };
            const plain: DetectedFace[] = smp.present ? [{ bbox: BOX, rotation: { yaw: smp.yaw, pitch: smp.pitch } }] : [];
            const talking: DetectedFace[] = smp.present
              ? [{ bbox: BOX, rotation: { yaw: smp.yaw, pitch: smp.pitch }, gestureScores: smp.onFace ? g : undefined }]
              : [];
            const evA = stepHeadPointer(a, { faces: plain, screen, centre }, t, profile);
            const evB = stepHeadPointer(b, { faces: talking, gestureScores: smp.onFace ? undefined : g, screen, centre }, t, profile);
            expect(evB).toEqual(evA);
            expect(b.frozen).toBe(false);
            expect(selectionPointer(b)).toEqual(selectionPointer(a));
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('P16 per-source timestamp ordering (camera vs switch)', () => {
  type Sample =
    | { source: 'camera'; now: number; face: DetectedFace | null }
    | { source: 'keyboard'; now: number; signal: boolean };

  /** Route samples by source; each engine has its own clock and drops only its own bad timestamps. */
  function route(samples: Sample[], profile: Profile) {
    const hp = createHeadPointerState();
    const pm = createPressMachineState();
    const hpEvents: Array<{ now: number; e: HeadPointerEvent }> = [];
    const pmEvents: Array<{ now: number; e: PressEvent }> = [];
    for (const smp of samples) {
      if (smp.source === 'camera') {
        const faces = smp.face ? [smp.face] : [];
        for (const e of stepHeadPointer(hp, { faces, screen: { width: 1920, height: 1080 }, centre: { yaw: 0, pitch: 0 } }, smp.now, profile)) {
          hpEvents.push({ now: smp.now, e });
        }
      } else {
        for (const e of stepPress(pm, smp.signal, smp.now, profile, profile.switchAcceptanceTime)) pmEvents.push({ now: smp.now, e });
      }
    }
    return { hp, hpEvents, pmEvents };
  }

  it('camera frames lagging 20–80 ms behind the switch clock are never dropped; injected bad timestamps are ignored per source', () => {
    fc.assert(
      fc.property(
        profileArb,
        fc.array(
          fc.record({
            yaw: fc.double({ min: -20, max: 20, noNaN: true }),
            pitch: fc.double({ min: -20, max: 20, noNaN: true }),
            present: fc.boolean(),
            delay: fc.integer({ min: 20, max: 80 }),
          }),
          { minLength: 1, maxLength: 80 },
        ),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 200 }),
        fc.array(fc.record({ at: fc.nat(), back: fc.integer({ min: 0, max: 100 }), camera: fc.boolean() }), { maxLength: 20 }),
        (profile, frames, switchSignals, bad) => {
          // Camera frames every 33 ms of capture time; each arrives `delay` ms later on the
          // switch clock, carrying its capture timestamp. Capture times stay increasing.
          const camera: Array<Sample & { source: 'camera'; arrival: number }> = frames.map((f, i) => ({
            source: 'camera',
            now: 1000 + i * 33,
            arrival: 1000 + i * 33 + f.delay,
            face: f.present ? { bbox: BOX, rotation: { yaw: f.yaw, pitch: f.pitch } } : null,
          }));
          const keyboard: Array<Sample & { source: 'keyboard' }> = switchSignals.map((sig, i) => ({
            source: 'keyboard',
            now: 1000 + i * 16,
            signal: sig,
          }));
          // Interleave by arrival time: a camera frame's timestamp is often older than the
          // most recent keyboard sample's.
          const merged: Sample[] = [];
          let i = 0;
          let k = 0;
          while (i < camera.length || k < keyboard.length) {
            if (k >= keyboard.length || (i < camera.length && camera[i].arrival <= keyboard[k].now)) {
              merged.push({ source: 'camera', now: camera[i].now, face: camera[i].face });
              i++;
            } else {
              merged.push(keyboard[k++]);
            }
          }

          // Inject duplicate and backwards timestamps independently into each source.
          const withBad: Sample[] = [...merged];
          for (const b of bad) {
            const pos = b.at % (withBad.length + 1);
            const prevSame = [...withBad.slice(0, pos)].reverse().find((x) => x.source === (b.camera ? 'camera' : 'keyboard'));
            if (!prevSame) continue;
            const badNow = prevSame.now - b.back; // equal (duplicate) or earlier (backwards)
            withBad.splice(
              pos,
              0,
              b.camera
                ? { source: 'camera', now: badNow, face: { bbox: BOX, rotation: { yaw: 89, pitch: -89 } } }
                : { source: 'keyboard', now: badNow, signal: true },
            );
          }

          const clean = route(merged, profile);
          const dirty = route(withBad, profile);
          const cameraOnly = route(merged.filter((x) => x.source === 'camera'), profile);
          const keyboardOnly = route(merged.filter((x) => x.source === 'keyboard'), profile);

          // Every valid camera frame was processed: the interleaved run matches the camera-only run.
          expect(clean.hpEvents).toEqual(cameraOnly.hpEvents);
          expect(clean.hp.t_last).toBe(camera[camera.length - 1].now);
          expect(clean.pmEvents).toEqual(keyboardOnly.pmEvents);
          // Bad timestamps change nothing on either source.
          expect(dirty.hpEvents).toEqual(clean.hpEvents);
          expect(dirty.pmEvents).toEqual(clean.pmEvents);
        },
      ),
      { numRuns: 300 },
    );
  });
});
