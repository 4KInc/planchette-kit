import { createPlanchette } from "@planchette/skeleton";
import { describe, expect, it } from "vitest";
import { createBoardApp } from "../src/main";
import { KEY_SETTINGS, readSettings, type StorageLike } from "../src/board-storage";

function memory(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

function boardApp(storage: StorageLike) {
  return createBoardApp({
    storage,
    now: () => 0,
    speak: async () => ({ spoken: true }),
    wordList: { words: new Map() },
    excluded: new Set(),
  });
}

describe("saveProfile", () => {
  it("writes the settings key with the profile and the current Board settings", () => {
    const storage = memory();
    const a = boardApp(storage);
    expect(storage.getItem(KEY_SETTINGS)).toBeNull();
    a.saveProfile({ mode: "mouse", dwellTime: 1400 });
    expect(storage.getItem(KEY_SETTINGS)).not.toBeNull();
    const saved = readSettings(storage);
    expect(saved.usedDefault).toBe(false);
    expect(saved.value.profile).toEqual({ mode: "mouse", dwellTime: 1400 });
    expect(saved.value.board).toEqual(a.getSettings());
  });

  it("a fresh app returns the saved profile as initialProfile unchanged", () => {
    const storage = memory();
    boardApp(storage).saveProfile({ mode: "mouse", dwellTime: 1400 });
    expect(boardApp(storage).initialProfile).toEqual({ mode: "mouse", dwellTime: 1400 });
  });

  it("a saved full exported profile comes back unchanged", () => {
    const storage = memory();
    const p = createPlanchette({ screen: { width: 1000, height: 800 } });
    p.setProfile({ mode: "mouse", dwellTime: 1000 });
    const profile = JSON.parse(p.exportProfile()) as Record<string, unknown>;
    boardApp(storage).saveProfile(profile);
    expect(boardApp(storage).initialProfile).toEqual(profile);
  });
});

describe("nothing saved", () => {
  it("initialProfile is { dwellTime: 1400 } and startCameraOnLoad stays false", () => {
    const a = boardApp(memory());
    expect(a.initialProfile).toEqual({ dwellTime: 1400 });
    const p = createPlanchette({ screen: { width: 1000, height: 800 } });
    p.setProfile(a.initialProfile);
    expect(p.getProfile().startCameraOnLoad).toBe(false);
  });
});
