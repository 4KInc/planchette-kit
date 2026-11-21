import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface PackageJson {
  engines?: { node?: string };
  bin?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readJson(relative: string): PackageJson {
  const url = new URL(relative, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as PackageJson;
}

const pkg = readJson("../package.json");
const skeleton = readJson("../../../skeleton/package.json");

describe("dwell-sim-mcp package.json", () => {
  it("pins every dependency to an exact version (workspace link excepted)", () => {
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, version] of Object.entries(all)) {
      if (name === "@planchette/skeleton") {
        expect(version).toBe("*");
        continue;
      }
      expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
      expect(version, name).not.toMatch(/[\^~<>=*x|\s]/);
    }
  });

  it("uses the same fast-check, vitest and typescript versions as the skeleton", () => {
    for (const name of ["fast-check", "vitest", "typescript"]) {
      expect(pkg.devDependencies?.[name], name).toBeDefined();
      expect(pkg.devDependencies?.[name], name).toBe(skeleton.devDependencies?.[name]);
    }
  });

  it("requires Node 20 or newer", () => {
    const range = pkg.engines?.node ?? "";
    const match = /^>=\s*(\d+)/.exec(range);
    expect(match, range).not.toBeNull();
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(20);
  });

  it("exposes the server through bin", () => {
    expect(pkg.bin?.["dwell-sim-mcp"]).toBe("dist/server.js");
  });
});
