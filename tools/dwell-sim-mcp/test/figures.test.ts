import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIGURES, REFERENCES } from "../src/figures.js";

const REQUIREMENTS = readFileSync(
  new URL("../../../.kiro/specs/dwell-sim-mcp/requirements.md", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");

interface TableRow {
  label: string;
  value: string;
  source: string;
}

function parseFiguresTable(): TableRow[] {
  const start = REQUIREMENTS.indexOf("## Figures (sources)");
  const end = REQUIREMENTS.indexOf("\n## ", start + 1);
  expect(start).toBeGreaterThanOrEqual(0);
  const rows: TableRow[] = [];
  for (const line of REQUIREMENTS.slice(start, end).split("\n")) {
    if (!line.startsWith("| ") || line.startsWith("| Figure |")) continue;
    const cells = line.replace(/^\| /, "").replace(/ \|$/, "").split(" | ");
    expect(cells, line).toHaveLength(3);
    rows.push({ label: cells[0] ?? "", value: cells[1] ?? "", source: cells[2] ?? "" });
  }
  return rows;
}

function parseReferences(): Map<number, string> {
  const start = REQUIREMENTS.indexOf("## References");
  const end = REQUIREMENTS.indexOf("\n## ", start + 1);
  const body = REQUIREMENTS.slice(start, end === -1 ? undefined : end).split("\n").slice(1);
  const entries = new Map<number, string>();
  let current: number | null = null;
  for (const line of body) {
    const head = /^(\d+)\. (.*)$/.exec(line);
    if (head) {
      current = Number(head[1]);
      entries.set(current, head[2] ?? "");
    } else if (current !== null && line.trim() !== "") {
      entries.set(current, `${entries.get(current)} ${line.trim()}`);
    }
  }
  return entries;
}

function refsOf(source: string): number[] {
  const found = new Set([...source.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  return [...found].sort((a, b) => a - b);
}

describe("FIGURES matches the Figures table in requirements.md", () => {
  const table = parseFiguresTable();
  const rows = Object.values(FIGURES);

  it("has the same number of rows, in the same order", () => {
    expect(table.length).toBeGreaterThan(0);
    expect(rows.map((r) => r.label)).toEqual(table.map((r) => r.label));
  });

  it("copies every value exactly", () => {
    expect(rows.map((r) => r.value)).toEqual(table.map((r) => r.value));
  });

  it("lists exactly the reference numbers cited in each row's source", () => {
    expect(rows.map((r) => [...r.refs])).toEqual(table.map((r) => refsOf(r.source)));
  });

  it("keys each row by its own id, and ids are unique", () => {
    for (const [key, row] of Object.entries(FIGURES)) expect(row.id).toBe(key);
    expect(new Set(rows.map((r) => r.label)).size).toBe(rows.length);
  });

  it("only cites references that exist", () => {
    for (const row of rows) for (const n of row.refs) expect(REFERENCES[n], `[${n}]`).toBeDefined();
  });
});

describe("REFERENCES matches the References list in requirements.md", () => {
  const listed = parseReferences();

  it("has the same numbers, with no extra or missing entry", () => {
    expect(listed.size).toBeGreaterThan(0);
    expect(Object.keys(REFERENCES).map(Number)).toEqual([...listed.keys()]);
  });

  it("has the same citation and link for each number", () => {
    for (const [n, text] of listed) {
      const url = /\s(https?:\/\/\S+)$/.exec(text)?.[1];
      const citation = url === undefined ? text : text.slice(0, text.length - url.length - 1);
      expect(REFERENCES[n]?.citation, `[${n}]`).toBe(citation);
      expect(REFERENCES[n]?.url, `[${n}]`).toBe(url);
    }
  });
});
