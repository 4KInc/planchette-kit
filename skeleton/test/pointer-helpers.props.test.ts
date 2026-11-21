/**
 * Property tests for the public pointer helpers.
 * Feature: dwell-sim-mcp, Requirement 9 AC 3
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { pointToRotation, rotationToPoint } from '../src/pointer-helpers';
import { createHeadPointerState, stepHeadPointer } from '../src/engine/head-pointer';
import { screenSize } from '../src/engine/pointer-mapping';
import { validProfile, f } from './arbitraries';

const screenArb = fc.record({ width: fc.integer({ min: 1, max: 5000 }), height: fc.integer({ min: 1, max: 5000 }) });
const centreArb = fc.record({ yaw: f(-5, 5), pitch: f(-5, 5) });

describe('pointer helpers round trip', () => {
  it('Feature: dwell-sim-mcp, Requirement 9 AC 3: rotationToPoint(pointToRotation(p)) is within 1 px of p', () => {
    fc.assert(
      fc.property(
        validProfile(),
        screenArb,
        centreArb,
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (profile, screen, centre, tx, ty) => {
          // p in the reachable rectangle [0, W'-1] x [0, H'-1] (real-valued).
          const p = { x: tx * (screenSize(screen.width) - 1), y: ty * (screenSize(screen.height) - 1) };
          const q = rotationToPoint(profile, screen, centre, pointToRotation(profile, screen, centre, p));
          expect(Math.abs(q.x - p.x)).toBeLessThanOrEqual(1);
          expect(Math.abs(q.y - p.y)).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('pointer helpers agree with the engine', () => {
  it('Feature: dwell-sim-mcp, Requirement 9 AC 4: rotationToPoint equals the first pointer-move of stepHeadPointer', () => {
    fc.assert(
      fc.property(validProfile(), screenArb, centreArb, f(-90, 90), f(-90, 90), (profile, screen, centre, yaw, pitch) => {
        const events = stepHeadPointer(
          createHeadPointerState(),
          {
            faces: [{ bbox: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.4 }, rotation: { yaw, pitch } }],
            screen,
            centre,
          },
          1000,
          profile,
        );
        const move = events.find((e) => e.type === 'pointer-move');
        expect(move).toBeDefined();
        const p = rotationToPoint(profile, screen, centre, { yaw, pitch });
        expect(move).toEqual({ type: 'pointer-move', x: p.x, y: p.y });
      }),
      { numRuns: 500 },
    );
  });
});
