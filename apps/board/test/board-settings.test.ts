import { createPlanchette } from "@planchette/skeleton";
import { describe, expect, it } from "vitest";
import {
  exportBoardSettings,
  importBoardSettings,
  resolveInitialProfile,
  type BoardExport,
} from "../src/board-settings";
import { DEFAULT_SETTINGS, readSettings, writeSettings, type StorageLike } from "../src/board-storage";

const mk = () => createPlanchette({ screen: { width: 1000, height: 800 } });

function memory(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

function withBoard(board: unknown): string {
  const p = mk();
  return JSON.stringify({ version: 1, profile: JSON.parse(p.exportProfile()), board });
}

describe("board export/import", () => {
  it("an in-range export imports to an equal object with no changes", () => {
    const p = mk();
    p.setProfile({ dwellTime: 1700 });
    const board = { predictionSlotCount: 6, voiceURI: "v1", speechRate: 1.5, filterOffensiveWords: false };
    const json = exportBoardSettings(p, board);
    const r = importBoardSettings(mk(), json);
    expect(r.changes).toEqual([]);
    expect(r.value).toEqual(JSON.parse(json) as BoardExport);
    expect(r.value.profile.dwellTime).toBe(1700);
  });

  it("clamps an out-of-range predictionSlotCount and reports it", () => {
    for (const [given, want] of [[1, 2], [9, 8]] as const) {
      const r = importBoardSettings(mk(), withBoard({ predictionSlotCount: given, voiceURI: "", speechRate: 1, filterOffensiveWords: true }));
      expect(r.value.board.predictionSlotCount).toBe(want);
      expect(r.changes.some((c) => c.startsWith("predictionSlotCount"))).toBe(true);
    }
  });

  it("a missing speechRate falls back to 1.0 and is reported", () => {
    const r = importBoardSettings(mk(), withBoard({ predictionSlotCount: 4, voiceURI: "", filterOffensiveWords: true }));
    expect(r.value.board.speechRate).toBe(1.0);
    expect(r.changes.some((c) => c.startsWith("speechRate"))).toBe(true);
  });

  it("filterOffensiveWords defaults to true with no saved settings", () => {
    expect(readSettings(memory()).value.board.filterOffensiveWords).toBe(true);
  });

  it("filterOffensiveWords false survives export then import", () => {
    const p = mk();
    const json = exportBoardSettings(p, { ...DEFAULT_SETTINGS.board, filterOffensiveWords: false });
    expect(importBoardSettings(mk(), json).value.board.filterOffensiveWords).toBe(false);
  });

  it("a non-boolean filterOffensiveWords becomes true and is reported", () => {
    const r = importBoardSettings(mk(), withBoard({ predictionSlotCount: 4, voiceURI: "", speechRate: 1, filterOffensiveWords: "no" }));
    expect(r.value.board.filterOffensiveWords).toBe(true);
    expect(r.changes.some((c) => c.startsWith("filterOffensiveWords"))).toBe(true);
  });

  it("malformed JSON yields defaults and a report without throwing", () => {
    const r = importBoardSettings(mk(), "{nope");
    expect(r.value.board).toEqual(DEFAULT_SETTINGS.board);
    expect(r.changes.length).toBeGreaterThan(0);
  });
});

describe("resolveInitialProfile", () => {
  const saved = (dwellTime: number) => {
    const s = memory();
    writeSettings({ ...DEFAULT_SETTINGS, profile: { dwellTime } }, s);
    return readSettings(s);
  };

  it.each([1000, 1400, 600])("keeps a saved dwellTime of %i", (d) => {
    const r = saved(d);
    expect(r.usedDefault).toBe(false);
    expect(resolveInitialProfile(r).dwellTime).toBe(d);
  });

  it("an imported profile keeps its dwellTime of 1000", () => {
    const p = mk();
    p.setProfile({ dwellTime: 1000 });
    const imported = importBoardSettings(mk(), exportBoardSettings(p, DEFAULT_SETTINGS.board)).value;
    const s = memory();
    writeSettings({ profile: imported.profile, board: imported.board }, s);
    expect(resolveInitialProfile(readSettings(s)).dwellTime).toBe(1000);
  });

  it("applies 1400 ms when nothing is saved", () => {
    const r = readSettings(memory());
    expect(r.usedDefault).toBe(true);
    expect(resolveInitialProfile(r)).toEqual({ dwellTime: 1400 });
  });
});
