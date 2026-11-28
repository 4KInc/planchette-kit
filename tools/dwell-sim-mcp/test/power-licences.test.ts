import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBundle } from "../scripts/bundle-power.js";
import { bundlePath, powerDir, repoRoot } from "./power-helpers.js";

const ALLOWED = /^(MIT|Apache-2\.0|ISC|BSD-[23]-Clause)$/;
const thirdParty = readFileSync(`${repoRoot}/THIRD_PARTY.md`, "utf8");
const section = ((): string => {
  const start = thirdParty.indexOf("## Kiro power bundle");
  const next = thirdParty.indexOf("\n## ", start + 1);
  return start < 0 ? "" : thirdParty.slice(start, next < 0 ? undefined : next);
})();

describe("licences of what the bundle inlines", () => {
  it("THIRD_PARTY.md has a Kiro power bundle section", () => {
    expect(section).not.toBe("");
  });

  it("lists every inlined package at its version, each with an allowed licence", async () => {
    const { packages } = await buildBundle();
    expect(packages.length).toBeGreaterThan(0);
    for (const pkg of packages) {
      expect(pkg.license, `${pkg.name} licence`).toMatch(ALLOWED);
      const row = `| \`${pkg.name}\` | ${pkg.version} | ${pkg.license} |`;
      expect(section, `THIRD_PARTY.md, section "Kiro power bundle", needs the row ${row}`).toContain(row);
    }
  });

  it("keeps the licence text of every inlined package at the end of the bundle", async () => {
    const { packages } = await buildBundle();
    const text = readFileSync(bundlePath, "utf8");
    const footer = text.slice(text.indexOf("/*! Licences of the packages inlined above."));
    expect(footer.startsWith("/*!")).toBe(true);
    for (const pkg of packages) {
      expect(footer.includes(`=== ${pkg.name} ${pkg.version} (${pkg.license}) ===`), `licence text of ${pkg.name}`).toBe(true);
    }
    expect(footer.includes("Permission is hereby granted"), "an MIT licence text").toBe(true);
  });

  it("does not inline @mediapipe/tasks-vision, and the simulator reaches it only through a lazy import()", async () => {
    const { packages } = await buildBundle();
    expect(packages.map((p) => p.name)).not.toContain("@mediapipe/tasks-vision");
    const text = readFileSync(bundlePath, "utf8");
    const refs = text.split("\n").filter((l) => l.includes("@mediapipe/tasks-vision") && !l.trimStart().startsWith("//"));
    expect(refs.length).toBeGreaterThan(0);
    for (const line of refs) expect(line.includes('await import("@mediapipe/tasks-vision")'), line).toBe(true);
  });

  it("contains no absolute home path in the bundle or in the power's JSON files", () => {
    const files = [bundlePath, `${powerDir}/mcp.json`, `${powerDir}/plugin.json`];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/\/Users\/[A-Za-z0-9._-]+\//);
      expect(text, file).not.toMatch(/\/home\/[A-Za-z0-9._-]+\//);
      expect(text, file).not.toMatch(/[A-Z]:\\Users\\/);
    }
  });

  it("contains no email address in the power's JSON files", () => {
    for (const file of [`${powerDir}/mcp.json`, `${powerDir}/plugin.json`]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
    }
  });
});
