import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, SERVER_NAME, SERVER_VERSION } from "../src/create-server.js";
import { CompareInput, ListUsersInput, SimulateInput } from "../src/tool-schemas.js";

const layout = {
  screen: { width: 800, height: 600 },
  targets: [
    { id: "menu", rect: { x: 40, y: 40, width: 120, height: 80 } },
    { id: "ok", rect: { x: 400, y: 40, width: 120, height: 80 } },
    { id: "rest", rect: { x: 400, y: 400, width: 120, height: 80 }, role: "rest-area" },
  ],
};

async function connectedClient(): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverSide);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientSide);
  return client;
}

const clients: Client[] = [];
async function open(): Promise<Client> {
  const client = await connectedClient();
  clients.push(client);
  return client;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

describe("dwell-sim-mcp server (in-memory transport)", () => {
  it("reports the package name and version", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(SERVER_NAME).toBe("dwell-sim-mcp");
    expect(SERVER_VERSION).toBe(pkg.version);
  });

  it("lists the three tools with input and output schemas", async () => {
    const client = await open();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["compare", "list_users", "simulate"]);
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(Object.keys(byName.get("simulate")?.inputSchema.properties ?? {}).sort()).toEqual(Object.keys(SimulateInput).sort());
    expect(Object.keys(byName.get("compare")?.inputSchema.properties ?? {}).sort()).toEqual(Object.keys(CompareInput).sort());
    expect(Object.keys(byName.get("list_users")?.inputSchema.properties ?? {})).toEqual(Object.keys(ListUsersInput));
    for (const tool of tools) expect(tool.outputSchema, tool.name).toBeDefined();
  });

  it("returns an isError result without output-schema validation", async () => {
    const client = await open();
    const result = await client.callTool({ name: "simulate", arguments: { layout, users: [], task: { eachTarget: 1 } } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "OUT_OF_RANGE", parameter: "users" });
  });

  it("returns structuredContent for a successful simulate that the client validates against the output schema", async () => {
    const client = await open();
    const result = await client.callTool({
      name: "simulate",
      arguments: { layout, users: ["steady"], task: { eachTarget: 1 }, trialsPerUser: 1 },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ seed: 1 });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0].text)).toEqual(result.structuredContent);
  });

  it("returns list_users output", async () => {
    const client = await open();
    const result = await client.callTool({ name: "list_users", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toHaveProperty("users");
  });

  it("writes nothing to stdout while handling calls", async () => {
    const write = vi.spyOn(process.stdout, "write");
    const client = await open();
    await client.callTool({ name: "list_users", arguments: {} });
    await client.callTool({ name: "simulate", arguments: { layout, users: [], task: { eachTarget: 1 } } });
    await client.callTool({
      name: "simulate",
      arguments: { layout, users: ["steady"], task: { eachTarget: 1 }, trialsPerUser: 1 },
    });
    expect(write).not.toHaveBeenCalled();
  });
});
