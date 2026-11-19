/**
 * Verifies that `npm run build` produces the three HTML files at the
 * paths the spec requires: dist/index.html, dist/board/index.html,
 * dist/game/index.html (not mirroring source directory structure).
 *
 * Runs Vite's build() programmatically into a temporary directory so the
 * test is self-contained and works on a clean checkout with no prior dist/.
 *
 * Covers: Task 1.3 / tech.md build requirement.
 */
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "vite";

const root = resolve(import.meta.dirname, "../../");

let outDir: string;

beforeAll(async () => {
  outDir = mkdtempSync(resolve(tmpdir(), "planchette-build-test-"));
  await build({
    root,
    logLevel: "silent",
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main:  resolve(root, "index.html"),
          board: resolve(root, "board/index.html"),
          game:  resolve(root, "game/index.html"),
        },
      },
    },
  });
}, 60_000);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

describe("Vite build output paths", () => {
  it("produces index.html at the output root (skeleton demo at /)", () => {
    expect(existsSync(resolve(outDir, "index.html"))).toBe(true);
  });

  it("produces board/index.html (App A at /board/)", () => {
    expect(existsSync(resolve(outDir, "board/index.html"))).toBe(true);
  });

  it("produces game/index.html (App B at /game/)", () => {
    expect(existsSync(resolve(outDir, "game/index.html"))).toBe(true);
  });

  it("does NOT output index.html inside a skeleton/demo/ subdirectory", () => {
    expect(existsSync(resolve(outDir, "skeleton/demo/index.html"))).toBe(false);
  });

  it("does NOT output board/index.html inside an apps/ subdirectory", () => {
    expect(existsSync(resolve(outDir, "apps/board/index.html"))).toBe(false);
  });
});
