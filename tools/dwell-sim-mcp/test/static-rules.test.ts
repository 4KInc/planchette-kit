import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

const ALLOWED_IMPORTS = new Set([
  "@modelcontextprotocol/sdk/server/mcp.js",
  "@modelcontextprotocol/sdk/server/stdio.js",
  "zod",
  "@planchette/skeleton",
]);

const FORBIDDEN_PATTERNS: ReadonlyArray<{ rule: string; pattern: RegExp }> = [
  { rule: "Math.random", pattern: /\bMath\s*\.\s*random\b/ },
  { rule: "Date.now", pattern: /\bDate\s*\.\s*now\b/ },
  { rule: "performance.now", pattern: /\bperformance\s*\.\s*now\b/ },
  { rule: "new Date", pattern: /\bnew\s+Date\b/ },
  { rule: "setTimeout", pattern: /\bsetTimeout\b/ },
  { rule: "setInterval", pattern: /\bsetInterval\b/ },
  { rule: "fetch", pattern: /\bfetch\s*\(/ },
  { rule: "any type annotation", pattern: /:\s*any\b|\bas\s+any\b|<\s*any\s*[,>]|\bany\s*\[\]/ },
];

/** Replace comments with spaces (keeping string literals intact) so rules only see code. */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      out += " ";
    } else if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") {
          out += source[i++];
        }
        out += source[i++] ?? "";
      }
      out += quote;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function importSpecifiers(code: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of code.matchAll(re)) specs.push(m[1]);
  }
  return specs;
}

/** Returns a list of human-readable violations for one source file's text. */
export function checkSource(source: string): string[] {
  const code = stripComments(source);
  const violations: string[] = [];
  for (const { rule, pattern } of FORBIDDEN_PATTERNS) {
    if (pattern.test(code)) violations.push(`forbidden: ${rule}`);
  }
  for (const spec of importSpecifiers(code)) {
    const relative = spec.startsWith("./") || spec.startsWith("../");
    if (!relative && !ALLOWED_IMPORTS.has(spec)) {
      violations.push(`disallowed import: ${spec}`);
    }
  }
  return violations;
}

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listSourceFiles(full));
    else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry.name)) files.push(full);
  }
  return files;
}

describe("dwell-sim-mcp src/ static rules", () => {
  it("finds at least one source file", () => {
    expect(listSourceFiles(SRC_DIR).length).toBeGreaterThan(0);
  });

  it("no file in src/ violates the clock, import, fetch, or any rules", () => {
    const report: Record<string, string[]> = {};
    for (const file of listSourceFiles(SRC_DIR)) {
      const violations = checkSource(readFileSync(file, "utf8"));
      if (violations.length > 0) report[file] = violations;
    }
    expect(report).toEqual({});
  });
});

describe("static rule checker self-tests", () => {
  const cases: Array<[string, string, string]> = [
    ["Math.random", "const x = Math.random();", "forbidden: Math.random"],
    ["Date.now", "const t = Date.now();", "forbidden: Date.now"],
    ["performance.now", "const t = performance.now();", "forbidden: performance.now"],
    ["new Date", "const d = new Date();", "forbidden: new Date"],
    ["setTimeout", "setTimeout(() => {}, 1);", "forbidden: setTimeout"],
    ["setInterval", "setInterval(() => {}, 1);", "forbidden: setInterval"],
    ["fetch", 'await fetch("http://x");', "forbidden: fetch"],
    ["node:http", 'import http from "node:http";', "disallowed import: node:http"],
    ["node:net", 'import { connect } from "node:net";', "disallowed import: node:net"],
    ["node:https", 'import https from "node:https";', "disallowed import: node:https"],
    [
      "skeleton internal path",
      // Built at runtime so the repo-wide "no skeleton path imports" scan doesn't flag this fixture.
      `import { x } from "${["@planchette", "skeleton", "src/engine/dwell.js"].join("/")}";`,
      "disallowed import: @planchette/skeleton/src/engine/dwell.js",
    ],
    [
      "unlisted package via dynamic import",
      'const m = await import("left-pad");',
      "disallowed import: left-pad",
    ],
    ["any annotation", "const x: any = 1;", "forbidden: any type annotation"],
    ["as any", "const x = y as any;", "forbidden: any type annotation"],
    ["any array", "let xs: any[] = [];", "forbidden: any type annotation"],
  ];

  for (const [name, source, expected] of cases) {
    it(`reports ${name}`, () => {
      expect(checkSource(source)).toContain(expected);
    });
  }

  it("accepts the allowed imports and relative paths", () => {
    const source = [
      'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";',
      'import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";',
      'import { z } from "zod";',
      'import { createDwellEngine } from "@planchette/skeleton";',
      'import { a } from "./a.js";',
      'export { b } from "../b.js";',
    ].join("\n");
    expect(checkSource(source)).toEqual([]);
  });

  it("ignores forbidden names that appear only in comments", () => {
    const source = "// Date.now is banned\n/* Math.random too */\nexport const a = 1;";
    expect(checkSource(source)).toEqual([]);
  });
});
