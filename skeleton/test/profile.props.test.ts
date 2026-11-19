/**
 * P17 — Profile round-trip and clamping
 *
 * (a) importProfile(exportProfile(p)) equals p for any valid profile.
 * (b) Every field of any import result is in range.
 * (c) The result has exactly the 30 known fields — no __proto__, no unknown keys —
 *     for arbitrary JSON input including injected __proto__ and out-of-order fields.
 *
 * Additional property: clampProfile with any partial value (NaN, Infinity, undefined,
 * wrong type) always returns a profile whose every field is in range and of the
 * correct type.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  defaultProfile,
  exportProfile,
  importProfile,
  clampProfile,
  type Profile,
  type Mode,
  type SwitchGesture,
} from '../src/engine/profile';

// ---------------------------------------------------------------------------
// Arbitrary generators
// ---------------------------------------------------------------------------

const modeArb = fc.constantFrom<Mode>(
  'head + dwell',
  'head + gesture',
  'scan',
  'gesture scan',
  'mouse',
);

const gestureArb = fc.constantFrom<SwitchGesture>('jaw open', 'brow raise');

// fast-check fc.float requires 32-bit float bounds — use Math.fround
const f = Math.fround;

/** Generate a fully valid Profile by building a partial and clamping it. */
const validProfileArb: fc.Arbitrary<Profile> = fc
  .record({
    mode: modeArb,
    startCameraOnLoad: fc.boolean(),
    switchGesture: gestureArb,
    switchBinding: fc.oneof(fc.constant(' '), fc.constant('Enter'), fc.constant('MouseLeft')),
    headGain: fc.float({ min: f(1.0), max: f(2.0), noNaN: true }),
    // headDeadZone will be clamped after calibration ranges
    headDeadZone: fc.float({ min: f(0), max: f(10), noNaN: true }),
    smoothingStrength: fc.float({ min: f(0), max: f(1), noNaN: true }),
    dwellTime: fc.integer({ min: 400, max: 3000 }),
    graceTime: fc.integer({ min: 0, max: 500 }),
    postSelectionPause: fc.integer({ min: 200, max: 3000 }),
    autoRepeatInterval: fc.integer({ min: 500, max: 3000 }),
    scanInterval: fc.integer({ min: 500, max: 5000 }),
    scanLoopsBeforePause: fc.integer({ min: 1, max: 10 }),
    switchAcceptanceTime: fc.integer({ min: 0, max: 2000 }),
    gestureAcceptanceTime: fc.integer({ min: 100, max: 2000 }),
    gestureThreshold: fc.float({ min: f(0.1), max: f(0.95), noNaN: true }),
    gestureReleaseThreshold: fc.float({ min: f(0.05), max: f(0.9), noNaN: true }),
    cancelByHold: fc.boolean(),
    cancelHoldTime: fc.integer({ min: 1000, max: 5000 }),
    noFaceTimeout: fc.integer({ min: 3000, max: 60000 }),
    inputTimeout: fc.integer({ min: 500, max: 10000 }),
    calibrationRangeLeft: fc.float({ min: f(3), max: f(90), noNaN: true }),
    calibrationRangeRight: fc.float({ min: f(3), max: f(90), noNaN: true }),
    calibrationRangeUp: fc.float({ min: f(3), max: f(90), noNaN: true }),
    calibrationRangeDown: fc.float({ min: f(3), max: f(90), noNaN: true }),
    calibrationStillnessThreshold: fc.float({ min: f(0.5), max: f(6), noNaN: true }),
    calibrationStillnessTime: fc.integer({ min: 500, max: 4000 }),
    calibrationStepTimeout: fc.integer({ min: 3000, max: 20000 }),
    targetSize: fc.integer({ min: 64, max: 400 }),
    targetSpacing: fc.integer({ min: 8, max: 64 }),
  })
  .map((raw) => clampProfile(raw));

