import { describe, expect, it } from "vitest";
import { GATE_MAX_PER_100, SEANCE_LAYOUT_FILES, gateDocument, gateVerdict, readsWhilePointingBySeed, runSeancePresets } from "../scripts/run-seance-presets.js";
import { DEMO_PRESETS, type DemoHandler, type DemoLayout } from "../scripts/run-demo-presets.js";
const layouts: DemoLayout[] = SEANCE_LAYOUT_FILES.map((f) => ({
  name: f.replace(/^seance-layout-|\.json$/g, ""),
  layout: { screen: { width: 1366, height: 768 }, targets: [] },
}));
describe("runSeancePresets", () => {
  it("calls the handler 24 times with the documented task, seed and Séance profile", () => {
    const calls: Array<Record<string, unknown>> = [];
    const handler: DemoHandler = (input) => {
      calls.push(input);
      return { structuredContent: { users: [{ intended: 10, accidental: 0 }] } };
    };
    const entries = runSeancePresets({ layouts, handler, date: "27 Nov 2026" });
    expect(entries).toHaveLength(6);
    expect(calls).toHaveLength(24);
    for (const c of calls) {
      expect(c.task).toEqual({ eachTarget: 2 });
      expect(c.seed).toBe(1);
      expect(c.profile).toEqual({ dwellTime: 2100 });
    }
    for (const preset of DEMO_PRESETS) expect(calls.filter((c) => (c.users as string[])[0] === preset)).toHaveLength(4);
    expect(entries[0]).toContain("dwell-sim-mcp Séance run: steady.");
  });
});
describe("the gate", () => {
  const handlerWith = (value: (seed: number) => number): DemoHandler => (input) => ({
    structuredContent: { users: [{ accidentalPer100Intended: value(input.seed as number), causes: { "reading-pause": 3, other: 0 } }] },
  });
  it("asks reads-while-pointing for seeds 1 to 10 on every layout at 2100 ms", () => {
    const calls: Array<Record<string, unknown>> = [];
    const rows = readsWhilePointingBySeed(layouts, (input) => {
      calls.push(input);
      return { structuredContent: { users: [{ accidentalPer100Intended: 1 }] } };
    });
    expect(rows).toHaveLength(40);
    expect(calls).toHaveLength(40);
    for (const c of calls) {
      expect(c.users).toEqual(["reads-while-pointing"]);
      expect(c.profile).toEqual({ dwellTime: 2100 });
      expect(c.task).toEqual({ eachTarget: 2 });
    }
    expect(new Set(calls.map((c) => c.seed))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  });
  it("passes at exactly the limit and misses just above it", () => {
    expect(gateVerdict(readsWhilePointingBySeed(layouts, handlerWith(() => GATE_MAX_PER_100))).pass).toBe(true);
    const miss = gateVerdict(readsWhilePointingBySeed(layouts, handlerWith((s) => (s === 7 ? 10.1 : 2))));
    expect(miss.pass).toBe(false);
    expect(miss.worst).toMatchObject({ seed: 7, per100: 10.1 });
    expect(miss.failures).toHaveLength(4);
  });
  it("throws when the run reports no figure", () => {
    expect(() => readsWhilePointingBySeed(layouts, () => ({ structuredContent: { users: [{}] } }))).toThrow(/accidentalPer100Intended/);
  });
  it("writes a document with the table, the worst row and the verdict", () => {
    const pass = gateDocument(readsWhilePointingBySeed(layouts, handlerWith((s) => s / 2)), "27 Nov 2026");
    expect(pass).toContain("| 10 |");
    expect(pass).toContain("**Pass.**");
    expect(pass).toContain("**5** (seed 10)");
    const miss = gateDocument(readsWhilePointingBySeed(layouts, handlerWith(() => 12.5)), "27 Nov 2026");
    expect(miss).toContain("**Miss.**");
    expect(miss).toContain("12.5");
  });
});
