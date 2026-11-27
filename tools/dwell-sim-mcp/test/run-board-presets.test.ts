import { describe, expect, it } from "vitest";
import { BOARD_LAYOUT_FILES, runBoardPresets } from "../scripts/run-board-presets.js";
import { DEMO_PRESETS, type DemoHandler, type DemoLayout } from "../scripts/run-demo-presets.js";

const layouts: DemoLayout[] = BOARD_LAYOUT_FILES.map((f) => ({
  name: f.replace(/^board-layout-|\.json$/g, ""),
  layout: { screen: { width: 1366, height: 768 }, targets: [] },
}));

describe("runBoardPresets", () => {
  it("calls the handler 24 times with the documented task, seed and Board profile", () => {
    const calls: Array<Record<string, unknown>> = [];
    const handler: DemoHandler = (input) => {
      calls.push(input);
      return { structuredContent: { users: [{ intended: 10, accidental: 0 }] } };
    };
    const entries = runBoardPresets({ layouts, handler, date: "27 Nov 2026" });
    expect(entries).toHaveLength(6);
    expect(calls).toHaveLength(24);
    for (const c of calls) {
      expect(c.task).toEqual({ eachTarget: 2 });
      expect(c.seed).toBe(1);
      expect(c.profile).toEqual({ dwellTime: 2100 });
    }
    for (const preset of DEMO_PRESETS) {
      expect(calls.filter((c) => (c.users as string[])[0] === preset)).toHaveLength(4);
    }
    expect(entries[0]).toContain("dwell-sim-mcp Board run: steady.");
  });
});
