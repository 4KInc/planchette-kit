import { describe, it, expect } from 'vitest';
import {
  defaultProfile,
  clampProfile,
  exportProfile,
  importProfile,
  type Profile,
} from '../src/engine/profile';

// ---------------------------------------------------------------------------
// 2.6 Example tests
// ---------------------------------------------------------------------------

describe('defaultProfile', () => {
  it('has exactly 30 fields', () => {
    const keys = Object.keys(defaultProfile);
    expect(keys.length).toBe(30);
  });

  it('round-trips through export → import unchanged', () => {
    const result = importProfile(exportProfile(defaultProfile));
    expect(result.profile).toEqual(defaultProfile);
  });
});

describe('clampProfile', () => {
  it('clamps headGain to [1.0, 2.0]', () => {
    expect(clampProfile({ headGain: 0.5 }).headGain).toBe(1.0);
    expect(clampProfile({ headGain: 5.0 }).headGain).toBe(2.0);
    expect(clampProfile({ headGain: 1.5 }).headGain).toBe(1.5);
  });

  it('enforces clamping order: dead zone ≤ 0.5 × min calibration range', () => {
    // Set all ranges to 10 deg → max dead zone = 5 deg
    const p = clampProfile({
      calibrationRangeLeft: 10,
      calibrationRangeRight: 10,
      calibrationRangeUp: 10,
      calibrationRangeDown: 10,
      headDeadZone: 999, // way out of range
    });
    expect(p.headDeadZone).toBe(5);
  });

  it('clamps gesture release threshold below gesture threshold', () => {
    // gestureThreshold = 0.4, so releaseThreshold max = 0.35
    const p = clampProfile({
      gestureThreshold: 0.4,
      gestureReleaseThreshold: 0.9,
    });
    expect(p.gestureThreshold).toBe(0.4);
    expect(p.gestureReleaseThreshold).toBeLessThanOrEqual(p.gestureThreshold - 0.05);
  });

  it('clamps acceptance times below cancelHoldTime', () => {
    const p = clampProfile({
      cancelHoldTime: 1500,
      switchAcceptanceTime: 2000,
      gestureAcceptanceTime: 2000,
    });
    expect(p.switchAcceptanceTime).toBeLessThan(p.cancelHoldTime);
    expect(p.gestureAcceptanceTime).toBeLessThan(p.cancelHoldTime);
  });

  it('fills missing fields from defaultProfile', () => {
    const p = clampProfile({});
    expect(p).toEqual(defaultProfile);
  });
});

describe('importProfile', () => {
  it('ignores __proto__ key', () => {
    const json = '{"__proto__": {"evil": true}, "headGain": 1.2}';
    const { profile } = importProfile(json);
    // The profile should not have evil on its prototype
    expect((profile as Record<string, unknown>)['evil']).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(profile, '__proto__')).toBe(false);
    expect(profile.headGain).toBe(1.2);
  });

  it('uses default for missing field', () => {
    const json = '{}';
    const { profile } = importProfile(json);
    expect(profile).toEqual(defaultProfile);
  });

  it('reports clamping in changes array', () => {
    const json = JSON.stringify({ headGain: 99 });
    const { profile, changes } = importProfile(json);
    expect(profile.headGain).toBe(2.0);
    expect(changes.some((c) => c.startsWith('headGain:'))).toBe(true);
  });

  it('applies dependent clamping: release threshold after gesture threshold', () => {
    // gestureThreshold will clamp to 0.1 (minimum); release threshold max = 0.05
    const json = JSON.stringify({ gestureThreshold: 0.05, gestureReleaseThreshold: 0.9 });
    const { profile } = importProfile(json);
    expect(profile.gestureThreshold).toBe(0.1);
    expect(profile.gestureReleaseThreshold).toBeLessThanOrEqual(profile.gestureThreshold - 0.05);
  });

  it('returns invalid JSON with all defaults', () => {
    const { profile, changes } = importProfile('not json');
    expect(profile).toEqual(defaultProfile);
    expect(changes.length).toBeGreaterThan(0);
  });

  it('profile has exactly the 30 known fields — no extra keys', () => {
    const known = new Set(Object.keys(defaultProfile));
    const json = JSON.stringify({ unknownField: 42, anotherUnknown: 'x' });
    const { profile } = importProfile(json);
    const profileKeys = Object.keys(profile);
    expect(profileKeys.length).toBe(30);
    for (const k of profileKeys) {
      expect(known.has(k)).toBe(true);
    }
  });
});

describe('exportProfile', () => {
  it('produces valid JSON', () => {
    const json = exportProfile(defaultProfile);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('round-trip is identity for a custom profile', () => {
    const custom: Profile = {
      ...defaultProfile,
      headGain: 1.5,
      dwellTime: 800,
      mode: 'scan',
    };
    const { profile } = importProfile(exportProfile(custom));
    expect(profile).toEqual(custom);
  });
});
