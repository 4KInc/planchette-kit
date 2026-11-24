import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateMethodologyTables } from "../scripts/generate-methodology-tables.js";
import { FIGURES, REFERENCES } from "../src/figures.js";
import { PRESETS } from "../src/presets.js";

const doc = readFileSync(new URL("../METHODOLOGY.md", import.meta.url), "utf8");

describe("METHODOLOGY.md", () => {
  it("contains the generated tables unchanged", () => {
    const tables = generateMethodologyTables({ figures: FIGURES, references: REFERENCES, presets: PRESETS });
    expect(doc).toContain(tables);
  });

  it("mentions every FIGURES row label", () => {
    for (const row of Object.values(FIGURES)) {
      expect(doc).toContain(row.label);
    }
  });

  it("mentions every reference number with its link", () => {
    for (const [n, ref] of Object.entries(REFERENCES)) {
      expect(doc).toContain(`${n}. ${ref.citation}`);
      if (ref.url) {
        expect(doc).toContain(`[[${n}]](${ref.url})`);
        expect(doc).toContain(`<${ref.url}>`);
      }
    }
  });

  it("mentions every chosen reason in the preset data", () => {
    let chosen = 0;
    for (const preset of Object.values(PRESETS)) {
      for (const { source } of Object.values(preset.params)) {
        if (source.kind === "chosen") {
          chosen++;
          expect(doc).toContain(source.reason);
        }
      }
    }
    expect(chosen).toBeGreaterThan(0);
  });

  it("lists every Out of scope item", () => {
    const items = [
      "Eye tracking, hand pointing and touch.",
      "Fatigue over a long session, learning effects, and changes in a person's condition.",
      "Users who react to on-screen feedback, and camera delay. The model is open loop.",
      "Tracking dropouts (face lost).",
      "MediaPipe and the camera adapter's rotation maths. The simulator feeds engine-level rotation.",
      "Loading a live web page. The layout comes from `getTargets()`; the app or a hook exports it.",
      "Any claim about a specific condition or person. Presets are named after movement features, not diagnoses.",
    ];
    for (const item of items) expect(doc).toContain(item);
  });

  it("has the sinusoid caveat", () => {
    expect(doc).toContain("Real tremor is less regular, and in cervical dystonia often irregular.");
  });

  it("works out the derived values", () => {
    expect(doc).toContain("72 / 4.133 = 17.4 px");
    expect(doc).toContain("2.5° / 4.133 = 0.6°");
    expect(doc).toContain("12.3 / (2π × 4.25) = 0.46°");
    expect(doc).toContain("7.77 / (2π × 4.37) = 0.28°");
    expect(doc).toContain("ET mean + 2 SD = 1.6°");
  });

  it("has the three limits notes verbatim", () => {
    expect(doc).toContain("The simulator plans with the centre the engine captured, as a real user's pointer does.");
    expect(doc).toContain(
      "Frame rate: at 15 fps the smoothed pointer arrives later than at 60 fps (median +70 ms, up to about 270 ms in the measured sample); time-to-select at low fps includes this.",
    );
    expect(doc).toContain(
      "Whether a gap off a target continues a stay or resets it can differ between frame rates when the gap is close to graceTime.",
    );
  });
});
