import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { powerDir, readJson, type McpJson, type PluginJson } from "./power-helpers.js";

const fixtures = new URL("./fixtures/agent-plugins/", import.meta.url);
const schema = (name: string): object => JSON.parse(readFileSync(new URL(name, fixtures), "utf8")) as object;
const plugin = readJson<PluginJson>(`${powerDir}/plugin.json`);
const mcp = readJson<McpJson>(`${powerDir}/mcp.json`);

describe("power-planchette/plugin.json", () => {
  it("validates against the Agent Plugins 1.0.0 plugin schema", () => {
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema("plugin.schema.json"));
    const ok = validate(plugin);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });
  it("rejects a manifest with an unknown field or an invalid name (the validator is live)", () => {
    const validate = new Ajv2020({ strict: true }).compile(schema("plugin.schema.json"));
    expect(validate({ ...plugin, mcpServers: {} })).toBe(false);
    expect(validate({ ...plugin, name: "Bad Name" })).toBe(false);
  });
  it("has the agreed identity fields", () => {
    expect(plugin.name).toBe("planchette");
    expect(plugin.version).toBe("0.1.0");
    expect(plugin.author).toEqual({ name: "4KInc" });
    expect(plugin.repository).toBe("https://github.com/4KInc/planchette-kit");
    expect(plugin.homepage).toBe("https://github.com/4KInc/planchette-kit");
    expect(plugin.license).toBe("MIT");
    expect(plugin.description.length).toBeGreaterThan(20);
  });
  it("has the specific keywords and not the broad ones", () => {
    const lower = plugin.keywords.map((k) => k.toLowerCase());
    for (const word of ["dwell", "dwell time", "head pointer", "switch scanning", "hands-free", "accidental selection", "planchette"]) {
      expect(lower).toContain(word);
    }
    for (const broad of ["accessibility", "assistive technology"]) expect(lower).not.toContain(broad);
  });
  it("makes no medical or eye-tracking claim", () => {
    const text = JSON.stringify(plugin).toLowerCase();
    expect(text).not.toMatch(/medical|therapy|eye[- ]track|gaze/);
  });
});

describe("power-planchette/mcp.json", () => {
  it("validates against the Agent Plugins 1.0.0 MCP schema", () => {
    const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema("mcp.schema.json"));
    const ok = validate(mcp);
    expect(validate.errors ?? []).toEqual([]);
    expect(ok).toBe(true);
  });
  it("targets the same Agent Plugins version as plugin.json (specification 10.1)", () => {
    const version = (url: string): string | undefined => /\/schemas\/([^/]+)\//.exec(url)?.[1];
    expect(version(mcp.$schema)).toBeDefined();
    expect(version(mcp.$schema)).toBe(version(plugin.$schema));
  });
  it("has one stdio server, dwell-sim, that runs the bundle with node", () => {
    expect(Object.keys(mcp.mcpServers)).toEqual(["dwell-sim"]);
    const server = mcp.mcpServers["dwell-sim"];
    expect(server?.type).toBe("stdio");
    expect(server?.command).toBe("node");
    expect(server?.args).toEqual(["${PLUGIN_ROOT}/dwell-sim-mcp.mjs"]);
  });
  it("follows the specification rules the schema cannot express", () => {
    const server = mcp.mcpServers["dwell-sim"];
    expect(server?.command).toMatch(/^[A-Za-z0-9._-]+$/); // one bare token, no path, no placeholder
    expect(server?.env).toBeUndefined(); // no secrets, nothing needed
  });
});
