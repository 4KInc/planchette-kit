/**
 * Verifies that `npm run build` produces the three HTML files at the
 * paths the spec requires: dist/index.html, dist/board/index.html,
 * dist/game/index.html (not mirroring source directory structure).
 *
 * Covers: Task 1.3 / tech.md build requirement.
 */
import { existsSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";

const root = resolve(import.meta.dirname, "../../");

describe("Vite build output paths", () => {
  it("produces dist/index.html at the repo root (skeleton demo at /)", () => {
    expect(existsSync(resolve(root, "dist/index.html"))).toBe(true);
  });

  it("produces dist/board/index.html (App A at /board/)", () => {
    expect(existsSync(resolve(root, "dist/board/index.html"))).toBe(true);
  });

  it("produces dist/game/index.html (App B at /game/)", () => {
    expect(existsSync(resolve(root, "dist/game/index.html"))).toBe(true);
  });

  it("does NOT output index.html inside a skeleton/demo/ subdirectory", () => {
    expect(existsSync(resolve(root, "dist/skeleton/demo/index.html"))).toBe(false);
  });

  it("does NOT output board/index.html inside an apps/ subdirectory", () => {
    expect(existsSync(resolve(root, "dist/apps/board/index.html"))).toBe(false);
  });
});
