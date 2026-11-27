// Runs the six presets on the Board's four exported layouts at the Board's default profile (dwell time 2100 ms)
// and formats one docs/kiro-journal.md entry per preset. It reuses `runDemoPresets`; nothing is duplicated.
// Run with `npm run board:run --workspace=tools/dwell-sim-mcp` (builds first). `--append <file>` appends the
// entries to that file (for example `--append docs/kiro-journal.md`, relative to the working directory);
// without the flag the entries are only printed.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { journalAppendText, runDemoPresets, type DemoHandler, type DemoLayout } from "./run-demo-presets.js";

export const BOARD_LAYOUT_FILES = [
  "board-layout-core-1920x1080.json",
  "board-layout-core-1366x768.json",
  "board-layout-spell-1920x1080.json",
  "board-layout-spell-1366x768.json",
] as const;
export const BOARD_EACH_TARGET = 2;
/** The Board's default profile: dwell time 2100 ms (design.md "Design levers used", lever 1). */
export const BOARD_PROFILE: Record<string, unknown> = { dwellTime: 2100 };

export interface RunBoardOptions {
  layouts: readonly DemoLayout[];
  handler: DemoHandler;
  parse?: (raw: Record<string, unknown>) => Record<string, unknown>;
  date?: string;
}

/** One entry per preset; the handler is called once per preset per layout (24 calls for four layouts). */
export function runBoardPresets(options: RunBoardOptions): string[] {
  return runDemoPresets({
    ...options,
    eachTarget: BOARD_EACH_TARGET,
    profile: BOARD_PROFILE,
    wording: {
      runLabel: "dwell-sim-mcp Board run",
      layoutPhrase: "the Board layout",
      profileText: `Board default profile (dwellTime ${String(BOARD_PROFILE.dwellTime)} ms)`,
      linkFiles: BOARD_LAYOUT_FILES,
    },
  });
}

async function main(): Promise<void> {
  const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const handlersPath = "../dist/tool-handlers.js";
  const schemasPath = "../dist/tool-schemas.js";
  const handlers = (await import(handlersPath)) as { handleSimulate: DemoHandler };
  const schemas = (await import(schemasPath)) as { SimulateInputSchema: { parse: (raw: unknown) => Record<string, unknown> } };
  const layouts: DemoLayout[] = BOARD_LAYOUT_FILES.map((file) => ({
    name: /board-layout-(.+)\.json$/.exec(file)?.[1] ?? file,
    layout: JSON.parse(readFileSync(join(packageDir, file), "utf8")) as unknown,
  }));
  const entries = runBoardPresets({
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
