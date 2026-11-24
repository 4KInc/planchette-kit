import { describe, expect, it } from "vitest";
import { toLayoutJson } from "../scripts/export-demo-layout.js";
import { SimulateInputSchema } from "../src/tool-schemas.js";
import { validateSimulateRequest } from "../src/validate-request.js";

const targets = [
  { id: "a", rect: { x: 10, y: 20, width: 100, height: 50, extra: 1 }, autoRepeat: false, role: "default", other: 1 },
  { id: "b", rect: { x: 300, y: 20, width: 100, height: 50 }, autoRepeat: true, role: "rest-area" },
  { id: "c", rect: { x: 600, y: 300, width: 80, height: 80 }, autoRepeat: false, role: "default" },
];

describe("toLayoutJson", () => {
  const out = toLayoutJson({ width: 1920, height: 1080 }, targets);

  it("has screen and targets with id, rect, autoRepeat and role only", () => {
    expect(out.screen).toEqual({ width: 1920, height: 1080 });
    expect(out.targets).toHaveLength(3);
    for (const t of out.targets) expect(Object.keys(t).sort()).toEqual(["autoRepeat", "id", "rect", "role"]);
    expect(out.targets[0].rect).toEqual({ x: 10, y: 20, width: 100, height: 50 });
    expect(out.targets[1]).toMatchObject({ autoRepeat: true, role: "rest-area" });
  });

  it("survives a JSON round trip and passes the validate-request layout checks", () => {
    const layout = JSON.parse(JSON.stringify(out));
    const input = SimulateInputSchema.parse({ layout, users: ["steady"], task: { eachTarget: 3 } });
    expect(validateSimulateRequest(input).ok).toBe(true);
  });
});