// An arbitrary that generates wild partial Profile values: any mix of correct types,
// NaN, Infinity, wrong types (string where number expected, etc.), and undefined
// (key absent). Used to verify clampProfile is defensive regardless of input.
const wildPartialArb: fc.Arbitrary<Partial<Profile>> = fc
  .record(
    {
      mode: fc.oneof(modeArb, fc.string(), fc.constant(undefined)),
      startCameraOnLoad: fc.oneof(fc.boolean(), fc.integer(), fc.constant(undefined)),
      switchGesture: fc.oneof(gestureArb, fc.string(), fc.constant(undefined)),
      switchBinding: fc.oneof(fc.string(), fc.integer(), fc.constant(undefined)),
      headGain: fc.oneof(
        fc.float({ noNaN: true }),
        fc.constant(NaN),
        fc.constant(Infinity),
        fc.constant(-Infinity),
        fc.string(),
        fc.constant(undefined),
      ),
      headDeadZone: fc.oneof(
        fc.float({ noNaN: true }),
        fc.constant(NaN),
        fc.constant(Infinity),
        fc.constant(undefined),
      ),
      smoothingStrength: fc.oneof(fc.float({ noNaN: true }), fc.constant(NaN), fc.constant(undefined)),
      dwellTime: fc.oneof(fc.integer(), fc.constant(NaN), fc.constant(Infinity), fc.constant(undefined)),
      graceTime: fc.oneof(fc.integer(), fc.constant(NaN), fc.constant(undefined)),
      postSelectionPause: fc.oneof(fc.integer(), fc.constant(NaN), fc.constant(undefined)),
      autoRepeatInterval: fc.oneof(fc.integer(), fc.constant(NaN), fc.constant(undefined)),
      scanInterval: fc.oneof(fc.integer(), fc.constant(NaN), fc.constant(undefined)),
      scanLoopsBeforePause: fc.oneof(
        fc.float({ noNaN: true }), // includes non-integers to test rounding
        fc.constant(NaN),
        fc.constant(Infinity),
        fc.constant(undefined),
      ),
      switchAcceptanceTime: fc.oneof(fc.integer(), fc.constant(NaN), fc.constant(undefined)),
      gestureAcceptanceTime: fc.oneof(fc.integer(), fc.constant(NaN), fc.constant(undefined)),
      gestureThreshold: fc.oneof(fc.float({ noNaN: true }), fc.constant(NaN), fc.constant(undefined)),
      gestureReleaseThreshold: fc.oneof(fc.float({ noNaN: true }), fc.constant(NaN), fc.constant(undefined)),
      cancelByHold: fc.oneof(fc.boolean(), fc.integer(), fc.constant(undefined)),
      cancelHoldTime: fc.oneof(fc.integer(), fc.constant(NaN), fc.constant(undefined)),
      noFaceTimeout: fc.oneof(fc.integer(), fc.constant(NaN), fc.constant(undefined)),
      inputTimeout: fc.oneof(fc.integer(), fc.constant(NaN), fc.constant(undefined)),
      calibrationRangeLeft: fc.oneof(fc.float({ noNaN: true }), fc.constant(NaN), fc.constant(Infinity), fc.constant(undefined)),
      calibrationRangeRight: fc.oneof(fc.float({ noNaN: true }), fc.constant(NaN), fc.constant(undefined)),
      calibrationRangeUp: fc.oneof(fc.float({ noNaN: true }), fc.constant(NaN), fc.constant(undefined)),
      calibrationRangeDown: fc.oneof(fc.float({ noNaN: true }), fc.constant(NaN), fc.constant(undefined)),
      calibrationStillnessThreshold: fc.oneof(fc.float({ noNaN: true }), fc.constant(NaN), fc.constant(undefined)),
      calibrationStillnessTime: fc.oneof(fc.integer(), fc.constant(NaN), fc.constant(undefined)),
      calibrationStepTimeout: fc.oneof(fc.integer(), fc.constant(NaN), fc.constant(undefined)),
      targetSize: fc.oneof(fc.integer(), fc.constant(NaN), fc.constant(undefined)),
      targetSpacing: fc.oneof(fc.integer(), fc.constant(NaN), fc.constant(undefined)),
    },
    { requiredKeys: [] }, // all keys optional so undefined values are possible
  )
  .map((rec) => {
    // Drop keys whose value is undefined so they are genuinely absent from the partial.
    const out: Partial<Profile> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (v !== undefined) {
        (out as Record<string, unknown>)[k] = v;
      }
    }
    return out;
  });

// ---------------------------------------------------------------------------
// clampProfile defensive property
// ---------------------------------------------------------------------------

describe('clampProfile defensive: any partial input → valid result', () => {
  it('every field is in range and of the correct type for any partial value', () => {
    fc.assert(
      fc.property(wildPartialArb, (partial) => {
        const p = clampProfile(partial);
        checkAllFieldsInRange(p);
        return true;
      }),
      { numRuns: 1000 },
    );
  });
});

