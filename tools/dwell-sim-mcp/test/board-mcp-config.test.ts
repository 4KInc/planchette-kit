import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface McpServerEntry {
  command?: string;
  args?: string[];
  disabled?: boolean;
}
interface McpConfig {
  mcpServers?: Record<string, McpServerEntry>;
}

const configUrl = new URL("../../../.kiro/settings/mcp.json", import.meta.url);

describe("workspace MCP configuration", () => {
  const config = JSON.parse(readFileSync(configUrl, "utf8")) as McpConfig;
  const entry = config.mcpServers?.["dwell-sim"];

  it("parses as JSON and has a dwell-sim entry", () => {
    expect(entry).toBeDefined();
  });

  it("runs the server with node", () => {
    expect(entry?.command).toBe("node");
  });

  it("uses a relative args path (no leading slash or drive letter)", () => {
    const args = entry?.args ?? [];
    expect(args).toContain("tools/dwell-sim-mcp/dist/server.js");
    for (const arg of args) {
      expect(arg.startsWith("/")).toBe(false);
      expect(/^[A-Za-z]:[\\/]/.test(arg)).toBe(false);
    }
  });
});
