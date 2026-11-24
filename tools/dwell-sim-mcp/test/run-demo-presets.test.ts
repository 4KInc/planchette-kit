import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEMO_PRESETS,
  journalAppendText,
  runDemoPresets,
  type DemoHandler,
  type DemoLayout,
} from "../scripts/run-demo-presets.js";

const layouts: DemoLayout[] = [
  { name: "1920x1080", layout: { screen: { width: 1920, height: 1080 }, targets: [] } },
  { name: "1366x768", layout: { screen: { width: 1366, height: 768 }, targets: [] } },
];

function stubResult(width: number) {
  return {
    structuredContent: {
      users: [
        {
          intended: 27,
          accidental: 3,
          startCount: 1,
          startOfSession: { count: 1 },
          accidentalPer100Intended: 11.1,
          misses: 2,
          missCauses: { unreachable: 0, "aim-outside-target": 2, "tremor-at-edge": 0, other: 0 },
          timeToSelectMs: { median: 1200 + width, p90: 2400 },
          causes: { "reading-pause": 2, "pass-over": 1, other: 0 },
        },
      ],
      suggestions: [{ text: "Make the target bigger." }],
      warnings: [],
    },
  };
}

function run(handler?: DemoHandler) {
  const calls: Array<Record<string, unknown>> = [];
  const h: DemoHandler =
    handler ??
    ((input) => {
      calls.push(input);
      const layout = input.layout as { screen: { width: number } };
      return stubResult(layout.screen.width);
    });
  const wrapped: DemoHandler = (input) => {
    if (handler) calls.push(input);
    return h(input);
  };
  return { entries: runDemoPresets({ layouts, handler: wrapped, date: "23 Nov 2026" }), calls };
}

describe("runDemoPresets", () => {
  it("returns six entries and names each preset exactly once", () => {
    const { entries } = run();
    expect(entries).toHaveLength(6);
    for (const preset of DEMO_PRESETS) {
      const named = entries.filter((e) => e.includes(`demo run: ${preset}.`));
      expect(named).toHaveLength(1);
    }
  });

  it("calls the handler with exactly the six preset names, twice each (once per layout)", () => {
    const { calls } = run();
    expect(calls).toHaveLength(12);
    const names = calls.map((c) => (c.users as string[]).join(","));
    expect([...new Set(names)].sort()).toEqual([...DEMO_PRESETS].sort());
    for (const preset of DEMO_PRESETS) expect(names.filter((n) => n === preset)).toHaveLength(2);
    for (const c of calls) {
      expect(c.task).toEqual({ eachTarget: 3 });
      expect(c.seed).toBe(1);
    }
  });

  it("has every tech.md field, the metrics, and the 1366x768 line inside the same entry", () => {
    const { entries } = run();
    for (const e of entries) {
      expect(e).toMatch(/^23 Nov 2026: /);
      expect(e).toContain("What Kiro did:");
      expect(e).toContain("What went wrong or surprised us:");
      expect(e).toContain("What we changed:");
      expect(e).toContain("Links:");
      expect(e).toContain("intended 27, accidental 3 (per 100 intended: 11.1)");
      expect(e).toContain("start-of-session 1, misses 2 (miss causes: aim-outside-target 2)");
      expect(e).toContain("median 3120 ms and p90 2400 ms");
      expect(e).toContain("top causes: reading-pause 2, pass-over 1");
      expect(e).toContain("suggestions: Make the target bigger.");
      expect(e).toContain("fps 30");
      expect(e).toContain("analysis window 10 s");
      expect(e).toContain("10 trials");
      expect(e).toContain("Result (1920x1080)");
      expect(e).toContain("Second line (1366x768)");
      expect(e).not.toContain("\n");
    }
  });

  it("reports an isError result in the entry instead of throwing", () => {
    const handler: DemoHandler = () => ({
      isError: true,
      structuredContent: { code: "OUT_OF_RANGE", parameter: "seed", message: "Seed is out of range." },
    });
    const { entries } = run(handler);
    expect(entries).toHaveLength(6);
    expect(entries[0]).toContain("ERROR OUT_OF_RANGE: Seed is out of range.");
    expect(entries[0]).toContain("returned an error result (OUT_OF_RANGE)");
  });
});

describe("missCauses absent", () => {
  it("omits the miss causes text when the result has no missCauses", () => {
    const handler: DemoHandler = () => {
      const r = stubResult(1);
      delete (r.structuredContent.users[0] as { missCauses?: unknown }).missCauses;
      return r;
    };
    const { entries } = run(handler);
    expect(entries[0]).toContain("misses 2, time-to-select");
    expect(entries[0]).not.toContain("miss causes");
  });
});

describe("local journal date", () => {
  // Child `node` processes with TZ set: the zone is fixed before any Date exists, so this is reliable in vitest.
  const instant = "2025-03-10T03:30:00Z";
  const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
  const compiled = join(packageDir, "dist-scripts", "run-demo-presets.js");
  const available = existsSync(compiled);
  if (!available) {
    process.stderr.write(`skipping local journal date tests: ${compiled} is missing (run the build first)\n`);
  }
  function inZone(tz: string): string {
    const script =
      'const m = await import(process.argv[1]); const d = new Date(process.argv[2]); console.log(m.formatLocalDate(d) + "|" + m.journalDate(d));';
    return execFileSync(
      process.execPath,
      ["--input-type=module", "-e", script, pathToFileURL(compiled).href, instant],
      { env: { ...process.env, TZ: tz }, cwd: packageDir, encoding: "utf8" },
    ).trim();
  }
  it.skipIf(!available)("uses the local day in America/Los_Angeles (behind UTC)", () => {
    expect(inZone("America/Los_Angeles")).toBe("2025-03-09|9 Mar 2025");
  });
  it.skipIf(!available)("uses the local day in Pacific/Auckland (ahead of UTC)", () => {
    expect(inZone("Pacific/Auckland")).toBe("2025-03-10|10 Mar 2025");
  });
});

describe("journalAppendText", () => {
  it("puts each entry on its own line with one trailing newline", () => {
    expect(journalAppendText(["a", "b"], "old\n")).toBe("a\nb\n");
    expect(journalAppendText(["a", "b"], "old")).toBe("\na\nb\n");
  });
});
