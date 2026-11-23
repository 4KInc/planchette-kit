/**
 * Builds the MCP server with the three tools registered (design section 11). It does not connect a transport,
 * so tests can attach the SDK's in-memory transport. `server.ts` is the stdio entry.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { handleCompare, handleListUsers, handleSimulate } from "./tool-handlers.js";
import {
  CompareInput,
  CompareOutput,
  ListUsersInput,
  ListUsersOutput,
  SimulateInput,
  SimulateOutput,
} from "./tool-schemas.js";

/** Same as `version` in package.json (a test checks this). */
export const SERVER_NAME = "dwell-sim-mcp";
export const SERVER_VERSION = "0.0.0";

export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "list_users",
    {
      description:
        "List the simulated user presets, their parameters with sources, the ranges allowed for custom users, and the disclaimer.",
      inputSchema: ListUsersInput,
      outputSchema: ListUsersOutput,
    },
    () => handleListUsers(),
  );

  server.registerTool(
    "simulate",
    {
      description:
        "Simulate head-pointing users with dwell selection on a layout and report accidental selections, misses, time to select and suggestions.",
      inputSchema: SimulateInput,
      outputSchema: SimulateOutput,
    },
    (input) => handleSimulate(input),
  );

  server.registerTool(
    "compare",
    {
      description:
        "Run the same simulated users on two configurations (layout and profile) with paired trials and report the differences.",
      inputSchema: CompareInput,
      outputSchema: CompareOutput,
    },
    (input) => handleCompare(input),
  );

  return server;
}
