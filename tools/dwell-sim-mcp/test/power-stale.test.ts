import { readFileSync } from "node:fs";
import { version as installedEsbuild } from "esbuild";
import { describe, expect, it } from "vitest";
import { buildBundle } from "../scripts/bundle-power.js";
import { bundlePath, readJson, repoRoot } from "./power-helpers.js";

interface Pkg {
  devDependencies?: Record<string, string>;
}
const pinned = readJson<Pkg>(`${repoRoot}/tools/dwell-sim-mcp/package.json`).devDependencies?.["esbuild"];

describe("the committed bundle is current", () => {
  // This runs first on purpose: a different esbuild can print different output, so the
  // comparison below would say "stale" for a reason that rebuilding cannot fix.
  it("1. the installed esbuild is the pinned version", () => {
    expect(pinned, "tools/dwell-sim-mcp/package.json must pin esbuild to an exact version").toMatch(/^\d+\.\d+\.\d+$/);
    expect(
      installedEsbuild,
      `esbuild ${installedEsbuild} is installed but package.json pins ${pinned}. Run \`npm install\` (or fix the pin on purpose), then run the "Rebuild power bundle" hook or \`npm run bundle:power\`.`,
    ).toBe(pinned);
  });

  it.skipIf(installedEsbuild !== pinned)("2. power-planchette/dwell-sim-mcp.mjs equals a fresh build of tools/dwell-sim-mcp/src and skeleton/src", async () => {
    const { code } = await buildBundle();
    const committed = readFileSync(bundlePath, "utf8");
    const message =
      'power-planchette/dwell-sim-mcp.mjs is stale: tools/dwell-sim-mcp/src or skeleton/src changed since it was built. Run the manual hook "Rebuild power bundle" or `npm run bundle:power`, then commit the file.';
    expect(code === committed, message).toBe(true);
  });
});
