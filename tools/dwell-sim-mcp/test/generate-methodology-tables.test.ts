import { describe, expect, it } from "vitest";
import { generateMethodologyTables } from "../scripts/generate-methodology-tables.js";
import { FIGURES, REFERENCES } from "../src/figures.js";
import { PRESETS } from "../src/presets.js";

const output = generateMethodologyTables({ figures: FIGURES, references: REFERENCES, presets: PRESETS });

describe("generateMethodologyTables", () => {
  it("has every FIGURES row (label and value)", () => {
    for (const row of Object.values(FIGURES)) {
      expect(output).toContain(row.label);
      expect(output).toContain(row.value);
    }
  });

  it("has every reference number, citation and link", () => {
    for (const [n, ref] of Object.entries(REFERENCES)) {
      expect(output).toContain(`${n}. ${ref.citation}`);
      if (ref.url) {
        expect(output).toContain(`[[${n}]](${ref.url})`);
        expect(output).toContain(`<${ref.url}>`);
      }
    }
  });

  it("has every chosen reason and every figure-source note in PRESETS", () => {
    let chosen = 0;
    for (const preset of Object.values(PRESETS)) {
      for (const { source } of Object.values(preset.params)) {
        if (source.kind === "chosen") {
          chosen++;
          expect(output).toContain(source.reason);
        } else if (source.note) {
          expect(output).toContain(source.note);
        }
      }
    }
    expect(chosen).toBeGreaterThan(0);
    expect(output).toContain("chosen pairing");
  });

  it("is deterministic", () => {
    expect(generateMethodologyTables({ figures: FIGURES, references: REFERENCES, presets: PRESETS })).toBe(output);
  });
});
