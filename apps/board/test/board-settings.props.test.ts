import { createPlanchette } from "@planchette/skeleton";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BOARD_SETTINGS,
  exportBoardSettings,
  importBoardSettings,
  type BoardExport,
  type BoardSettingsValues,
} from "../src/board-settings";

const mk = () => createPlanchette({ screen: { width: 1000, height: 800 } });

// ---- generators -----------------------------------------------------------

/** In-range values for the skeleton profile (ranges from the Profile fields table). */
const validProfilePatch = fc.record({
  mode: fc.constantFrom("head + dwell", "head + gesture", "scan", "gesture scan", "mouse"),
  startCameraOnLoad: fc.boolean(),
  switchGesture: fc.constantFrom("jaw open", "brow raise"),
  switchBinding: fc.constantFrom(" ", "Enter", "MouseLeft", "GamepadButton0"),
  headGain: fc.integer({ min: 10, max: 20 }).map((n) => n / 10),
  smoothingStrength: fc.integer({ min: 0, max: 10 }).map((n) => n / 10),
  dwellTime: fc.integer({ min: 400, max: 3000 }),
  graceTime: fc.integer({ min: 0, max: 500 }),
  postSelectionPause: fc.integer({ min: 200, max: 3000 }),
  autoRepeatInterval: fc.integer({ min: 500, max: 3000 }),
  scanInterval: fc.integer({ min: 500, max: 5000 }),
  scanLoopsBeforePause: fc.integer({ min: 1, max: 10 }),
  cancelByHold: fc.boolean(),
  cancelHoldTime: fc.integer({ min: 2100, max: 5000 }),
  switchAcceptanceTime: fc.integer({ min: 0, max: 2000 }),
  gestureAcceptanceTime: fc.integer({ min: 100, max: 2000 }),
  gestureThreshold: fc.integer({ min: 50, max: 95 }).map((n) => n / 100),
  gestureReleaseThreshold: fc.integer({ min: 5, max: 40 }).map((n) => n / 100),
  noFaceTimeout: fc.integer({ min: 3000, max: 60000 }),
  inputTimeout: fc.integer({ min: 500, max: 10000 }),
  calibrationRangeLeft: fc.integer({ min: 10, max: 90 }),
  calibrationRangeRight: fc.integer({ min: 10, max: 90 }),
  calibrationRangeUp: fc.integer({ min: 10, max: 90 }),
  calibrationRangeDown: fc.integer({ min: 10, max: 90 }),
  headDeadZone: fc.integer({ min: 0, max: 5 }),
  calibrationStillnessThreshold: fc.integer({ min: 5, max: 60 }).map((n) => n / 10),
  calibrationStillnessTime: fc.integer({ min: 500, max: 4000 }),
  calibrationStepTimeout: fc.integer({ min: 3000, max: 20000 }),
  targetSize: fc.integer({ min: 64, max: 400 }),
  targetSpacing: fc.integer({ min: 8, max: 64 }),
});

const validBoard: fc.Arbitrary<BoardSettingsValues> = fc.record({
  predictionSlotCount: fc.integer({ min: 2, max: 8 }),
  voiceURI: fc.string({ maxLength: 30 }),
  speechRate: fc.double({ min: 0.5, max: 2.0, noNaN: true }),
  filterOffensiveWords: fc.boolean(),
});

const notNumber = fc.oneof(
  fc.string(), fc.boolean(), fc.constant(null), fc.array(fc.integer(), { maxLength: 2 }),
  fc.constant({}),
);
const notBoolean = fc.oneof(fc.string(), fc.integer(), fc.constant(null), fc.constant({}), fc.constant([]));
const notString = fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.constant({}), fc.constant([]));
const MISSING = Symbol("missing");

type Field = "predictionSlotCount" | "speechRate" | "filterOffensiveWords" | "voiceURI";

/** Per field: either keep the valid value, replace it with a bad one, or drop it. */
function maybeBad<T>(valid: T, bad: fc.Arbitrary<unknown>): fc.Arbitrary<{ value: unknown; isBad: boolean }> {
  return fc.oneof(
    { weight: 2, arbitrary: fc.constant({ value: valid as unknown, isBad: false }) },
    { weight: 2, arbitrary: bad.map((value) => ({ value, isBad: true })) },
    { weight: 1, arbitrary: fc.constant({ value: MISSING as unknown, isBad: true }) },
  );
}

const outOfRangeSlot = fc.oneof(
  fc.integer({ min: -1000, max: 1 }),
  fc.integer({ min: 9, max: 1000 }),
  fc.double({ min: -1e6, max: 1e6, noNaN: true }).filter((n) => n < 1.5 || n > 8.5),
);
const outOfRangeRate = fc.oneof(
  fc.double({ min: -1e6, max: 0.4999, noNaN: true }),
  fc.double({ min: 2.0001, max: 1e6, noNaN: true }),
);

const malformedBoard = fc
  .tuple(
    validBoard,
    fc.oneof(maybeBad(0, fc.oneof(outOfRangeSlot, notNumber)), fc.constant(null)),
    fc.oneof(maybeBad(0, fc.oneof(outOfRangeRate, notNumber)), fc.constant(null)),
    fc.oneof(maybeBad(0, notBoolean), fc.constant(null)),
    fc.oneof(maybeBad(0, notString), fc.constant(null)),
  )
  .map(([valid, s, r, f, v]) => {
    const pick = (key: Field, m: { value: unknown; isBad: boolean } | null) =>
      m === null || !m.isBad ? { value: valid[key] as unknown, isBad: false } : m;
    return {
      predictionSlotCount: pick("predictionSlotCount", s),
      speechRate: pick("speechRate", r),
      filterOffensiveWords: pick("filterOffensiveWords", f),
      voiceURI: pick("voiceURI", v),
    };
  });