// ---------------------------------------------------------------------------
// P17(a) — round-trip
// ---------------------------------------------------------------------------

describe('P17(a) round-trip', () => {
  it('importProfile(exportProfile(p)) equals p for any valid profile', () => {
    fc.assert(
      fc.property(validProfileArb, (p) => {
        const { profile: p2 } = importProfile(exportProfile(p));
        for (const key of Object.keys(p) as (keyof Profile)[]) {
          if (p[key] !== p2[key]) {
            throw new Error(
              `Key "${key}" changed: ${JSON.stringify(p[key])} → ${JSON.stringify(p2[key])}`,
            );
          }
        }
        return true;
      }),
      { numRuns: 500 },
    );
  });
});

// ---------------------------------------------------------------------------
// P17(b) — every field is in range after import
// ---------------------------------------------------------------------------

describe('P17(b) every imported field is in range', () => {
  it('holds for any arbitrary JSON string', () => {
    const jsonArb = fc.oneof(
      fc
        .dictionary(
          fc.oneof(fc.string(), fc.constant('__proto__'), fc.constant('mode')),
          fc.jsonValue(),
          { maxKeys: 50 },
        )
        .map((o) => JSON.stringify(o)),
      fc.constant('{}'),
      fc.constant('"not an object"'),
      fc.constant('null'),
      fc.constant('[1,2,3]'),
      fc.constant('not json at all'),
    );

    fc.assert(
      fc.property(jsonArb, (json) => {
        const { profile } = importProfile(json);
        checkAllFieldsInRange(profile);
        return true;
      }),
      { numRuns: 1000 },
    );
  });
});

function checkAllFieldsInRange(p: Profile): void {
  expect(typeof p.mode).toBe('string');
  expect(['head + dwell', 'head + gesture', 'scan', 'gesture scan', 'mouse']).toContain(p.mode);
  expect(typeof p.startCameraOnLoad).toBe('boolean');
  expect(['jaw open', 'brow raise']).toContain(p.switchGesture);
  expect(typeof p.switchBinding).toBe('string');
  expect(p.headGain).toBeGreaterThanOrEqual(1.0);
  expect(p.headGain).toBeLessThanOrEqual(2.0);
  expect(isFinite(p.headGain)).toBe(true);

  const minRange = Math.min(
    p.calibrationRangeLeft,
    p.calibrationRangeRight,
    p.calibrationRangeUp,
    p.calibrationRangeDown,
  );
  expect(p.headDeadZone).toBeGreaterThanOrEqual(0);
  expect(p.headDeadZone).toBeLessThanOrEqual(0.5 * minRange + 1e-9); // float tolerance
  expect(isFinite(p.headDeadZone)).toBe(true);

  expect(p.smoothingStrength).toBeGreaterThanOrEqual(0);
  expect(p.smoothingStrength).toBeLessThanOrEqual(1);
  expect(p.dwellTime).toBeGreaterThanOrEqual(400);
  expect(p.dwellTime).toBeLessThanOrEqual(3000);
  expect(p.graceTime).toBeGreaterThanOrEqual(0);
  expect(p.graceTime).toBeLessThanOrEqual(500);
  expect(p.postSelectionPause).toBeGreaterThanOrEqual(200);
  expect(p.postSelectionPause).toBeLessThanOrEqual(3000);
  expect(p.autoRepeatInterval).toBeGreaterThanOrEqual(500);
  expect(p.autoRepeatInterval).toBeLessThanOrEqual(3000);
  expect(p.scanInterval).toBeGreaterThanOrEqual(500);
  expect(p.scanInterval).toBeLessThanOrEqual(5000);
  expect(p.scanLoopsBeforePause).toBeGreaterThanOrEqual(1);
  expect(p.scanLoopsBeforePause).toBeLessThanOrEqual(10);
  expect(Number.isInteger(p.scanLoopsBeforePause)).toBe(true);
  expect(p.switchAcceptanceTime).toBeGreaterThanOrEqual(0);
  expect(p.switchAcceptanceTime).toBeLessThan(p.cancelHoldTime);
  expect(p.gestureAcceptanceTime).toBeGreaterThanOrEqual(100);
  expect(p.gestureAcceptanceTime).toBeLessThan(p.cancelHoldTime);
  expect(p.gestureThreshold).toBeGreaterThanOrEqual(0.1);
  expect(p.gestureThreshold).toBeLessThanOrEqual(0.95);
  expect(p.gestureReleaseThreshold).toBeGreaterThanOrEqual(0.05);
  expect(p.gestureReleaseThreshold).toBeLessThanOrEqual(p.gestureThreshold - 0.05 + 1e-9);
  expect(typeof p.cancelByHold).toBe('boolean');
  expect(p.cancelHoldTime).toBeGreaterThanOrEqual(1000);
  expect(p.cancelHoldTime).toBeLessThanOrEqual(5000);
  expect(p.noFaceTimeout).toBeGreaterThanOrEqual(3000);
  expect(p.noFaceTimeout).toBeLessThanOrEqual(60000);
  expect(p.inputTimeout).toBeGreaterThanOrEqual(500);
  expect(p.inputTimeout).toBeLessThanOrEqual(10000);
  for (const key of ['calibrationRangeLeft', 'calibrationRangeRight', 'calibrationRangeUp', 'calibrationRangeDown'] as const) {
    expect(p[key]).toBeGreaterThanOrEqual(3);
    expect(p[key]).toBeLessThanOrEqual(90);
    expect(isFinite(p[key])).toBe(true);
  }
  expect(p.calibrationStillnessThreshold).toBeGreaterThanOrEqual(0.5);
  expect(p.calibrationStillnessThreshold).toBeLessThanOrEqual(6);
  expect(p.calibrationStillnessTime).toBeGreaterThanOrEqual(500);
  expect(p.calibrationStillnessTime).toBeLessThanOrEqual(4000);
  expect(p.calibrationStepTimeout).toBeGreaterThanOrEqual(3000);
  expect(p.calibrationStepTimeout).toBeLessThanOrEqual(20000);
  expect(p.targetSize).toBeGreaterThanOrEqual(64);
  expect(p.targetSize).toBeLessThanOrEqual(400);
  expect(p.targetSpacing).toBeGreaterThanOrEqual(8);
  expect(p.targetSpacing).toBeLessThanOrEqual(64);
}

