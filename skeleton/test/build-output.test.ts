/**
 * Verifies that `npm run build` produces the three HTML files at the
 * paths the spec requires: dist/index.html, dist/board/index.html,
 * dist/game/index.html (not mirroring source directory structure).
 *
 * Runs Vite's build() programmatically against the real vite.config.ts,
 * outputting into a temporary directory, so the test is self-contained,
 * works on a clean checkout, and catches a misconfigured vite.config.ts.
 *
 * Note: outDir is passed as a path relative to the repo root (not absolute).
 * Vite 8 (rolldown) computes HTML output fileNames as paths relative to
 * outDir; an absolute outDir outside root produces "../" prefixes that
 * rolldown rejects. A relative string is resolved by Vite against root,
 * keeping the computation inside the root tree.
 *
 * Covers: Task 1.3 / tech.md build requirement.
 */
import { existsSync, rmSync } from "fs";
import { resolve } from "path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "vite";

const root = resolve(import.meta.dirname, "../../");

// Unique relative outDir per test run, nested under .build-test-tmp/ so it
// is easy to gitignore and clean up without touching a real dist/.
const relOutDir = `.build-test-tmp/run-${Date.now()}`;

beforeAll(async () => {
  await build({
    configFile: resolve(root, "vite.config.ts"),
    root,          // explicit root so the relative outDir below resolves against it,
                   // regardless of the process cwd when vitest runs
    logLevel: "silent",
    build: {
      outDir: relOutDir,   // relative to root — required by rolldown (see note above)
      emptyOutDir: true,
    },
  });
}, 60_000);

afterAll(() => {
  rmSync(resolve(root, ".build-test-tmp"), { recursive: true, force: true });
});

describe("Vite build output paths", () => {
  const out = (p: string) => existsSync(resolve(root, relOutDir, p));

  it("produces index.html at the output root (skeleton demo at /)", () => {
    expect(out("index.html")).toBe(true);
  });

  it("produces board/index.html (App A at /board/)", () => {
    expect(out("board/index.html")).toBe(true);
  });

  it("produces game/index.html (App B at /game/)", () => {
    expect(out("game/index.html")).toBe(true);
  });

  it("does NOT output index.html inside a skeleton/demo/ subdirectory", () => {
    expect(out("skeleton/demo/index.html")).toBe(false);
  });

  it("does NOT output board/index.html inside an apps/ subdirectory", () => {
    expect(out("apps/board/index.html")).toBe(false);
  });
});
