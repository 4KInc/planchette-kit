// Runs the six presets on the exported demo layouts and formats one docs/kiro-journal.md entry per preset.
// Run with `npm run demo:run --workspace=tools/dwell-sim-mcp` (builds first). `--append <file>` appends the
// entries to that file (for example `--append docs/kiro-journal.md`, relative to the working directory);
// without the flag the entries are only printed.
//
// `formatPresetEntry` and `runDemoPresets` are pure apart from the injected handler, so the test can use a
// stub. Only `main` loads the built simulator (`../dist/tool-handlers.js`, `../dist/tool-schemas.js`) through
// variable specifiers, so the typecheck does not need `dist` to exist.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEMO_PRESETS = ["steady", "slow", "head-tremor", "strong-head-tremor", "small-range", "reads-while-pointing"] as const;
export const DEMO_LAYOUT_FILES = ["demo-layout-1920x1080.json", "demo-layout-1366x768.json"] as const;
export const DEMO_SEED = 1;
export const DEMO_EACH_TARGET = 3;

/** The part of a tool result that the formatter reads. */
export interface DemoToolResult {
  isError?: boolean;
  content?: ReadonlyArray<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
}
export type DemoHandler = (input: Record<string, unknown>) => DemoToolResult;

export interface DemoLayout {
  name: string; // for example "1920x1080"
  layout: unknown;
}
export interface DemoRun {
  layoutName: string;
  result: DemoToolResult;
}
export interface DemoSettings {
  seed: number;
  fps: number;
  analysisWindowS: number;
  trialsPerUser: number;
  eachTarget: number;
}
export interface PresetEntryInput {
  date: string;
  preset: string;
  settings: DemoSettings;
  runs: readonly DemoRun[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Journal date, for example `23 Nov 2026`. */
export function journalDate(d: Date): string {
  return `${String(d.getDate())} ${MONTHS[d.getMonth()] ?? ""} ${String(d.getFullYear())}`;
}

function num(v: unknown): string {
  return typeof v === "number" ? String(v) : "n/a";
}
function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

function topCauses(causes: Record<string, unknown>): string {
  const rows = Object.entries(causes)
    .filter((e): e is [string, number] => typeof e[1] === "number" && e[1] > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 3)
    .map(([name, n]) => `${name} ${String(n)}`);
  return rows.length > 0 ? rows.join(", ") : "none";
}

/** One layout's result as a sentence. An isError result is reported, not thrown. Also collects warnings. */
function describeRun(run: DemoRun, notes: string[]): string {
  const r = run.result;
  const sc = asRecord(r.structuredContent);
  if (r.isError === true) {
    const code = typeof sc.code === "string" ? sc.code : "ERROR";
    const message = typeof sc.message === "string" ? sc.message : (r.content?.[0]?.text ?? "no message");
    notes.push(`${run.layoutName} returned an error result (${code})`);
    return `ERROR ${code}: ${message}`;
  }
  const users = Array.isArray(sc.users) ? sc.users : [];
  const u = asRecord(users[0]);
  const tts = asRecord(u.timeToSelectMs);
  const start = asRecord(u.startOfSession);
  const suggestions = (Array.isArray(sc.suggestions) ? sc.suggestions : [])
    .map((s) => asRecord(s).text)
    .filter((t): t is string => typeof t === "string");
  for (const w of Array.isArray(sc.warnings) ? sc.warnings : []) {
    if (typeof w === "string") notes.push(`${run.layoutName} warning: ${w}`);
  }
  return (
    `intended ${num(u.intended)}, accidental ${num(u.accidental)} (per 100 intended: ${num(u.accidentalPer100Intended)}), ` +
    `start-of-session ${num(start.count ?? u.startCount)}, misses ${num(u.misses)}, ` +
    `time-to-select median ${num(tts.median)} ms and p90 ${num(tts.p90)} ms, ` +
    `top causes: ${topCauses(asRecord(u.causes))}, ` +
    `suggestions: ${suggestions.length > 0 ? suggestions.join(" ") : "none"}`
  );
}

/**
 * One journal entry for one preset, as one line in the tech.md format: date, what Kiro did, what went wrong or
 * surprised us, what we changed, links. The first layout is the main result; each further layout follows as
 * "Second line (<layout>): ..." inside the same entry.
 */
export function formatPresetEntry(input: PresetEntryInput): string {
  const { date, preset, settings, runs } = input;
  const notes: string[] = [];
  const parts = runs.map((run, i) => `${i === 0 ? "Result" : "Second line"} (${run.layoutName}): ${describeRun(run, notes)}.`);
  const names = runs.map((r) => r.layoutName).join(" and ");
  const did =
    `What Kiro did: ran simulate through handleSimulate on the demo layout ${names} for the preset ${preset}, ` +
    `default profile, task { eachTarget: ${String(settings.eachTarget)} }, seed ${String(settings.seed)}, fps ${String(settings.fps)}, ` +
    `analysis window ${String(settings.analysisWindowS)} s, ${String(settings.trialsPerUser)} trials.`;
  const surprised = `What went wrong or surprised us: ${notes.length > 0 ? notes.join("; ") : "nothing reported by the run itself (to be completed when the results are recorded)"}.`;
  const changed = "What we changed: nothing, measurement only.";
  const links =
    `Links: tools/dwell-sim-mcp/${DEMO_LAYOUT_FILES[0]}, tools/dwell-sim-mcp/${DEMO_LAYOUT_FILES[1]}, ` +
    "commit: the one that adds this entry.";
  return `${date}: dwell-sim-mcp demo run: ${preset}. ${did} ${parts.join(" ")} ${surprised} ${changed} ${links}`;
}

export interface RunDemoOptions {
  layouts: readonly DemoLayout[];
  handler: DemoHandler;
  /** Parses the raw request like the tool does (zod defaults). Identity when omitted. */
  parse?: (raw: Record<string, unknown>) => Record<string, unknown>;
  date?: string;
}

/** Calls the handler once per preset and layout (presets in the fixed order) and returns six entries. */
export function runDemoPresets(options: RunDemoOptions): string[] {
  const { layouts, handler } = options;
  const parse = options.parse ?? ((raw) => raw);
  const date = options.date ?? journalDate(new Date());
  const entries: string[] = [];
  for (const preset of DEMO_PRESETS) {
    const runs: DemoRun[] = [];
    let settings: DemoSettings | undefined;
    for (const { name, layout } of layouts) {
      const parsed = parse({ layout, users: [preset], task: { eachTarget: DEMO_EACH_TARGET }, seed: DEMO_SEED });
      settings ??= {
        seed: typeof parsed.seed === "number" ? parsed.seed : DEMO_SEED,
        fps: typeof parsed.fps === "number" ? parsed.fps : 30,
        analysisWindowS: typeof parsed.analysisWindowS === "number" ? parsed.analysisWindowS : 10,
        trialsPerUser: typeof parsed.trialsPerUser === "number" ? parsed.trialsPerUser : 10,
        eachTarget: DEMO_EACH_TARGET,
      };
      runs.push({ layoutName: name, result: handler(parsed) });
    }
    entries.push(
      formatPresetEntry({
        date,
        preset,
        settings: settings ?? { seed: DEMO_SEED, fps: 30, analysisWindowS: 10, trialsPerUser: 10, eachTarget: DEMO_EACH_TARGET },
        runs,
      }),
    );
  }
  return entries;
}

/** Text to append to the journal: one entry per line, one trailing newline overall. */
export function journalAppendText(entries: readonly string[], existing: string): string {
  const lead = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  return lead + entries.join("\n") + "\n";
}

async function main(): Promise<void> {
  const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const handlersPath = "../dist/tool-handlers.js";
  const schemasPath = "../dist/tool-schemas.js";
  const handlers = (await import(handlersPath)) as { handleSimulate: DemoHandler };
  const schemas = (await import(schemasPath)) as { SimulateInputSchema: { parse: (raw: unknown) => Record<string, unknown> } };
  const layouts: DemoLayout[] = DEMO_LAYOUT_FILES.map((file) => ({
    name: /demo-layout-(\d+x\d+)\.json$/.exec(file)?.[1] ?? file,
    layout: JSON.parse(readFileSync(join(packageDir, file), "utf8")) as unknown,
  }));
  const entries = runDemoPresets({
    layouts,
    handler: handlers.handleSimulate,
    parse: (raw) => schemas.SimulateInputSchema.parse(raw),
  });
  process.stdout.write(entries.join("\n") + "\n");
  const flag = process.argv.indexOf("--append");
  if (flag !== -1) {
    const target = process.argv[flag + 1];
    if (target === undefined) throw new Error("--append needs a file path");
    const path = resolve(process.cwd(), target);
    appendFileSync(path, journalAppendText(entries, existsSync(path) ? readFileSync(path, "utf8") : ""));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
