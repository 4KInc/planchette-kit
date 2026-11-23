#!/usr/bin/env node
/**
 * Stdio entry (design section 11). Stdout carries the protocol, so `console.log` is redirected to stderr first.
 * The skeleton is loaded with a dynamic import so a missing build gives a clear message instead of a stack trace.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

console.log = console.error;

try {
  await import("@planchette/skeleton");
} catch {
  console.error("Build the skeleton first: npm run build --workspace=skeleton");
  process.exit(1);
}

const { createServer } = await import("./create-server.js");
await createServer().connect(new StdioServerTransport());
