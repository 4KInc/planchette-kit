import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  bundlePath,
  expandPluginRoot,
  powerDir,
  readJson,
  smallSimulate,
  workspaceServer,
  type McpJson,
} from "./power-helpers.js";

const workspaceBuilt = existsSync(workspaceServer);
if (!workspaceBuilt) process.stderr.write(`power-bundle.test: ${workspaceServer} is missing; run npm run build:sim. Equality test skipped.\n`);

type ToolResult = { structuredContent?: unknown; isError?: boolean };

/** Starts a server with `node`, runs `fn` with a connected client, and always closes it. */
async function withClient<T>(args: string[], cwd: string, fn: (client: Client) => Promise<T>): Promise<T> {
  // process.execPath stands for the bare `node` of mcp.json: the same executable, without PATH lookup.
  const transport = new StdioClientTransport({ command: process.execPath, args, cwd, stderr: "pipe" });
  const client = new Client({ name: "power-test", version: "0.0.0" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

describe("the committed bundle", () => {
  let elsewhere: string;
  beforeAll(() => {
    elsewhere = mkdtempSync(join(tmpdir(), "power-bundle-"));
  });
  afterAll(() => rmSync(elsewhere, { recursive: true, force: true }));

  it("is one ES module file that needs no node_modules", () => {
    const text = readFileSync(bundlePath, "utf8");
    expect(text).not.toMatch(/^import .* from "(@planchette|@modelcontextprotocol|zod|ajv)/m);
    expect(text).not.toMatch(/require\("(@modelcontextprotocol|zod)/);
  });

  it("lists exactly list_users, simulate and compare, from a temporary working directory", async () => {
    const names = await withClient([bundlePath], elsewhere, async (c) => (await c.listTools()).tools.map((t) => t.name).sort());
    expect(names).toEqual(["compare", "list_users", "simulate"]);
  }, 30000);

  it.skipIf(!workspaceBuilt)("answers one simulate call identically to the workspace build", async () => {
    const call = (c: Client): Promise<ToolResult> => c.callTool({ name: "simulate", arguments: smallSimulate }) as Promise<ToolResult>;
    const fromBundle = await withClient([bundlePath], elsewhere, call);
    const fromWorkspace = await withClient([workspaceServer], elsewhere, call);
    expect(fromBundle.isError).toBeFalsy();
    expect(fromBundle.structuredContent).toBeDefined();
    expect(fromBundle.structuredContent).toEqual(fromWorkspace.structuredContent);
  }, 60000);

  it("starts the way mcp.json says, with ${PLUGIN_ROOT} expanded (specification form)", async () => {
    const entry = readJson<McpJson>(`${powerDir}/mcp.json`).mcpServers["dwell-sim"];
    const args = (entry?.args ?? []).map((a) => expandPluginRoot(a, powerDir));
    const names = await withClient(args, elsewhere, async (c) => (await c.listTools()).tools.map((t) => t.name).sort());
    expect(names).toEqual(["compare", "list_users", "simulate"]);
  }, 30000);

  it("starts with the fallback entry: ./dwell-sim-mcp.mjs, working directory = the plugin root", async () => {
    const names = await withClient(["./dwell-sim-mcp.mjs"], powerDir, async (c) => (await c.listTools()).tools.map((t) => t.name).sort());
    expect(names).toEqual(["compare", "list_users", "simulate"]);
  }, 30000);
});
