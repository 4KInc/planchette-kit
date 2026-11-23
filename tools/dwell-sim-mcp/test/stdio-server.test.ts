import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

const serverJs = fileURLToPath(new URL("../dist/server.js", import.meta.url));
const built = existsSync(serverJs);
if (!built) process.stderr.write(`stdio-server.test: ${serverJs} is missing; run npm run build:sim. Test skipped.\n`);

describe("built dwell-sim-mcp server over stdio", () => {
  it.skipIf(!built)("lists the three tools", async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [serverJs], stderr: "pipe" });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      process.stderr.write(`stdio-server.test listTools: ${JSON.stringify(names)}\n`);
      expect(names).toEqual(["compare", "list_users", "simulate"]);
    } finally {
      await client.close();
    }
  }, 30000);
});
