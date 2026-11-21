import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';
import { pointToRotation, rotationToPoint } from '../src/index.js';
import { defaultProfile } from '../src/engine/profile.js';
import { mapCentredAngles } from '../src/engine/pointer-mapping.js';

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
}

const profile = { ...defaultProfile };
const screen = { width: 1000, height: 800 };
const centre = { yaw: 2, pitch: -1 };

describe('pointer helpers', () => {
  it('maps fixed examples (default profile, 15° range, gain 1)', () => {
    const D = profile.headDeadZone;
    const G = profile.headGain;
    const R = profile.calibrationRangeRight - D;
    // Full right edge: dz = R / G past the dead zone.
    const right = rotationToPoint(profile, screen, centre, { yaw: centre.yaw + D + R / G, pitch: centre.pitch });
    expect(right).toEqual({ x: 999, y: Math.round(399.5) });
    // Beyond the edge clamps.
    const far = rotationToPoint(profile, screen, centre, { yaw: 500, pitch: 500 });
    expect(far).toEqual({ x: 999, y: 0 });
    // Corner round trip.
    const rot = pointToRotation(profile, screen, centre, { x: 999, y: 0 });
    expect(rot.yaw).toBeGreaterThan(centre.yaw);
    expect(rot.pitch).toBeGreaterThan(centre.pitch);
    expect(rotationToPoint(profile, screen, centre, rot)).toEqual({ x: 999, y: 0 });
    const mid = pointToRotation(profile, screen, centre, { x: 100, y: 700 });
    expect(rotationToPoint(profile, screen, centre, mid)).toEqual({ x: 100, y: 700 });
  });

  it('agrees with the engine mapping', () => {
    const r = { yaw: 7.3, pitch: 4.1 };
    expect(rotationToPoint(profile, screen, centre, r)).toEqual(
      mapCentredAngles(r.yaw - centre.yaw, r.pitch - centre.pitch, profile, screen),
    );
  });

  it('does not mutate its arguments', () => {
    const p = deepFreeze({ ...profile });
    const s = deepFreeze({ ...screen });
    const c = deepFreeze({ ...centre });
    const pt = deepFreeze({ x: 123, y: 456 });
    const rot = deepFreeze({ yaw: 5, pitch: 3 });
    expect(() => pointToRotation(p, s, c, pt)).not.toThrow();
    expect(() => rotationToPoint(p, s, c, rot)).not.toThrow();
  });

  it('is deterministic', () => {
    const pt = { x: 321, y: 123 };
    expect(pointToRotation(profile, screen, centre, pt)).toEqual(pointToRotation(profile, screen, centre, pt));
    const rot = { yaw: 6, pitch: -4 };
    expect(rotationToPoint(profile, screen, centre, rot)).toEqual(rotationToPoint(profile, screen, centre, rot));
  });

  it('puts a rotation inside the dead zone at the centre pixel', () => {
    const d = profile.headDeadZone / 2;
    const p = rotationToPoint(profile, screen, centre, { yaw: centre.yaw + d, pitch: centre.pitch - d });
    expect(p).toEqual(rotationToPoint(profile, screen, centre, centre));
    expect(p).toEqual({ x: Math.round(499.5), y: Math.round(399.5) });
  });

  it('exports exactly the two helpers besides createPlanchette at runtime', () => {
    expect(Object.keys(api).sort()).toEqual(['createPlanchette', 'pointToRotation', 'rotationToPoint']);
    expect(typeof api.pointToRotation).toBe('function');
    expect(typeof api.rotationToPoint).toBe('function');
  });
});
