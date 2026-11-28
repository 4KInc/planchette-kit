import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { powerDir, repoRoot } from "./power-helpers.js";

const read = (p: string): string => readFileSync(p, "utf8");
const MARK = "=== copy starts ===\n";

describe("copies in references/ match the documents they cite", () => {
  for (const [copy, doc] of [
    ["check-dwell-layout/references/board-gate-example.md", "docs/board-gate.md"],
    ["check-dwell-layout/references/seance-gate-example.md", "docs/seance-gate.md"],
  ] as const) {
    it(`${copy} is ${doc} verbatim after its marker`, () => {
      const text = read(`${powerDir}/skills/${copy}`);
      expect(text.includes(MARK)).toBe(true);
      const body = text.slice(text.indexOf(MARK) + MARK.length);
      expect(body === read(`${repoRoot}/${doc}`), `${copy} differs from ${doc}; regenerate the copy`).toBe(true);
    });
  }

  it("board-1400-to-2100.md holds two sections of docs/board-gate.md verbatim", () => {
    const text = read(`${powerDir}/skills/compare-dwell-settings/references/board-1400-to-2100.md`);
    const doc = read(`${repoRoot}/docs/board-gate.md`);
    const one = text.slice(text.indexOf("=== section 1 starts ===\n") + "=== section 1 starts ===\n".length, text.indexOf("=== section 2 starts ===\n"));
    const two = text.slice(text.indexOf("=== section 2 starts ===\n") + "=== section 2 starts ===\n".length);
    expect(one.startsWith("## The six presets, seed 1, 1400 ms to 2100 ms")).toBe(true);
    expect(two.startsWith("## Compare runs")).toBe(true);
    expect(doc.includes(one), "section 1 is in docs/board-gate.md").toBe(true);
    expect(doc.includes(two), "section 2 is in docs/board-gate.md").toBe(true);
    expect(one).toContain("52.1 → 3.6");
    expect(two).toContain("50.6 → 2.4 (−48.2)");
  });

  it("accessibility-rules.md holds every line of the steering file's body, and the extra rules", () => {
    const steering = read(`${repoRoot}/.kiro/steering/accessibility.md`).split("---\n").slice(2).join("---\n");
    const copy = read(`${powerDir}/skills/build-on-the-skeleton/references/accessibility-rules.md`);
    for (const line of steering.split("\n")) {
      if (line.trim() === "" || line.includes("#[[file:")) continue;
      expect(copy.includes(line), `missing line: ${line}`).toBe(true);
    }
    const lower = copy.toLowerCase();
    for (const phrase of [
      "no camera until a press",
      "4.5:1",
      "3:1",
      "prefers-reduced-motion",
      "1366x768 and at 1920x1080",
      "not a medical device",
      "rest area",
      "cancel and undo are reachable in every input mode",
      "more than 3 times a second",
    ]) {
      expect(lower.includes(phrase), `accessibility-rules.md says "${phrase}"`).toBe(true);
    }
  });
});
