// Prints the generated sections of METHODOLOGY.md: the Figures table, the References, and the
// chosen-values table. Run with `npm run methodology:tables --workspace=tools/dwell-sim-mcp`.
//
// `generateMethodologyTables` is pure: it takes the data as arguments, so the test can call it
// with the real data from `src` without needing a build. Only the entry point (`main`) loads
// the built simulator modules from `../dist/*.js`, through a variable specifier so that the
// typecheck does not need `dist` to exist.

import { fileURLToPath } from "node:url";

export interface TableFigureRow {
  id: string;
  label: string;
  value: string;
  refs: readonly number[];
}

export interface TableReference {
  citation: string;
  url?: string;
}

export type TableParamSource =
  | { kind: "figure"; row: string; ref: number; note?: string }
  | { kind: "chosen"; reason: string };

export interface TablePreset {
  name: string;
  params: Readonly<Record<string, { source: TableParamSource }>>;
}

export interface MethodologyTablesInput {
  figures: Readonly<Record<string, TableFigureRow>>;
  references: Readonly<Record<number, TableReference>>;
  presets: Readonly<Record<string, TablePreset>>;
}

/** Makes a text safe inside one markdown table cell. */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function refLink(n: number, references: MethodologyTablesInput["references"]): string {
  const url = references[n]?.url;
  return url ? `[[${n}]](${url})` : `[${n}]`;
}

function presetList(names: readonly string[], all: number): string {
  return names.length === all ? "all presets" : names.join(", ");
}

/** Groups (parameter, text) pairs over the presets, keeping first-seen order. */
function group(
  presets: MethodologyTablesInput["presets"],
  pick: (source: TableParamSource) => string | undefined,
): { param: string; text: string; presets: string[] }[] {
  const groups = new Map<string, { param: string; text: string; presets: string[] }>();
  for (const preset of Object.values(presets)) {
    for (const [param, sourced] of Object.entries(preset.params)) {
      const text = pick(sourced.source);
      if (text === undefined) continue;
      const key = `${param}\u0000${text}`;
      const entry = groups.get(key) ?? { param, text, presets: [] };
      entry.presets.push(preset.name);
      groups.set(key, entry);
    }
  }
  return [...groups.values()];
}

export function generateMethodologyTables(input: MethodologyTablesInput): string {
  const { figures, references, presets } = input;
  const presetCount = Object.keys(presets).length;
  const out: string[] = [];

  out.push("### Figures", "");
  out.push("| Figure | Value | Reference |", "| --- | --- | --- |");
  for (const row of Object.values(figures)) {
    const refs = row.refs.length > 0 ? row.refs.map((n) => refLink(n, references)).join(" ") : "none";
    out.push(`| ${cell(row.label)} | ${cell(row.value)} | ${refs} |`);
  }

  out.push("", "### References", "");
  for (const n of Object.keys(references).map(Number).sort((a, b) => a - b)) {
    const ref = references[n];
    if (!ref) continue;
    out.push(`${n}. ${ref.citation}${ref.url ? ` <${ref.url}>` : ""}`);
  }

  out.push("", "### Chosen values", "");
  out.push("| Parameter | Reason | Presets |", "| --- | --- | --- |");
  for (const g of group(presets, (s) => (s.kind === "chosen" ? s.reason : undefined))) {
    out.push(`| ${cell(g.param)} | ${cell(g.text)} | ${cell(presetList(g.presets, presetCount))} |`);
  }

  out.push("", "### Figure-source notes", "");
  out.push("| Parameter | Note | Presets |", "| --- | --- | --- |");
  for (const g of group(presets, (s) => (s.kind === "figure" ? s.note : undefined))) {
    out.push(`| ${cell(g.param)} | ${cell(g.text)} | ${cell(presetList(g.presets, presetCount))} |`);
  }

  return out.join("\n") + "\n";
}

async function main(): Promise<void> {
  const figuresPath = "../dist/figures.js";
  const presetsPath = "../dist/presets.js";
  const figuresModule = (await import(figuresPath)) as {
    FIGURES: MethodologyTablesInput["figures"];
    REFERENCES: MethodologyTablesInput["references"];
  };
  const presetsModule = (await import(presetsPath)) as { PRESETS: MethodologyTablesInput["presets"] };
  process.stdout.write(
    generateMethodologyTables({
      figures: figuresModule.FIGURES,
      references: figuresModule.REFERENCES,
      presets: presetsModule.PRESETS,
    }),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
