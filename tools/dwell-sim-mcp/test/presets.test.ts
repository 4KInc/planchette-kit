import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CUSTOM_RANGES,
  ENUM_PARAMS,
  NON_CUSTOMISABLE_PARAMS,
  type CustomParamName,
} from "../src/custom-ranges.js";
import { FIGURES, REFERENCES } from "../src/figures.js";
import { PRESET_NAMES, PRESETS, type PresetName } from "../src/presets.js";
import type { UserParams } from "../src/types.js";

const REQUIREMENTS = readFileSync(
  new URL("../../../.kiro/specs/dwell-sim-mcp/requirements.md", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");

function section(heading: string): string {
  const start = REQUIREMENTS.indexOf(`\n${heading}\n`);
  expect(start, heading).toBeGreaterThanOrEqual(0);
  const end = REQUIREMENTS.indexOf("\n## ", start + 1);
  return REQUIREMENTS.slice(start, end === -1 ? undefined : end);
}

function tableRows(text: string, headerStart: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("| ") || line.startsWith(headerStart)) continue;
    rows.push(line.replace(/^\| /, "").replace(/ \|$/, "").split(" | "));
  }
  return rows;
}

interface PresetRow {
  throughput: string;
  tremor: string;
  range: string;
  pauses: string;
  noise: string;
}