// ---------------------------------------------------------------------------
// P17(c) — no __proto__, no unknown keys
// ---------------------------------------------------------------------------

describe('P17(c) only the 30 known fields — no extra keys', () => {
  const knownKeys = new Set(Object.keys(defaultProfile));

  it('holds for valid profiles', () => {
    fc.assert(
      fc.property(validProfileArb, (p) => {
        const { profile } = importProfile(exportProfile(p));
        const keys = Object.keys(profile);
        expect(keys).toHaveLength(30);
        for (const k of keys) {
          expect(knownKeys.has(k)).toBe(true);
        }
        return true;
      }),
      { numRuns: 300 },
    );
  });

  it('ignores __proto__ injection', () => {
    const malicious = [
      // Raw strings with a literal "__proto__" key — the object-literal form
      // `{ __proto__: ... }` sets the prototype rather than adding a key, so
      // JSON.stringify would not include it. These strings must be written as
      // literals to actually contain the key in the JSON.
      '{"__proto__":{"injected":true},"headGain":1.5}',
      '{"constructor":{"prototype":{"injected":true}}}',
      // A profile with an extra unknown key alongside a known one
      '{"headGain":1.5,"__proto__":{"evil":true},"extraKey":42}',
    ];
    for (const json of malicious) {
      const { profile } = importProfile(json);
      const keys = Object.keys(profile);
      expect(keys).toHaveLength(30);
      expect(keys.includes('__proto__')).toBe(false);
      expect(keys.includes('extraKey')).toBe(false);
      expect((profile as Record<string, unknown>)['injected']).toBeUndefined();
      expect((profile as Record<string, unknown>)['evil']).toBeUndefined();
    }
  });

  it('holds for arbitrary JSON input', () => {
    const jsonArb = fc.oneof(
      fc
        .dictionary(
          fc.oneof(fc.string(), fc.constant('__proto__')),
          fc.jsonValue(),
          { maxKeys: 50 },
        )
        .map((o) => JSON.stringify(o)),
      fc.constant('{}'),
      fc.constant('null'),
      fc.constant('"string"'),
    );

    fc.assert(
      fc.property(jsonArb, (json) => {
        const { profile } = importProfile(json);
        const keys = Object.keys(profile);
        expect(keys).toHaveLength(30);
        for (const k of keys) {
          expect(knownKeys.has(k)).toBe(true);
        }
        return true;
      }),
      { numRuns: 500 },
    );
  });
});
