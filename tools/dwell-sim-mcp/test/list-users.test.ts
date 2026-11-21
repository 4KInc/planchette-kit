import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CUSTOM_RANGES } from "../src/custom-ranges.js";
import { DISCLAIMER } from "../src/disclaimer.js";
import { listUsers } from "../src/list-users.js";
import { PRESET_NAMES } from "../src/presets.js";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const requirements = read("../../../.kiro/specs/dwell-sim-mcp/requirements.md");
const live = (): unknown => JSON.parse(JSON.stringify(listUsers()));

/** Rows of the Figures table: label -> reference numbers in the Source column. */
function figureRows(): Map<string, number[]> {
  const rows = new Map<string, number[]>();
  const lines = requirements.split("\n");
  const start = lines.findIndex((l) => l.startsWith("| Figure | Value | Source |"));
  for (let i = start + 2; i < lines.length && lines[i].startsWith("|"); i++) {
    const cells = lines[i].split(" | ").map((c) => c.replace(/^\|\s*|\s*\|$/g, ""));
    const refs = [...(cells[2] ?? "").matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    rows.set(cells[0], refs);
  }
  return rows;
}

describe("list_users", () => {
  it("equals the golden file", () => {
    expect(live()).toEqual(JSON.parse(read("./golden/list-users.json")));
  });

  it("lists every preset with a source or chosen reason for every parameter", () => {
    const out = listUsers();
    expect(out.users.map((u) => u.name)).toEqual([...PRESET_NAMES]);
    for (const user of out.users) {
      expect(Object.keys(user.parameters)).toHaveLength(14);
      for (const p of Object.values(user.parameters)) {
        if (typeof p.source === "string") expect(p.source.startsWith("chosen")).toBe(true);
        else expect(p.source.row.length).toBeGreaterThan(0);
      }
      expect(user.parameters.trackingNoiseDeg.value).toBe(0);
    }
  });

  it("uses Figures table row labels with the same reference number as requirements.md", () => {
    const rows = figureRows();
    expect(rows.size).toBe(15);
    let figureSources = 0;
    for (const user of listUsers().users) {
      for (const p of Object.values(user.parameters)) {
        if (typeof p.source === "string") continue;
        figureSources++;
        expect(rows.has(p.source.row), p.source.row).toBe(true);
        expect(rows.get(p.source.row)).toContain(p.source.ref);
      }
    }
    expect(figureSources).toBeGreaterThan(0);
  });

  it("returns the ranges of the Custom ranges paragraph", () => {
    const start = requirements.indexOf("Custom ranges (chosen");
    const paragraph = requirements.slice(start, requirements.indexOf("\n\n", start));
    const pairs = [...paragraph.matchAll(/(\d+(?:\.\d+)?)–(\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const order = [
      "throughputBitsPerS",
      "tremorFrequencyHz",
      "tremorPeakToPeakDeg",
      "headRangeDeg",
      "reactionTimeMs",
      "readingPauseChancePct",
      "readingPauseLengthMs",
      "scatterCapDeg",
      "trackingNoiseDeg",
      "analysisWindowS",
    ] as const;
    expect(pairs).toHaveLength(order.length);
    const ranges = listUsers().customRanges;
    expect(Object.keys(ranges).sort()).toEqual(Object.keys(CUSTOM_RANGES).sort());
    order.forEach((key, i) => {
      expect([ranges[key].min, ranges[key].max]).toEqual(pairs[i]);
    });
  });

  it("includes the disclaimer", () => {
    expect(listUsers().disclaimer).toBe(DISCLAIMER);
  });
});
