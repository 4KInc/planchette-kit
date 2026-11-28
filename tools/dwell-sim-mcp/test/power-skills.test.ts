import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { powerDir } from "./power-helpers.js";

const skillsDir = join(powerDir, "skills");
const names = readdirSync(skillsDir).filter((n) => statSync(join(skillsDir, n)).isDirectory());

interface Parsed {
  front: Record<string, string>;
  body: string;
}
function parse(text: string): Parsed {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error("no frontmatter");
  const front: Record<string, string> = {};
  for (const line of (m[1] ?? "").split("\n")) {
    const kv = /^([a-z-]+):\s*(.*)$/.exec(line);
    if (kv) front[kv[1] as string] = kv[2] as string;
  }
  return { front, body: m[2] ?? "" };
}

describe("skills of the power", () => {
  it("are exactly the three agreed skills", () => {
    expect([...names].sort()).toEqual(["build-on-the-skeleton", "check-dwell-layout", "compare-dwell-settings"]);
  });

  for (const name of names) {
    describe(name, () => {
      const file = join(skillsDir, name, "SKILL.md");
      const { front, body } = parse(readFileSync(file, "utf8"));

      it("has frontmatter with a name equal to its folder and a description", () => {
        expect(front["name"]).toBe(name);
        expect(front["name"]).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect((front["name"] ?? "").length).toBeLessThanOrEqual(64);
        expect((front["description"] ?? "").length).toBeGreaterThan(40);
        expect((front["description"] ?? "").length).toBeLessThanOrEqual(1024);
        expect(Object.keys(front).sort()).toEqual(["description", "name"]);
      });

      it("has numbered steps in its body", () => {
        expect(body.match(/^## Step \d+:/gm)?.length ?? 0).toBeGreaterThanOrEqual(3);
      });

      it("only links to references and scripts that exist", () => {
        const mentioned = new Set(body.match(/(?:references|scripts)\/[A-Za-z0-9._-]+/g) ?? []);
        for (const rel of mentioned) {
          const target = join(skillsDir, name, rel);
          const sibling = join(skillsDir, "check-dwell-layout", rel);
          expect(existsSync(target) || (name !== "check-dwell-layout" && existsSync(sibling) && rel.startsWith("scripts/")), `${name}: ${rel}`).toBe(true);
        }
        expect(existsSync(dirname(file))).toBe(true);
      });

      it("makes no claim the project forbids", () => {
        const text = `${front["description"] ?? ""}\n${body}`.toLowerCase();
        expect(text).not.toMatch(/eye[- ]tracking (is|works|support)|brand[- ]new input|first (head|input)/);
        expect(text).not.toMatch(/\b(violat|illegal|non-?compliant|breach|unlawful)/);
      });
    });
  }

  it("check-dwell-layout names the tools, the seeds, the gate and the worked examples", () => {
    const text = readFileSync(join(skillsDir, "check-dwell-layout", "SKILL.md"), "utf8");
    for (const word of ["list_users", "simulate", "seeds 1 to 10", "reads-while-pointing", "10 accidental", "multi-seed rule", "board-gate", "seance-gate", "1366", "1920", "not real people"]) {
      expect(text.includes(word), `check-dwell-layout mentions "${word}"`).toBe(true);
    }
  });

  it("compare-dwell-settings names compare, the cost and the Board example", () => {
    const text = readFileSync(join(skillsDir, "compare-dwell-settings", "SKILL.md"), "utf8");
    for (const word of ["compare", "1400", "2100", "50.6", "2.4", "700 ms", "not real people"]) {
      expect(text.includes(word), `compare-dwell-settings mentions "${word}"`).toBe(true);
    }
  });

  it("build-on-the-skeleton names the API it teaches, and every name exists in the skeleton's exports", () => {
    const skill = readFileSync(join(skillsDir, "build-on-the-skeleton", "SKILL.md"), "utf8");
    const cheat = readFileSync(join(skillsDir, "build-on-the-skeleton", "references", "api-cheatsheet.md"), "utf8");
    const ui = readFileSync(join(powerDir, "..", "skeleton", "src", "ui", "index.ts"), "utf8");
    const core = readFileSync(join(powerDir, "..", "skeleton", "src", "index.ts"), "utf8");
    for (const word of ["data-planchette-target", "mountInputControls", "createSettingsGate", "createTargetRegistry", "renderedCellSize", "rest area", "medical device", "1366×768", "1920×1080"]) {
      expect(skill.includes(word) || cheat.includes(word), `mentions "${word}"`).toBe(true);
    }
    for (const exported of ["createTargetRegistry", "createDwellRing", "createScanHighlight", "mountInputControls", "createSettingsGate", "fitCellSize", "renderedCellSize", "PAGE_FIT"]) {
      expect(ui.includes(exported), `skeleton/ui exports ${exported}`).toBe(true);
    }
    for (const exported of ["createPlanchette", "pointToRotation", "rotationToPoint"]) {
      expect(core.includes(exported), `skeleton exports ${exported}`).toBe(true);
    }
  });
});