// ---- properties -----------------------------------------------------------

describe("Property 7: Settings export/import round trip and clamping", () => {
  // **Property 7: Settings export/import round trip and clamping**
  // **Validates: Requirements 6.5, 6.6, 6.7, 11.1, 11.2, 11.3**

  it("a valid export round-trips equal and reports no changes", () => {
    fc.assert(
      fc.property(validProfilePatch, validBoard, (patch, board) => {
        const src = mk();
        src.setProfile(patch);
        const json = exportBoardSettings(src, board);
        const r = importBoardSettings(mk(), json);
        expect(r.changes).toEqual([]);
        expect(r.value).toEqual(JSON.parse(json) as BoardExport);
        expect(r.value.board).toEqual(board);
      }),
    );
  });

  it("malformed board fields are clamped or defaulted, reported, and in-range fields are untouched", () => {
    fc.assert(
      fc.property(validProfilePatch, malformedBoard, (patch, fields) => {
        const src = mk();
        src.setProfile(patch);
        const board: Record<string, unknown> = {};
        for (const [k, f] of Object.entries(fields)) if (f.value !== MISSING) board[k] = f.value;
        const json = JSON.stringify({ version: 1, profile: JSON.parse(src.exportProfile()), board });

        const r = importBoardSettings(mk(), json);
        const out = r.value.board;
        const reported = (k: string) => r.changes.some((c) => c.startsWith(`${k}:`));
        const sent = JSON.parse(JSON.stringify(board)) as Record<string, unknown>; // as it arrives after JSON

        // slot count
        const sc = sent.predictionSlotCount;
        if (typeof sc === "number") {
          expect(out.predictionSlotCount).toBe(Math.min(8, Math.max(2, Math.round(sc))));
        } else {
          expect(out.predictionSlotCount).toBe(DEFAULT_BOARD_SETTINGS.predictionSlotCount);
        }
        expect(reported("predictionSlotCount")).toBe(fields.predictionSlotCount.isBad);

        // speech rate
        const sr = sent.speechRate;
        if (typeof sr === "number") {
          expect(out.speechRate).toBe(Math.min(2, Math.max(0.5, sr)));
        } else {
          expect(out.speechRate).toBe(DEFAULT_BOARD_SETTINGS.speechRate);
        }
        expect(reported("speechRate")).toBe(fields.speechRate.isBad);

        // filter: anything but a boolean imports as true
        expect(out.filterOffensiveWords).toBe(
          typeof sent.filterOffensiveWords === "boolean" ? sent.filterOffensiveWords : true,
        );
        expect(reported("filterOffensiveWords")).toBe(fields.filterOffensiveWords.isBad);

        // voice
        expect(out.voiceURI).toBe(typeof sent.voiceURI === "string" ? sent.voiceURI : "");
        expect(reported("voiceURI")).toBe(fields.voiceURI.isBad);

        // results are always within bounds
        expect(out.predictionSlotCount).toBeGreaterThanOrEqual(2);
        expect(out.predictionSlotCount).toBeLessThanOrEqual(8);
        expect(out.speechRate).toBeGreaterThanOrEqual(0.5);
        expect(out.speechRate).toBeLessThanOrEqual(2);
        // only board fields were malformed, so nothing else is reported
        expect(r.changes.every((c) => /^(predictionSlotCount|speechRate|filterOffensiveWords|voiceURI):/.test(c))).toBe(true);
      }),
    );
  });
});

describe("Property 7 (startCameraOnLoad): profile.startCameraOnLoad round trip and defaulting", () => {
  // **Property 7: Settings export/import round trip and clamping**
  // **Validates: Requirements 6.9, 6.6, 11.8**

  it("a boolean startCameraOnLoad survives export then import with no changes reported", () => {
    fc.assert(
      fc.property(validProfilePatch, validBoard, (patch, board) => {
        const src = mk();
        src.setProfile(patch);
        const r = importBoardSettings(mk(), exportBoardSettings(src, board));
        expect(r.changes).toEqual([]);
        expect(r.value.profile.startCameraOnLoad).toBe(patch.startCameraOnLoad);
      }),
    );
  });

  const badStart = fc.oneof(
    fc.constant(MISSING as unknown),
    fc.string(), fc.integer(), fc.constant(null), fc.constant({}), fc.array(fc.boolean(), { maxLength: 2 }),
  );

  it("a missing or non-boolean startCameraOnLoad imports as false, is reported, and other fields are untouched", () => {
    fc.assert(
      fc.property(validProfilePatch, validBoard, badStart, (patch, board, bad) => {
        const src = mk();
        src.setProfile({ ...patch, startCameraOnLoad: true });
        const profile = JSON.parse(src.exportProfile()) as Record<string, unknown>;
        if (bad === MISSING) delete profile.startCameraOnLoad;
        else profile.startCameraOnLoad = bad;
        const json = JSON.stringify({ version: 1, profile, board });

        const target = mk();
        target.setProfile({ startCameraOnLoad: true }); // a stale true must not leak through
        const r = importBoardSettings(target, json);

        expect(r.value.profile.startCameraOnLoad).toBe(false);
        expect(r.changes.some((c) => c.includes("startCameraOnLoad"))).toBe(true);
        const { startCameraOnLoad: _a, ...expected } = JSON.parse(src.exportProfile()) as Record<string, unknown>;
        const { startCameraOnLoad: _b, ...actual } = r.value.profile as Record<string, unknown>;
        expect(actual).toEqual(expected);
        expect(r.value.board).toEqual(board);
        expect(r.changes.every((c) => c.includes("startCameraOnLoad"))).toBe(true);
      }),
    );
  });
});
