import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const distDir = fileURLToPath(new URL("../dist", import.meta.url));
const serverJs = fileURLToPath(new URL("../dist/server.js", import.meta.url));
const built = existsSync(distDir) && existsSync(serverJs);
if (!built) process.stderr.write(`build-output.test: ${serverJs} is missing; run npm run build:sim. Tests skipped.\n`);

describe("dwell-sim-mcp build output", () => {
  it.skipIf(!built)("dist/server.js exists and starts with the shebang", () => {
    expect(readFileSync(serverJs, "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
  });
});
