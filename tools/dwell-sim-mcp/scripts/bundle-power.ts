// Bundles the dwell simulator into ONE self-contained file for the Kiro power:
// `power-planchette/dwell-sim-mcp.mjs`. `dist/` is gitignored, so the power cannot point at it.
//
// The entry is the real stdio server (`src/server.ts`). `@planchette/skeleton` is aliased to the
// skeleton's source, so the bundle needs no built `dist/` and the simulator still drives the
// skeleton's real engine. `buildBundle` is pure apart from reading the source tree, so the stale
// test can rebuild in memory and compare. Run with `npm run bundle:power` (repository root).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

export interface BundledPackage {
  name: string;
  version: string;
  license: string;
}
export interface BundleResult {
  /** The text of `dwell-sim-mcp.mjs`. */
  code: string;
  /** Every npm package whose code is inlined, sorted by name. */
  packages: BundledPackage[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
/** The repository root: `tools/dwell-sim-mcp/scripts` and `.../dist-scripts` are both three levels down. */
export const REPO_ROOT = path.resolve(here, "..", "..", "..");
export const BUNDLE_PATH = path.join(REPO_ROOT, "power-planchette", "dwell-sim-mcp.mjs");

/**
 * Not inlined: the skeleton's camera adapter loads it with a lazy `import()` inside the function that
 * starts a camera, which the simulator never calls. Leaving it out keeps 194 KB of unused code and an
 * Apache-2.0 package (with no LICENSE file in its npm package) out of the file.
 */
export const EXTERNAL = ["@mediapipe/tasks-vision"];

interface PackageJson {
  name?: string;
  version?: string;
  license?: string;
}

/** The package name from a path like `node_modules/a/node_modules/@s/b/x.js` (the last `node_modules` wins). */
function packageDirOf(inputPath: string): string | undefined {
  const marker = "node_modules/";
  const at = inputPath.lastIndexOf(marker);
  if (at < 0) return undefined;
  const rest = inputPath.slice(at + marker.length).split("/");
  const name = rest[0]?.startsWith("@") ? `${rest[0]}/${rest[1] ?? ""}` : rest[0];
  if (name === undefined || name === "") return undefined;
  return inputPath.slice(0, at + marker.length) + name;
}

export async function buildBundle(): Promise<BundleResult> {
  const result = await build({
    absWorkingDir: REPO_ROOT,
    entryPoints: ["tools/dwell-sim-mcp/src/server.ts"],
    alias: { "@planchette/skeleton": "./skeleton/src/index.ts" },
    external: EXTERNAL,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    legalComments: "eof",
    sourcemap: false,
    minify: false,
    metafile: true,
    write: false,
    outfile: "power-planchette/dwell-sim-mcp.mjs",
    logLevel: "silent",
  });
  const output = result.outputFiles[0];
  if (output === undefined || result.outputFiles.length !== 1) throw new Error("Expected exactly one output file.");

  const dirs = new Set<string>();
  for (const input of Object.keys(result.metafile.inputs)) {
    const dir = packageDirOf(input);
    if (dir !== undefined) dirs.add(dir);
  }
  const packages: BundledPackage[] = [...dirs].map((dir) => {
    const json = JSON.parse(readFileSync(path.join(REPO_ROOT, dir, "package.json"), "utf8")) as PackageJson;
    return { name: json.name ?? dir, version: json.version ?? "?", license: json.license ?? "?" };
  });
  packages.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { code: output.text + licenceFooter(dirs), packages };
}

const LICENCE_NAMES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "license", "license.md"];

/**
 * esbuild keeps only `@license` and `/*!` comments, and none of the inlined packages has one, so the
 * notices would be lost. MIT, BSD and ISC need the copyright notice and the licence text to travel with
 * copies of the code, so each package's own licence file is appended as one comment at the end.
 */
function licenceFooter(dirs: ReadonlySet<string>): string {
  const blocks: string[] = [];
  for (const dir of [...dirs].sort()) {
    const file = LICENCE_NAMES.map((n) => path.join(REPO_ROOT, dir, n)).find((f) => existsSync(f));
    if (file === undefined) throw new Error(`No licence file found for the inlined package in ${dir}.`);
    const json = JSON.parse(readFileSync(path.join(REPO_ROOT, dir, "package.json"), "utf8")) as PackageJson;
    const text = readFileSync(file, "utf8").trim().replaceAll("*/", "* /");
    blocks.push(`=== ${json.name ?? dir} ${json.version ?? ""} (${json.license ?? "?"}) ===\n${text}`);
  }
  return `\n/*! Licences of the packages inlined above.\n\n${blocks.join("\n\n")}\n*/\n`;
}

async function main(): Promise<void> {
  const { code, packages } = await buildBundle();
  mkdirSync(path.dirname(BUNDLE_PATH), { recursive: true });
  writeFileSync(BUNDLE_PATH, code);
  console.log(`power-planchette/dwell-sim-mcp.mjs: ${code.length} bytes, ${packages.length} packages inlined`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