function parsePresetTable(): Map<string, PresetRow> {
  const out = new Map<string, PresetRow>();
  for (const cells of tableRows(section("## Presets"), "| Preset |")) {
    if (cells.length !== 6) continue;
    const [name, throughput, tremor, range, pauses, noise] = cells as [
      string, string, string, string, string, string,
    ];
    out.set(name.replace(/`/g, ""), { throughput, tremor, range, pauses, noise });
  }
  return out;
}

function parseShared(): Map<string, string> {
  const out = new Map<string, string>();
  for (const cells of tableRows(section("## Presets"), "| Parameter |")) {
    if (cells.length === 3) out.set(cells[0] ?? "", cells[1] ?? "");
  }
  return out;
}

function num(text: string, re: RegExp): number {
  const m = re.exec(text);
  expect(m, `${re} in "${text}"`).not.toBeNull();
  return Number(m?.[1]);
}

const PRESET_TABLE = parsePresetTable();
const SHARED = parseShared();

function value<K extends keyof UserParams>(name: PresetName, key: K): UserParams[K] {
  return PRESETS[name].params[key].value;
}

describe("preset names", () => {
  it("lists the six presets, each present in PRESETS and in the requirements table", () => {
    expect([...PRESET_NAMES]).toEqual([
      "steady",
      "slow",
      "head-tremor",
      "strong-head-tremor",
      "small-range",
      "reads-while-pointing",
    ]);
    expect(Object.keys(PRESETS).sort()).toEqual([...PRESET_NAMES].sort());
    expect([...PRESET_TABLE.keys()].sort()).toEqual([...PRESET_NAMES].sort());
    for (const name of PRESET_NAMES) expect(PRESETS[name].name).toBe(name);
  });
});

describe("preset values equal requirements.md", () => {
  for (const name of PRESET_NAMES) {
    describe(name, () => {
      const row = PRESET_TABLE.get(name);
      if (row === undefined) throw new Error(`no table row for ${name}`);

      it("throughput", () => {
        expect(value(name, "throughputBitsPerS")).toBe(num(row.throughput, /^([\d.]+) bits\/s/));
      });

      it("tremor frequency, size and axis", () => {
        if (row.tremor === "none") {
          expect(value(name, "tremorFrequencyHz")).toBe(0);
          expect(value(name, "tremorPeakToPeakDeg")).toBe(0);
          expect(value(name, "tremorAxis")).toBe("yaw");
        } else {
          expect(value(name, "tremorFrequencyHz")).toBe(num(row.tremor, /^([\d.]+) Hz/));
          expect(value(name, "tremorPeakToPeakDeg")).toBe(num(row.tremor, /, ([\d.]+)° p-p/));
          expect(value(name, "tremorAxis")).toBe(/, (yaw|pitch)\b/.exec(row.tremor)?.[1]);
        }
      });

      it("head range", () => {
        const r = num(row.range, /^±([\d.]+)°/);
        expect(value(name, "headRangeDeg")).toEqual({ left: r, right: r, up: r, down: r });
      });

      it("reading pauses", () => {
        if (row.pauses === "none") {
          expect(value(name, "readingPauseChancePct")).toBe(0);
          expect(value(name, "readingPauseLengthMs")).toEqual({ min: 0, max: 0 });
        } else {
          expect(value(name, "readingPauseChancePct")).toBe(num(row.pauses, /^([\d.]+) % chance/));
          expect(value(name, "readingPauseLengthMs")).toEqual({
            min: num(row.pauses, /, ([\d.]+)–/),
            max: num(row.pauses, /–([\d.]+) ms/),
          });
        }
      });

      it("tracking noise is 0°", () => {
        expect(num(row.noise, /^([\d.]+)°/)).toBe(0);
        expect(value(name, "trackingNoiseDeg")).toBe(0);
      });

      it("shared parameters", () => {
        expect(value(name, "reactionTimeMs")).toBe(num(SHARED.get("Reaction time") ?? "", /^([\d.]+) ms/));
        expect(value(name, "scatterCapDeg")).toBe(num(SHARED.get("Scatter cap") ?? "", /^([\d.]+)°/));
        expect(value(name, "tremorDriftFraction")).toBe(
          num(SHARED.get("Tremor size drift") ?? "", /±([\d.]+) %/) / 100,
        );
        expect(value(name, "scanReactionTimeMs")).toBe(
          num(SHARED.get("Scan switch reaction time") ?? "", /^([\d.]+) ms/),
        );
        expect(value(name, "scanLatePressChancePct")).toBe(
          num(SHARED.get("Scan late-press chance") ?? "", /^([\d.]+) %/),
        );
        expect(value(name, "scanPressDurationMs")).toBe(
          num(SHARED.get("Scan press duration") ?? "", /^([\d.]+) ms/),
        );
      });

      it("cited reference numbers match the table cell", () => {
        const cell = row.throughput;
        const src = PRESETS[name].params.throughputBitsPerS.source;
        if (src.kind === "figure") expect(cell).toContain(`[${src.ref}]`);
        const tremorSrc = PRESETS[name].params.tremorFrequencyHz.source;
        if (tremorSrc.kind === "figure") expect(row.tremor).toContain(`[${tremorSrc.ref}]`);
      });
    });
  }
});

describe("sources", () => {
  const entries = PRESET_NAMES.flatMap((name) =>
    Object.entries(PRESETS[name].params).map(([key, p]) => ({ name, key, source: p.source })),
  );

  it("gives every parameter of every preset a source", () => {
    for (const name of PRESET_NAMES) {
      const keys = Object.keys(PRESETS[name].params).sort();
      expect(keys).toEqual(
        [
          "throughputBitsPerS", "tremorFrequencyHz", "tremorPeakToPeakDeg", "tremorAxis",
          "tremorDriftFraction", "headRangeDeg", "reactionTimeMs", "readingPauseChancePct",
          "readingPauseLengthMs", "trackingNoiseDeg", "scatterCapDeg", "scanReactionTimeMs",
          "scanLatePressChancePct", "scanPressDurationMs",
        ].sort(),
      );
    }
    for (const { name, key, source } of entries) {
      const label = `${name}.${key}`;
      expect(["figure", "chosen"], label).toContain(source.kind);
      if (source.kind === "chosen") expect(source.reason.trim().length, label).toBeGreaterThan(0);
    }
  });

  it("makes every figure source name an existing FIGURES row and reference of that row", () => {
    for (const { name, key, source } of entries) {
      if (source.kind !== "figure") continue;
      const label = `${name}.${key}`;
      const row = FIGURES[source.row];
      expect(row, label).toBeDefined();
      expect(row.refs, label).toContain(source.ref);
      expect(REFERENCES[source.ref], label).toBeDefined();
    }
  });
});

describe("custom ranges", () => {
  it("matches the Custom ranges paragraph", () => {
    const text = section("## Chosen values").replace(/\s+/g, " ");
    expect(text).toContain("throughput 0.3–4 bits/s");
    expect(text).toContain("tremor 0–15 Hz and 0–5° peak to peak");
    expect(text).toContain("head range 3–60° per direction");
    expect(text).toContain("reaction time 150–1500 ms");
    expect(text).toContain("reading-pause chance 0–100 %, length 0–3000 ms");
    expect(text).toContain("scatter cap 0.1–3°");
    expect(text).toContain("tracking noise 0–2°");
    expect(text).toContain("analysis window 2–120 s");
    const r = CUSTOM_RANGES;
    expect([r.throughputBitsPerS.min, r.throughputBitsPerS.max]).toEqual([0.3, 4]);
    expect([r.tremorFrequencyHz.min, r.tremorFrequencyHz.max]).toEqual([0, 15]);
    expect([r.tremorPeakToPeakDeg.min, r.tremorPeakToPeakDeg.max]).toEqual([0, 5]);
    expect([r.headRangeDeg.min, r.headRangeDeg.max]).toEqual([3, 60]);
    expect([r.reactionTimeMs.min, r.reactionTimeMs.max]).toEqual([150, 1500]);
    expect([r.readingPauseChancePct.min, r.readingPauseChancePct.max]).toEqual([0, 100]);
    expect([r.readingPauseLengthMs.min, r.readingPauseLengthMs.max]).toEqual([0, 3000]);
    expect([r.scatterCapDeg.min, r.scatterCapDeg.max]).toEqual([0.1, 3]);
    expect([r.trackingNoiseDeg.min, r.trackingNoiseDeg.max]).toEqual([0, 2]);
    expect([r.analysisWindowS.min, r.analysisWindowS.max]).toEqual([2, 120]);
  });

  it("has a path, a unit and min <= max for every range", () => {
    for (const [key, range] of Object.entries(CUSTOM_RANGES)) {
      expect(range.path, key).toBe(key);
      expect(range.unit.length, key).toBeGreaterThan(0);
      expect(range.min, key).toBeLessThanOrEqual(range.max);
    }
  });

  it("contains every preset value", () => {
    const check = (label: string, v: number, key: CustomParamName): void => {
      const { min, max } = CUSTOM_RANGES[key];
      expect(v, label).toBeGreaterThanOrEqual(min);
      expect(v, label).toBeLessThanOrEqual(max);
    };
    for (const name of PRESET_NAMES) {
      const p = (k: keyof UserParams) => PRESETS[name].params[k].value;
      check(name, value(name, "throughputBitsPerS"), "throughputBitsPerS");
      check(name, value(name, "tremorFrequencyHz"), "tremorFrequencyHz");
      check(name, value(name, "tremorPeakToPeakDeg"), "tremorPeakToPeakDeg");
      for (const side of ["left", "right", "up", "down"] as const) {
        check(`${name}.${side}`, value(name, "headRangeDeg")[side], "headRangeDeg");
      }
      check(name, value(name, "reactionTimeMs"), "reactionTimeMs");
      check(name, value(name, "readingPauseChancePct"), "readingPauseChancePct");
      check(name, value(name, "readingPauseLengthMs").min, "readingPauseLengthMs");
      check(name, value(name, "readingPauseLengthMs").max, "readingPauseLengthMs");
      expect(value(name, "readingPauseLengthMs").min).toBeLessThanOrEqual(
        value(name, "readingPauseLengthMs").max,
      );
      check(name, value(name, "scatterCapDeg"), "scatterCapDeg");
      check(name, value(name, "trackingNoiseDeg"), "trackingNoiseDeg");
      expect(["yaw", "pitch"]).toContain(p("tremorAxis"));
    }
  });

  it("makes every CUSTOM_RANGES key overridable and every other UserParams key not", () => {
    const userKeys = Object.keys(PRESETS.steady.params);
    const ranged = Object.keys(CUSTOM_RANGES).filter((k) => k !== "analysisWindowS");
    // analysisWindowS is a request parameter, not a user parameter.
    expect(userKeys).not.toContain("analysisWindowS");
    for (const k of ranged) expect(userKeys, k).toContain(k);
    const overridable = new Set<string>([...ranged, ...ENUM_PARAMS]);
    const notOverridable = new Set<string>(NON_CUSTOMISABLE_PARAMS);
    for (const k of userKeys) {
      expect(overridable.has(k) !== notOverridable.has(k), k).toBe(true);
    }
    expect([...notOverridable].sort()).toEqual([
      "scanLatePressChancePct",
      "scanPressDurationMs",
      "scanReactionTimeMs",
      "tremorDriftFraction",
    ]);
    for (const k of notOverridable) expect(Object.keys(CUSTOM_RANGES)).not.toContain(k);
  });
});
