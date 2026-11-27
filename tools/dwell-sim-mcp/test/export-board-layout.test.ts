import { describe, expect, it } from "vitest";
import { boardLayoutFileName, summariseTargetIds, toBoardLayoutJson } from "../scripts/export-board-layout.js";
import { SimulateInputSchema } from "../src/tool-schemas.js";
import { validateSimulateRequest } from "../src/validate-request.js";

const targets = [
  { id: "core-i", rect: { x: 10, y: 20, width: 100, height: 139, extra: 1 }, autoRepeat: false, role: "default", other: 1 },
  { id: "backspace-action", rect: { x: 300, y: 20, width: 100, height: 96 }, autoRepeat: true, role: "default" },
  { id: "rest-area", rect: { x: 600, y: 300, width: 80, height: 80 }, autoRepeat: false, role: "rest-area" },
];

describe("toBoardLayoutJson", () => {
  const out = toBoardLayoutJson({ width: 1920, height: 1080 }, targets);

  it("has screen and targets with id, rect, autoRepeat and role only", () => {
    expect(out.screen).toEqual({ width: 1920, height: 1080 });
    expect(out.targets).toHaveLength(3);
    for (const t of out.targets) expect(Object.keys(t).sort()).toEqual(["autoRepeat", "id", "rect", "role"]);
    expect(out.targets[0].rect).toEqual({ x: 10, y: 20, width: 100, height: 139 });
    expect(out.targets[2]).toMatchObject({ autoRepeat: false, role: "rest-area" });
  });

  it("survives a JSON round trip and passes the validate-request layout checks", () => {
    const layout = JSON.parse(JSON.stringify(out));
    const input = SimulateInputSchema.parse({ layout, users: ["steady"], task: { eachTarget: 2 } });
    expect(validateSimulateRequest(input).ok).toBe(true);
  });
});

describe("summariseTargetIds and boardLayoutFileName", () => {
  it("counts each id group and reports unknown ids under other", () => {
    const s = summariseTargetIds(["core-i", "core-you", "letter-e", "space", "prediction-slot-0", "speak", "undo", "cancel", "camera-toggle", "phrases-toggle", "rest-area", "mystery"]);
    expect(s).toMatchObject({ "core-*": 2, "letter-*": 1, "prediction-slot-*": 1, actions: 2, cancel: 1, "rest-area": 1, other: 1 });
  });

  it("names the four files", () => {
    expect(boardLayoutFileName("core", { width: 1920, height: 1080 })).toBe("board-layout-core-1920x1080.json");
    expect(boardLayoutFileName("spell", { width: 1366, height: 768 })).toBe("board-layout-spell-1366x768.json");
  });
});
