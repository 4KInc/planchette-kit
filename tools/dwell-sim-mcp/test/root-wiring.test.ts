import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface RootPackage {
  workspaces?: string[];
  scripts?: Record<string, string>;
}

const root = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
) as RootPackage;
const gitignore = readFileSync(new URL("../../../.gitignore", import.meta.url), "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line !== "" && !line.startsWith("#"));

describe("root wiring", () => {
  it("lists the package in workspaces next to the skeleton", () => {
    expect(root.workspaces).toContain("tools/dwell-sim-mcp");
    expect(root.workspaces).toContain("skeleton");
  });

  it("defines sim and build:sim", () => {
    expect(root.scripts?.sim).toBe("node tools/dwell-sim-mcp/dist/server.js");
    const build = root.scripts?.["build:sim"] ?? "";
    expect(build).toContain("npm run build --workspace=skeleton");
    expect(build).toContain("npm run build --workspace=tools/dwell-sim-mcp");
    expect(build.indexOf("workspace=skeleton")).toBeLessThan(
      build.indexOf("workspace=tools/dwell-sim-mcp"),
    );
  });

  it("type-checks both workspaces", () => {
    const typecheck = root.scripts?.typecheck ?? "";
    expect(typecheck).toContain("tsc --noEmit -p skeleton/tsconfig.json");
    expect(typecheck).toContain("tsc --noEmit -p tools/dwell-sim-mcp/tsconfig.json");
  });

  it("builds the simulator before running the tests of both workspaces", () => {
    const test = root.scripts?.test ?? "";
    expect(test).toContain("npm run typecheck");
    expect(test).toContain("npm run build:sim");
    expect(test).toContain("--workspace=skeleton");
    expect(test).toContain("--workspace=tools/dwell-sim-mcp");
    expect(test.indexOf("build:sim")).toBeLessThan(test.indexOf("npm run test --workspace"));
  });

  it("keeps the existing scripts", () => {
    for (const name of ["dev", "build", "test:e2e"]) {
      expect(root.scripts?.[name], name).toBeTruthy();
    }
  });

  it("ignores the build outputs but not .kiro", () => {
    expect(gitignore).toContain("tools/dwell-sim-mcp/dist/");
    expect(gitignore).toContain("tools/dwell-sim-mcp/dist-scripts/");
    expect(gitignore.some((l) => l === ".kiro" || l === ".kiro/" || l.startsWith(".kiro/"))).toBe(false);
  });
});
