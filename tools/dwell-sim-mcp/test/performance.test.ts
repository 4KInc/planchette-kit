import { describe, expect, it } from "vitest";
import { PRESET_NAMES } from "../src/presets.js";
import { simulate } from "../src/simulate.js";
import type { SimulateToolInput } from "../src/tool-schemas.js";
import { validateSimulateRequest } from "../src/validate-request.js";

// 3 x 3 grid on 900 x 600: the centre cell is the rest area, the other eight are selectable.
const CELL_W = 300;
const CELL_H = 200;
const cell = (col: number, row: number) => ({
  rect: { x: col * CELL_W + 70, y: row * CELL_H + 40, width: 160, height: 120 },
});
const ids = ["t0", "t1", "t2", "t3", "t5", "t6", "t7", "t8"];
const targets = Array.from({ length: 9 }, (_, i) => ({
  id: i === 4 ? "rest" : `t${i}`,
  ...cell(i % 3, Math.floor(i / 3)),
  ...(i === 4 ? { role: "rest-area" as const } : {}),
}));
// 20 entries, no target twice in a row (none has autoRepeat). Ids t0..t8 with t4 removed.
const task = Array.from({ length: 20 }, (_, i) => ids[(i * 3) % ids.length]);

const input: SimulateToolInput = {
  layout: { screen: { width: 900, height: 600 }, targets },
  profile: { dwellTime: 600 },
  mode: "head + dwell",
  users: [...PRESET_NAMES],
  task,
  trialsPerUser: 10,
  fps: 30,
  analysisWindowS: 5,
  seed: 1,
};

describe("performance (Requirement 7 AC 3)", () => {
  it("runs 6 presets x 10 trials x 20 entries at 30 fps in under 10 s", () => {
    const start = performance.now();
    const validated = validateSimulateRequest(input);
    if (!validated.ok) throw new Error(`request must validate: ${validated.error.message}`);
    const result = simulate(validated.request);
    const elapsed = performance.now() - start;
    console.log(`PERF_MS ${elapsed.toFixed(0)} (6 presets x 10 trials x 20 entries, 30 fps)`);
    expect(result.users).toHaveLength(6);
    expect(elapsed).toBeLessThan(10_000);
  });
});
