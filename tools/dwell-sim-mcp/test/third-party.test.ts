import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface PackageJson {
  name: string;
  version: string;
  license?: string;
  dependencies?: Record<string, string>;
}

interface Installed {
  name: string;
  version: string;
  license: string | undefined;
}

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const thirdPartyPath = fileURLToPath(
  new URL("../../../THIRD_PARTY.md", import.meta.url),
);

function readPackage(dir: string): PackageJson {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as PackageJson;
}

/** Node resolution: nearest node_modules/<name> walking up from `from`. */
function resolveInstalled(from: string, name: string): string | undefined {
  let dir = from;
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) {
      return realpathSync(candidate);
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Production dependency closure of the package (workspace packages are
 * walked but not reported: they are this project's own code). */
function productionDependencies(): Installed[] {
  const found = new Map<string, Installed>();
  const visited = new Set<string>();
  const unresolved: string[] = [];

  const walk = (dir: string): void => {
    const pkg = readPackage(dir);
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      const resolved = resolveInstalled(dir, name);
      if (resolved === undefined) {
        unresolved.push(`${name} (required by ${pkg.name})`);
        continue;
      }
      if (visited.has(resolved)) continue;
      visited.add(resolved);
      const dep = readPackage(resolved);
      if (resolved.includes(`${sep}node_modules${sep}`)) {
        found.set(`${dep.name}@${dep.version}`, {
          name: dep.name,
          version: dep.version,
          license: dep.license,
        });
      }
      walk(resolved);
    }
  };

  walk(packageDir.replace(/[\\/]$/, ""));
  expect(unresolved, "production dependencies missing from node_modules").toEqual([]);
  return [...found.values()].sort((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
  );
}

interface Row {
  name: string;
  version: string;
  license: string;
}

function readRows(): Row[] {
  const rows: Row[] = [];
  for (const line of readFileSync(thirdPartyPath, "utf8").split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    // cells[0] and the last cell are empty (leading and trailing pipe).
    if (cells.length < 6) continue;
    const name = /^`([^`]+)`$/.exec(cells[1] ?? "");
    if (name === null) continue;
    rows.push({
      name: name[1] as string,
      version: (cells[2] ?? "").split(/\s+/)[0] as string,
      license: cells[3] ?? "",
    });
  }
  return rows;
}

const ALLOWED_LICENSE = /^(MIT|Apache-2\.0|ISC|BSD-[\w.-]+)$/;

describe("THIRD_PARTY.md covers the production dependencies of dwell-sim-mcp", () => {
  const installed = productionDependencies();
  const rows = readRows();

  it("finds the direct dependencies in the installed tree", () => {
    const names = installed.map((d) => d.name);
    expect(names).toContain("@modelcontextprotocol/sdk");
    expect(names).toContain("zod");
  });

  it("lists every installed production dependency with its exact version and licence", () => {
    for (const dep of installed) {
      const row = rows.find(
        (r) => r.name === dep.name && r.version === dep.version,
      );
      expect(row, `${dep.name}@${dep.version} missing from THIRD_PARTY.md`).toBeDefined();
      expect(row?.license, `${dep.name}@${dep.version} licence`).toBe(dep.license);
    }
  });

  it("allows only MIT, Apache-2.0, BSD-* and ISC licences", () => {
    for (const dep of installed) {
      expect(dep.license, `${dep.name}@${dep.version} licence`).toMatch(
        ALLOWED_LICENSE,
      );
    }
  });
});
