/**
 * Tool handlers (design section 11). One code path for the MCP server and the demo run script:
 * validate the parsed input, call the core, return the tool result.
 *
 * Result shape (design section 11, "Result shape"):
 * - success: `structuredContent` plus one text item, the compact `JSON.stringify` of the same object;
 * - error: `{ isError: true, content: [{ type: 'text', text: JSON.stringify(err) }], structuredContent: err }`.
 *
 * Errors thrown by the core (H1, H3, H4, H5):
 * - `ADJACENT_REPEAT`, `UNSUPPORTED_MODE` and `LAYOUT_MISMATCH` are rebuilt with the design's message
 *   templates and paths. Validation catches all three first, so this path runs only if validation is bypassed.
 * - `NO_TRIALS` and every other exception become `INTERNAL_ERROR` (no `allowed`), and one line goes to stderr.
 *   The handlers never write to stdout.
 *
 * The SDK's `CallToolResult` is declared in `@modelcontextprotocol/sdk/types.js` (`types.d.ts`, 1.32.2) and is the
 * return type of `ToolCallback` in `server/mcp.d.ts`. `src/` may import only the `server/mcp.js` and `server/stdio.js`
 * subpaths (static rules), so the type is taken from `ToolCallback`.
 */
import type { ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { compare } from "./compare.js";
import { listUsers } from "./list-users.js";
import { SimulateError, simulate } from "./simulate.js";
import type { CompareToolInput, SimulateToolInput } from "./tool-schemas.js";
import {
  SUPPORTED_MODES,
  validateCompareRequest,
  validateSimulateRequest,
  type ValidationError,
} from "./validate-request.js";

/** The SDK's `CallToolResult` (return type of a tool callback). */
export type CallToolResult = Awaited<ReturnType<ToolCallback>>;

/** An error object as returned to the client. `allowed` is absent for `INTERNAL_ERROR`. */
export type ToolError = ValidationError | { code: "INTERNAL_ERROR"; parameter: ""; message: string };

function success(value: object): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function failure(err: ToolError): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(err) }],
    structuredContent: err as unknown as Record<string, unknown>,
  };
}

function stackOf(thrown: unknown): string {
  if (thrown instanceof Error) return thrown.stack ?? thrown.message;
  return String(thrown);
}

function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

/** H1 and H5. `seed` is undefined for `list_users`. */
function internalError(thrown: unknown, seed: number | undefined): CallToolResult {
  const seedPart = seed === undefined ? "" : ` (seed ${String(seed)})`;
  console.error(`dwell-sim-mcp: INTERNAL_ERROR${seedPart}: ${stackOf(thrown)}`);
  return failure({ code: "INTERNAL_ERROR", parameter: "", message: `The simulation failed: ${messageOf(thrown).replace(/\.$/, "")}.` });
}

/** H4. Returns null when the thrown value is not one of the three rebuildable core errors. */
function rebuildCoreError(thrown: unknown, mode: string, task: SimulateToolInput["task"]): ValidationError | null {
  if (!(thrown instanceof SimulateError)) return null;
  if (thrown.code === "ADJACENT_REPEAT") {
    const taskError = thrown.taskError;
    if (!taskError) return null;
    const { index, targetId } = taskError;
    return {
      code: "ADJACENT_REPEAT",
      parameter: Array.isArray(task) ? `task[${index}]` : "task.eachTarget",
      message: `Task entry ${index} repeats target "${targetId}" directly after entry ${index - 1}, and the target has no autoRepeat. Entries are numbered from zero.`,
    };
  }
  if (thrown.code === "UNSUPPORTED_MODE") {
    return {
      code: "UNSUPPORTED_MODE",
      parameter: "mode",
      message: `Input mode "${mode}" is not supported. Supported modes: ${SUPPORTED_MODES.join(", ")}.`,
      allowed: [...SUPPORTED_MODES],
    };
  }
  if (thrown.code === "LAYOUT_MISMATCH") {
    // The core message is already the design's template: "The two layouts must have the same target ids; differing: {ids}."
    return { code: "LAYOUT_MISMATCH", parameter: "b.layout", message: thrown.message };
  }
  return null;
}

export function handleListUsers(): CallToolResult {
  try {
    return success(listUsers());
  } catch (thrown) {
    return internalError(thrown, undefined);
  }
}

export function handleSimulate(input: SimulateToolInput): CallToolResult {
  try {
    const validated = validateSimulateRequest(input);
    if (!validated.ok) return failure(validated.error);
    return success(simulate(validated.request));
  } catch (thrown) {
    const rebuilt = rebuildCoreError(thrown, input.mode, input.task);
    if (rebuilt) return failure(rebuilt);
    return internalError(thrown, input.seed);
  }
}

export function handleCompare(input: CompareToolInput): CallToolResult {
  try {
    const validated = validateCompareRequest(input);
    if (!validated.ok) return failure(validated.error);
    return success(compare(validated.request));
  } catch (thrown) {
    const rebuilt = rebuildCoreError(thrown, input.mode, input.task);
    if (rebuilt) return failure(rebuilt);
    return internalError(thrown, input.seed);
  }
}
