import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { powerDir, repoRoot } from "./power-helpers.js";

const run = promisify(execFile);
const sweep = `${powerDir}/skills/check-dwell-layout/scripts/sweep.mjs`;
const core1366 = `${repoRoot}/tools/dwell-sim-mcp/board-layout-core-1366x768.json`;
const boardGate = readFileSync(`${repoRoot}/docs/board-gate.md`, "utf8");

async function sweepRun(args: string[], cwd: string): Promise<{ stdout: string; code: number }> {
  try {
    const { stdout } = await run(process.execPath, [sweep, ...args], { cwd, maxBuffer: 20_000_000 });
    return { stdout, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; code?: number };
    return { stdout: err.stdout ?? "", code: err.code ?? 99 };
  }
}

describe("sweep.mjs reproduces the numbers recorded in docs/board-gate.md, through the bundle", () => {
  const elsewhere = mkdtempSync(join(tmpdir(), "sweep-"));

  it("seeds 1 to 10 at 2100 ms on core-1366: the recorded seeds, worst 4.9, PASS (run from another directory)", async () => {
    const { stdout, code } = await sweepRun(["--layout", core1366, "--dwell", "2100", "--presets", "reads-while-pointing"], elsewhere);
    const recorded = "2.4, 2.4, 4.2, 3.6, 3.9, 2.8, 4.9, 3.1, 4.5, 4.8";
    expect(boardGate.includes(`| 2100 | core-1366 | ${recorded} | 4.9 |`), "the numbers are in docs/board-gate.md").toBe(true);
    expect(stdout.includes(`| ${recorded} | 4.9 |`), stdout).toBe(true);
    expect(stdout).toContain("**PASS: at 2100 ms");
    expect(code).toBe(0);
  }, 120_000);

  it("seed 1, 1400 and 2100 ms: accidental rates and times to select match the recorded tables", async () => {
    const { stdout } = await sweepRun(["--layout", core1366, "--dwell", "1400,2100", "--seeds", "1", "--presets", "steady,slow,reads-while-pointing"], elsewhere);
    const [at1400, at2100] = stdout.split("### Dwell time 2100 ms") as [string, string];
    expect(at1400).toContain("| steady | 0.4 | 0.4 | 0.4 | 2533 / 3000 |");
    expect(at2100).toContain("| steady | 0.4 | 0.4 | 0.4 | 3233 / 3700 |");
    expect(at1400).toContain("| slow | 0.1 | 0.1 | 0.1 | 3967 / 4967 |");
    expect(at2100).toContain("| slow | 0.1 | 0.1 | 0.1 | 4667 / 5667 |");
    expect(at1400).toContain("| reads-while-pointing | 50.6 | 50.6 | 50.6 |");
    expect(at2100).toContain("| reads-while-pointing | 2.4 | 2.4 | 2.4 |");
    expect(at1400).toContain("**FAIL: at 1400 ms");
    for (const line of ["| steady | core-1366 | 2533 / 3000 | 3233 / 3700 |", "| slow | core-1366 | 3967 / 4967 | 4667 / 5667 |"]) {
      expect(boardGate.includes(line), `docs/board-gate.md has ${line}`).toBe(true);
    }
  }, 120_000);

  it("--find stops at the smallest dwell time that passes (multi-seed rule)", async () => {
    const { stdout, code } = await sweepRun(["--layout", core1366, "--find", "--dwell", "2200,1400,2100", "--presets", "reads-while-pointing", "--seeds", "1-3"], elsewhere);
    expect(stdout).toContain("**Chosen by the multi-seed rule: 2100 ms**");
    expect(stdout).not.toContain("### Dwell time 2200 ms");
    expect(code).toBe(0);
  }, 120_000);

  it("exits 2 with a clear message when the simulator file is missing", async () => {
    const { code } = await sweepRun(["--layout", core1366, "--server", join(elsewhere, "nope.mjs")], elsewhere);
    expect(code).toBe(2);
    rmSync(elsewhere, { recursive: true, force: true });
  });
});

const elsewhere2 = mkdtempSync(join(tmpdir(), "sweep2-"));
afterAll(() => rmSync(elsewhere2, { recursive: true, force: true }));

describe("export-targets.js", () => {
  // The file is one expression after its comment header: drop the comments so `return` sees the expression.
  const source = readFileSync(`${powerDir}/skills/check-dwell-layout/references/export-targets.js`, "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("//"))
    .join("\n");
  interface FakeEl {
    dataset: Record<string, string | undefined>;
    getBoundingClientRect(): { x: number; y: number; width: number; height: number };
  }
  const el = (id: string, x: number, y: number, w: number, h: number, role?: string): FakeEl => ({
    dataset: { planchetteTarget: id, ...(role ? { role } : {}) },
    getBoundingClientRect: () => ({ x, y, width: w, height: h }),
  });
  const evaluate = (elements: FakeEl[], screen = { w: 1366, h: 768 }, scroll = { w: 1366, h: 768 }): { layout: { screen: { width: number; height: number }; targets: { id: string; rect: object; role: string; autoRepeat: boolean }[] }; problems: string[] } => {
    const win = { innerWidth: screen.w, innerHeight: screen.h };
    const doc = { querySelectorAll: () => elements, documentElement: { scrollWidth: scroll.w, scrollHeight: scroll.h } };
    return new Function("window", "document", `return ${source.trim().replace(/;$/, "")}`)(win, doc);
  };

  it("returns the page's targets in the simulate layout shape", () => {
    const r = evaluate([el("a", 10, 10, 100, 100), el("cancel", 120, 10, 100, 100, "cancel"), el("rest", 300, 300, 200, 200, "rest-area")]);
    expect(r.layout.screen).toEqual({ width: 1366, height: 768 });
    expect(r.layout.targets).toEqual([
      { id: "a", rect: { x: 10, y: 10, width: 100, height: 100 }, autoRepeat: false, role: "default" },
      { id: "cancel", rect: { x: 120, y: 10, width: 100, height: 100 }, autoRepeat: false, role: "cancel" },
      { id: "rest", rect: { x: 300, y: 300, width: 200, height: 200 }, autoRepeat: false, role: "rest-area" },
    ]);
    expect(r.problems).toEqual([]);
  });

  it("reports a missing rest area and cancel, an outside target, a duplicate id, a hidden target and scrolling", () => {
    const r = evaluate([el("a", 1300, 10, 100, 100), el("a", 10, 10, 50, 50), el("hidden", 0, 0, 0, 0)], { w: 1366, h: 768 }, { w: 1366, h: 900 });
    const text = r.problems.join("\n");
    for (const part of ["No rest-area target", "No cancel target", '"a" is not fully inside', 'Duplicate target id "a"', 'Skipped "hidden"', "The page scrolls"]) {
      expect(text, part).toContain(part);
    }
  });

  it("produces a layout that the simulator accepts", async () => {
    const r = evaluate([el("a", 10, 10, 100, 100), el("cancel", 120, 10, 100, 100, "cancel"), el("rest", 300, 300, 200, 200, "rest-area")]);
    const file = join(elsewhere2, "layout.json");
    writeFileSync(file, JSON.stringify(r.layout));
    const { stdout, code } = await sweepRun(["--layout", file, "--dwell", "2100", "--seeds", "1", "--presets", "steady", "--gate-preset", "steady", "--trials", "2"], elsewhere2);
    expect(stdout).toContain("# Dwell sweep");
    expect(code).toBe(0);
  }, 60_000);
});
