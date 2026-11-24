import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CompareOutputSchema, ListUsersOutputSchema, SimulateOutputSchema } from "../src/tool-schemas.js";

const readme = readFileSync(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8");
const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as {
  bin: Record<string, string>;
  private: boolean;
  engines: { node: string };
};

/** The JSON block that follows the `<!-- example: name -->` marker. */
function jsonAfter(marker: string): unknown {
  const at = readme.indexOf(`<!-- example: ${marker} -->`);
  expect(at, `marker ${marker}`).toBeGreaterThanOrEqual(0);
  const m = /```json\n([\s\S]*?)\n```/.exec(readme.slice(at));
  expect(m, `json block after ${marker}`).not.toBeNull();
  return JSON.parse(m![1]!);
}

/** The first JSON block under the "Configure Kiro" heading. */
function configBlock(): { mcpServers: Record<string, { command: string; args: string[] }> } {
  const at = readme.indexOf("## Configure Kiro");
  expect(at).toBeGreaterThanOrEqual(0);
  const m = /```json\n([\s\S]*?)\n```/.exec(readme.slice(at));
  expect(m).not.toBeNull();
  return JSON.parse(m![1]!);
}

describe("README configuration snippet", () => {
  it("launches node with the package bin path as the last argument", () => {
    const servers = Object.values(configBlock().mcpServers);
    expect(servers).toHaveLength(1);
    const server = servers[0]!;
    expect(server.command).toBe("node");
    const bin = pkg.bin["dwell-sim-mcp"]!;
    expect(bin).toBe("dist/server.js");
    expect(server.args.at(-1)!.endsWith(bin)).toBe(true);
    expect(server.args.at(-1)!.startsWith("/")).toBe(true);
  });
});

describe("README text", () => {
  it("names the skeleton build command, the start commands and the stdout warning", () => {
    expect(readme).toContain("npm run build --workspace=skeleton");
    expect(readme).toContain("npm run build:sim");
    expect(readme).toContain("node tools/dwell-sim-mcp/dist/server.js");
    expect(readme).toContain("npx dwell-sim-mcp");
    expect(readme).toContain("npm run sim --silent");
    expect(readme).toContain("stdout is the protocol channel");
    expect(readme).toContain("banner");
  });

  it("states the Node requirement, the private package, deferred scan mode and the disclaimer", () => {
    expect(pkg.engines.node).toBe(">=20");
    expect(pkg.private).toBe(true);
    expect(readme).toContain("Node.js 20 or later");
    expect(readme).toContain("not published");
    expect(readme).toContain("UNSUPPORTED_MODE");
    expect(readme).toContain("METHODOLOGY.md");
    expect(readme).toContain(
      "Simulated users are models from published group averages, not real people. Use these results to compare layouts and settings.",
    );
  });
});

describe("README examples", () => {
  it("parse as JSON and match the output schemas", () => {
    expect(ListUsersOutputSchema.safeParse(jsonAfter("list-users-output-excerpt")).success).toBe(true);
    const sim = SimulateOutputSchema.safeParse(jsonAfter("simulate-output"));
    expect(sim.success, sim.success ? "" : z.prettifyError(sim.error)).toBe(true);
    const cmp = CompareOutputSchema.safeParse(jsonAfter("compare-output"));
    expect(cmp.success, cmp.success ? "" : z.prettifyError(cmp.error)).toBe(true);
  });

  it("simulate example has missCauses with all four keys on a user row and a per-target row, and the README explains them", () => {
    const keys = ["aim-outside-target", "other", "tremor-at-edge", "unreachable"];
    const sim = jsonAfter("simulate-output") as {
      users: { missCauses: Record<string, number>; perTarget: { missCauses: Record<string, number> }[] }[];
    };
    const user = sim.users[0]!;
    expect(Object.keys(user.missCauses).sort()).toEqual(keys);
    expect(user.perTarget.length).toBeGreaterThan(0);
    for (const row of user.perTarget) expect(Object.keys(row.missCauses).sort()).toEqual(keys);
    for (const k of keys) expect(readme).toContain(`\`${k}\``);
    expect(readme).toContain("planned aim point lies outside the target's rectangle");
  });
  it("includes the request examples and an error with the documented shape", () => {
    expect(jsonAfter("simulate-input")).toHaveProperty("layout");
    expect(jsonAfter("compare-input")).toHaveProperty("a");
    const err = jsonAfter("error-output") as Record<string, unknown>;
    expect(Object.keys(err).sort()).toEqual(["allowed", "code", "message", "parameter"]);
    expect(err.code).toBe("UNSUPPORTED_MODE");
  });
});
