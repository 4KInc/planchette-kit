import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Every import/export-from/dynamic-import specifier in the source text. */
export function specifiers(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\b(?:import|export)\s[^'"`;]*?\sfrom\s*(['"])([^'"]+)\1/g,
    /\bimport\s*(['"])([^'"]+)\1/g,
    /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
  ];
  for (const re of patterns) for (const m of source.matchAll(re)) found.push(m[2]!);
  return found;
}

/** Specifiers that mention skeleton but are not one of the two public names. */
export function violations(source: string): string[] {
  return specifiers(source).filter(
    (s) => s.includes("skeleton") && s !== "@planchette/skeleton" && s !== "@planchette/skeleton/ui",
  );
}

/** Specifiers that reach into the Board app: Séance never imports from it (design.md). */
export function boardImports(source: string): string[] {
  return specifiers(source).filter((s) => /(^|\/)apps\/board(\/|$)/.test(s) || /(^|\/)board\/src(\/|$)/.test(s) || s.startsWith("@planchette/board"));
}
describe("skeleton import boundary", () => {
  it("apps/seance/src imports nothing from the Board app", () => {
    for (const file of tsFiles(SRC)) {
      expect(boardImports(readFileSync(file, "utf8")), file).toEqual([]);
    }
  });
  it("the Board-import check flags a Board path when it should", () => {
    expect(boardImports(`import { a } from "../../board/src/x";`)).toHaveLength(1);
    expect(boardImports(`import { a } from "@planchette/board";`)).toHaveLength(1);
    expect(boardImports(`import { a } from "./round.js";`)).toEqual([]);
  });
  it("apps/seance/src imports the skeleton only through its public names", () => {
    for (const file of tsFiles(SRC)) {
      expect(violations(readFileSync(file, "utf8")), file).toEqual([]);
    }
  });

  // "§" stands for the package folder name in the violating samples below, so this file's own
  // text does not trip the repo-wide scanner in skeleton/test/package-build.test.ts.
  const sample = (text: string): string => text.replaceAll("§", "skeleton");

  it("accepts the two public specifiers", () => {
    const ok = `import { a } from "@planchette/skeleton";
import type { B } from '@planchette/skeleton/ui';
export { c } from "@planchette/skeleton";
const m = await import("@planchette/skeleton/ui");`;
    expect(specifiers(ok)).toHaveLength(4);
    expect(violations(ok)).toEqual([]);
  });

  it("flags relative paths and other subpaths", () => {
    expect(violations(sample(`import { a } from "../../§/src/index";`))).toHaveLength(1);
    expect(violations(sample(`export * from "@planchette/§/engine/dwell";`))).toHaveLength(1);
    expect(violations(sample(`const m = await import("@planchette/§/src/x");`))).toHaveLength(1);
    expect(violations(sample(`import "../§/src/ui";`))).toHaveLength(1);
  });
});
