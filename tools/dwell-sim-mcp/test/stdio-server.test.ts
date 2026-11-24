import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CompareOutputSchema, ListUsersOutputSchema, SimulateOutputSchema } from "../src/tool-schemas.js";

const serverJs = fileURLToPath(new URL("../dist/server.js", import.meta.url));
const preload = fileURLToPath(new URL("./support/no-network-preload.mjs", import.meta.url));
const built = existsSync(serverJs);
if (!built) process.stderr.write(`stdio-server.test: ${serverJs} is missing; run npm run build:sim. Test skipped.\n`);

/** Spawns the server itself so the raw stdout bytes can be kept for inspection. */
class CapturingTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  readonly stdoutChunks: Buffer[] = [];
  private child?: ChildProcessWithoutNullStreams;
  private readonly buffer = new ReadBuffer();

  constructor(private readonly env: Record<string, string>) {}

  async start(): Promise<void> {
    const child = spawn(process.execPath, [serverJs], { env: { ...process.env, ...this.env }, stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    child.stdout.on("data", (chunk: Buffer) => {
      this.stdoutChunks.push(chunk);
      this.buffer.append(chunk);
      try {
        for (let m = this.buffer.readMessage(); m; m = this.buffer.readMessage()) this.onmessage?.(m);
      } catch (e) {
        this.onerror?.(e as Error);
      }
    });
    child.stderr.on("data", () => undefined);
    child.on("close", () => this.onclose?.());
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve());
      child.once("error", reject);
    });
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve) => {
      if (this.child?.stdin.write(serializeMessage(message))) resolve();
      else this.child?.stdin.once("drain", () => resolve());
    });
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child) return;
    const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 2000);
    await closed;
    clearTimeout(timer);
  }
}

const layout = {
  screen: { width: 800, height: 600 },
  targets: [
    { id: "menu", rect: { x: 40, y: 40, width: 160, height: 100 } },
    { id: "ok", rect: { x: 600, y: 60, width: 160, height: 100 } },
    { id: "save", rect: { x: 340, y: 440, width: 160, height: 100 } },
    { id: "cancel", rect: { x: 40, y: 460, width: 140, height: 90 }, role: "cancel" },
    { id: "rest", rect: { x: 330, y: 250, width: 140, height: 100 }, role: "rest-area" },
  ],
};

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

  describe.skipIf(!built)("tool calls", () => {
    let dir: string;
    let netLog: string;
    let transport: CapturingTransport;
    let client: Client;

    beforeAll(async () => {
      dir = mkdtempSync(join(tmpdir(), "dwell-sim-stdio-"));
      netLog = join(dir, "net.log");
      transport = new CapturingTransport({
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${new URL(`file://${preload}`).href}`.trim(),
        DWELL_SIM_NET_LOG: netLog,
      });
      client = new Client({ name: "test-client", version: "0.0.0" });
      await client.connect(transport);
    }, 30000);

    afterAll(async () => {
      await client?.close();
      rmSync(dir, { recursive: true, force: true });
    });

    type ToolResult = { content?: unknown; structuredContent?: unknown; isError?: boolean };
    const call = async (name: string, args: Record<string, unknown>): Promise<ToolResult> =>
      (await client.callTool({ name, arguments: args })) as ToolResult;
    const textOf = (r: ToolResult): string => {
      const items = r.content as { type: string; text: string }[];
      expect(items).toHaveLength(1);
      expect(items[0].type).toBe("text");
      return items[0].text;
    };

    it("list_users returns a result that matches its output schema", async () => {
      const r = await call("list_users", {});
      expect(r.isError).toBeFalsy();
      ListUsersOutputSchema.parse(r.structuredContent);
      expect(textOf(r)).toBe(JSON.stringify(r.structuredContent));
    }, 30000);

    it("simulate returns a result that matches its output schema", async () => {
      const r = await call("simulate", {
        layout,
        users: ["steady"],
        task: ["menu", "ok", "cancel", "save"],
        trialsPerUser: 1,
        seed: 7,
      });
      expect(r.isError).toBeFalsy();
      SimulateOutputSchema.parse(r.structuredContent);
      expect(textOf(r)).toBe(JSON.stringify(r.structuredContent));
    }, 60000);

    it("compare with two dwell times returns a result that matches its output schema", async () => {
      const r = await call("compare", {
        a: { layout, profile: { dwellTime: 600 }, label: "600 ms" },
        b: { profile: { dwellTime: 1200 }, label: "1200 ms" },
        users: ["steady"],
        task: ["menu", "ok", "save"],
        trialsPerUser: 1,
        seed: 7,
      });
      expect(r.isError).toBeFalsy();
      CompareOutputSchema.parse(r.structuredContent);
      expect(textOf(r)).toBe(JSON.stringify(r.structuredContent));
    }, 60000);

    it("simulate with 13 users returns a CAP_EXCEEDED error result", async () => {
      const r = await call("simulate", {
        layout,
        users: Array.from({ length: 13 }, () => "steady"),
        task: ["menu", "ok"],
        trialsPerUser: 1,
      });
      expect(r.isError).toBe(true);
      const sc = r.structuredContent as { code: string; parameter: string; allowed: unknown };
      expect(sc.code).toBe("CAP_EXCEEDED");
      expect(sc.parameter).toBe("users");
      expect(sc.allowed).toEqual({ min: 1, max: 12 });
      expect(textOf(r)).toBe(JSON.stringify(r.structuredContent));
    }, 30000);

    it("writes only JSON-RPC 2.0 messages to stdout", () => {
      const text = Buffer.concat(transport.stdoutChunks).toString("utf8");
      const lines = text.split("\n").filter((l) => l.length > 0);
      expect(lines.length).toBeGreaterThanOrEqual(5);
      for (const line of lines) {
        const msg = JSON.parse(line) as Record<string, unknown>;
        expect(msg.jsonrpc).toBe("2.0");
        expect("method" in msg || "result" in msg || "error" in msg).toBe(true);
      }
    });

    it("opens no network connection or listener (preload trap never fired)", () => {
      // The child ran with a preload that records and throws on net/dgram connect, listen and send.
      expect(existsSync(netLog) ? readFileSync(netLog, "utf8") : "").toBe("");
    });
  });
});
