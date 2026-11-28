import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Repository root, three levels above `tools/dwell-sim-mcp/test`. */
export const repoRoot = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/, "");
export const powerDir = `${repoRoot}/power-planchette`;
export const bundlePath = `${powerDir}/dwell-sim-mcp.mjs`;
export const workspaceServer = `${repoRoot}/tools/dwell-sim-mcp/dist/server.js`;

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export interface StdioEntry {
  type: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}
export interface McpJson {
  $schema: string;
  mcpServers: Record<string, StdioEntry>;
}
export interface PluginJson {
  $schema: string;
  name: string;
  version: string;
  description: string;
  author: { name: string; email?: string; url?: string };
  homepage: string;
  repository: string;
  license: string;
  keywords: string[];
}

/** Specification §9.2: one non-recursive replacement of every `${PLUGIN_ROOT}`. */
export function expandPluginRoot(value: string, root: string): string {
  return value.split("${PLUGIN_ROOT}").join(root);
}

/** The layout the simulator's own stdio test uses. */
export const smallLayout = {
  screen: { width: 800, height: 600 },
  targets: [
    { id: "menu", rect: { x: 40, y: 40, width: 160, height: 100 } },
    { id: "ok", rect: { x: 600, y: 60, width: 160, height: 100 } },
    { id: "save", rect: { x: 340, y: 440, width: 160, height: 100 } },
    { id: "cancel", rect: { x: 40, y: 460, width: 140, height: 90 }, role: "cancel" },
    { id: "rest", rect: { x: 330, y: 250, width: 140, height: 100 }, role: "rest-area" },
  ],
};
export const smallSimulate = {
  layout: smallLayout,
  users: ["steady", "reads-while-pointing"],
  task: { eachTarget: 2 },
  trialsPerUser: 3,
  seed: 4,
};
