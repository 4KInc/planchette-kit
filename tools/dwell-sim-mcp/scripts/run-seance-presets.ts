// Runs the six presets on Séance's four exported layouts at Séance's default dwell time (2100 ms), formats one
// docs/kiro-journal.md entry per preset, and applies the gate (Task 17): `reads-while-pointing` at or below 10
// accidental selections per 100 intended on every layout, for the worst of seeds 1 to 10.
// It reuses `runDemoPresets`; nothing is duplicated. Run with `npm run seance:run --workspace=tools/dwell-sim-mcp`
// (builds first). `--append <file>` appends the journal entries to that file; `--gate-doc <file>` writes the gate
// table (docs/seance-gate.md). Without the flags the output is only printed. The process exits 1 when the gate fails.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { journalAppendText, runDemoPresets, type DemoHandler, type DemoLayout } from "./run-demo-presets.js";
export const SEANCE_LAYOUT_FILES = [
  "seance-layout-play-1920x1080.json",
  "seance-layout-play-1366x768.json",
  "seance-layout-summary-1920x1080.json",
  "seance-layout-summary-1366x768.json",
] as const;
export const SEANCE_EACH_TARGET = 2;
/** Séance's default profile: dwell time 2100 ms (the Board's default; the gate confirms it for this layout). */
export const SEANCE_PROFILE: Record<string, unknown> = { dwellTime: 2100 };
/** The gate: at most this many accidental selections per 100 intended, `reads-while-pointing`, worst of the seeds. */
export const GATE_MAX_PER_100 = 10;
export const GATE_SEEDS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export interface RunSeanceOptions {
  layouts: readonly DemoLayout[];
  handler: DemoHandler;
  parse?: (raw: Record<string, unknown>) => Record<string, unknown>;
  date?: string;
}
/** One entry per preset; the handler is called once per preset per layout (24 calls for four layouts). */
export function runSeancePresets(options: RunSeanceOptions): string[] {
  return runDemoPresets({
    ...options,
    eachTarget: SEANCE_EACH_TARGET,
    profile: SEANCE_PROFILE,
    wording: {
      runLabel: "dwell-sim-mcp Séance run",
      layoutPhrase: "the Séance layout",
      profileText: `Séance default profile (dwellTime ${String(SEANCE_PROFILE.dwellTime)} ms)`,
      linkFiles: SEANCE_LAYOUT_FILES,
    },
  });
}
export interface GateRow {
  layoutName: string;
  seed: number;
  per100: number;
  causes: string;
}
function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}
/** `reads-while-pointing` on every layout for each seed, at the default profile and task. */
export function readsWhilePointingBySeed(
  layouts: readonly DemoLayout[],
  handler: DemoHandler,
  parse: (raw: Record<string, unknown>) => Record<string, unknown> = (r) => r,
  seeds: readonly number[] = GATE_SEEDS,
): GateRow[] {
  const rows: GateRow[] = [];
  for (const { name, layout } of layouts) {
    for (const seed of seeds) {
      const result = handler(parse({ layout, users: ["reads-while-pointing"], task: { eachTarget: SEANCE_EACH_TARGET }, seed, profile: SEANCE_PROFILE }));
      const sc = asRecord(result.structuredContent);
      const u = asRecord(Array.isArray(sc.users) ? sc.users[0] : undefined);
      const value = u.accidentalPer100Intended;
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`No accidentalPer100Intended for ${name}, seed ${String(seed)}`);
      const causes = Object.entries(asRecord(u.causes))
        .filter(([, n]) => typeof n === "number" && n > 0)
        .sort((a, b) => (b[1] as number) - (a[1] as number))
        .map(([k, n]) => `${k} ${String(n)}`)
        .join(", ");
      rows.push({ layoutName: name, seed, per100: value, causes });
    }
  }
  return rows;
}
export interface GateVerdict {
  pass: boolean;
  worst: GateRow;
  /** Rows above the limit. */
  failures: GateRow[];
  /** The worst value of each layout. */
  perLayoutWorst: Array<{ layoutName: string; worst: number; seed: number }>;
}
export function gateVerdict(rows: readonly GateRow[], limit: number = GATE_MAX_PER_100): GateVerdict {
  if (rows.length === 0) throw new Error("No gate rows.");
  const worst = rows.reduce((a, b) => (b.per100 > a.per100 ? b : a));
  const names = [...new Set(rows.map((r) => r.layoutName))];
  return {
    pass: rows.every((r) => r.per100 <= limit),
    worst,
    failures: rows.filter((r) => r.per100 > limit),
    perLayoutWorst: names.map((n) => {
      const w = rows.filter((r) => r.layoutName === n).reduce((a, b) => (b.per100 > a.per100 ? b : a));
      return { layoutName: n, worst: w.per100, seed: w.seed };
    }),
  };
}
/** The text of docs/seance-gate.md: the rule, the table of every seed on every layout, and the verdict. */
export function gateDocument(rows: readonly GateRow[], date: string): string {
  const verdict = gateVerdict(rows);
  const names = [...new Set(rows.map((r) => r.layoutName))];
  const seeds = [...new Set(rows.map((r) => r.seed))].sort((a, b) => a - b);
  const cell = (name: string, seed: number): string => String(rows.find((r) => r.layoutName === name && r.seed === seed)?.per100 ?? "");
  const lines = [
    "# Séance gate: the default dwell time",
    `${date}. Séance's default dwell time is 2100 ms, the Board's default. This file records whether the Séance layout passes the same gate at that dwell time.`,
    "The simulator models head pointing with published group averages, not real people. It does not model every user or every habit. See [tools/dwell-sim-mcp/METHODOLOGY.md](../tools/dwell-sim-mcp/METHODOLOGY.md).",
    `All numbers are accidental selections per 100 intended selections, from \`dwell-sim-mcp\`, preset \`reads-while-pointing\`, task \`{ eachTarget: ${String(SEANCE_EACH_TARGET)} }\`, 30 fps, 10 trials, dwell time ${String(SEANCE_PROFILE.dwellTime)} ms, on Séance's four layouts (the playing view and the Summary, at 1920x1080 and 1366x768).`,
    "## The gate rule",
    `\`reads-while-pointing\` makes at most ${String(GATE_MAX_PER_100)} accidental selections per 100 intended on every layout, for the worst of seeds ${String(seeds[0])} to ${String(seeds[seeds.length - 1])}. This is the rule the Board's default was chosen by. If it is missed, the work stops and the numbers are reported; the default dwell time, the layout and the limit are not changed without the user's approval.`,
    "## Seeds",
    `| Seed | ${names.join(" | ")} |`,
    `| --- | ${names.map(() => "---").join(" | ")} |`,
    ...seeds.map((s) => `| ${String(s)} | ${names.map((n) => cell(n, s)).join(" | ")} |`),
    `| **Worst** | ${verdict.perLayoutWorst.map((w) => `**${String(w.worst)}** (seed ${String(w.seed)})`).join(" | ")} |`,
    "## Verdict",
    verdict.pass
      ? `**Pass.** The worst value is ${String(verdict.worst.per100)} (${verdict.worst.layoutName}, seed ${String(verdict.worst.seed)}), at or below ${String(GATE_MAX_PER_100)}.`
      : `**Miss.** ${String(verdict.failures.length)} of ${String(rows.length)} runs are above ${String(GATE_MAX_PER_100)}; the worst is ${String(verdict.worst.per100)} (${verdict.worst.layoutName}, seed ${String(verdict.worst.seed)}; causes: ${verdict.worst.causes}).`,
  ];
  return lines.join("\n") + "\n";
}
async function main(): Promise<void> {
  const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const handlersPath = "../dist/tool-handlers.js";
  const schemasPath = "../dist/tool-schemas.js";
  const handlers = (await import(handlersPath)) as { handleSimulate: DemoHandler };
  const schemas = (await import(schemasPath)) as { SimulateInputSchema: { parse: (raw: unknown) => Record<string, unknown> } };
  const parse = (raw: Record<string, unknown>): Record<string, unknown> => schemas.SimulateInputSchema.parse(raw);
  const layouts: DemoLayout[] = SEANCE_LAYOUT_FILES.map((file) => ({
    name: /seance-layout-(.+)\.json$/.exec(file)?.[1] ?? file,
    layout: JSON.parse(readFileSync(join(packageDir, file), "utf8")) as unknown,
  }));
  const entries = runSeancePresets({ layouts, handler: handlers.handleSimulate, parse });
  process.stdout.write(entries.join("\n") + "\n");
  const rows = readsWhilePointingBySeed(layouts, handlers.handleSimulate, parse);
  const verdict = gateVerdict(rows);
  const names = verdict.perLayoutWorst.map((w) => `${w.layoutName} ${String(w.worst)} (seed ${String(w.seed)})`).join("; ");
  process.stdout.write(`GATE ${verdict.pass ? "PASS" : "MISS"}: reads-while-pointing worst of seeds 1 to 10 per layout: ${names}\n`);
  const append = process.argv.indexOf("--append");
  if (append !== -1) {
    const target = process.argv[append + 1];
    if (target === undefined) throw new Error("--append needs a file path");
    const path = resolve(process.cwd(), target);
    appendFileSync(path, journalAppendText(entries, existsSync(path) ? readFileSync(path, "utf8") : ""));
  }
  const doc = process.argv.indexOf("--gate-doc");
  if (doc !== -1) {
    const target = process.argv[doc + 1];
    if (target === undefined) throw new Error("--gate-doc needs a file path");
    const d = new Date();
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    writeFileSync(resolve(process.cwd(), target), gateDocument(rows, `${String(d.getDate())} ${months[d.getMonth()]!} ${String(d.getFullYear())}`));
  }
  if (!verdict.pass) process.exitCode = 1;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
