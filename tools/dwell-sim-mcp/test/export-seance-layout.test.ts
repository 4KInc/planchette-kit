import { describe, expect, it } from "vitest";
import { seanceLayoutFileName, summariseSeanceTargetIds, toSeanceLayoutJson } from "../scripts/export-seance-layout.js";
import { SimulateInputSchema } from "../src/tool-schemas.js";
import { validateSimulateRequest } from "../src/validate-request.js";
const targets = [
  { id: "letter-a", rect: { x: 10, y: 20, width: 107, height: 148, extra: 1 }, autoRepeat: false, role: "default", other: 1 },
  { id: "yes", rect: { x: 300, y: 20, width: 354, height: 148 }, autoRepeat: false, role: "default" },
  { id: "rest-area", rect: { x: 600, y: 300, width: 148, height: 148 }, autoRepeat: false, role: "rest-area" },
  { id: "cancel", rect: { x: 800, y: 300, width: 148, height: 148 }, autoRepeat: false, role: "cancel" },
];
describe("toSeanceLayoutJson", () => {
  const out = toSeanceLayoutJson({ width: 1920, height: 1080 }, targets);
  it("has screen and targets with id, rect, autoRepeat and role only", () => {
    expect(out.screen).toEqual({ width: 1920, height: 1080 });
    expect(out.targets).toHaveLength(4);
    for (const t of out.targets) expect(Object.keys(t).sort()).toEqual(["autoRepeat", "id", "rect", "role"]);
    expect(out.targets[0].rect).toEqual({ x: 10, y: 20, width: 107, height: 148 });
    expect(out.targets[2]).toMatchObject({ autoRepeat: false, role: "rest-area" });
  });
  it("survives a JSON round trip and passes the validate-request layout checks", () => {
    const layout = JSON.parse(JSON.stringify(out));
    const input = SimulateInputSchema.parse({ layout, users: ["steady"], task: { eachTarget: 2 } });
    expect(validateSimulateRequest(input).ok).toBe(true);
  });
});
describe("summariseSeanceTargetIds and seanceLayoutFileName", () => {
  it("counts each id group and reports unknown ids under other", () => {
    const s = summariseSeanceTargetIds(["letter-a", "letter-b", "yes", "goodbye", "stop", "undo", "cancel", "camera-toggle", "sound-toggle", "rest-area", "next-round", "carry-dwell", "suggest-apply", "mystery"]);
    expect(s).toMatchObject({ "letter-*": 2, "yes/no/goodbye": 2, "suggest-*": 1, "stop/undo/cancel": 3, "next-round": 1, "carry-dwell": 1, other: 1 });
  });
  it("names the four files", () => {
    expect(seanceLayoutFileName("play", { width: 1920, height: 1080 })).toBe("seance-layout-play-1920x1080.json");
    expect(seanceLayoutFileName("summary", { width: 1366, height: 768 })).toBe("seance-layout-summary-1366x768.json");
  });
});
