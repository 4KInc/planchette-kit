/**
 * Verifies that `npm run build` produces the three HTML files at the
 * paths the spec requires: dist/index.html, dist/board/index.html,
 * dist/seance/index.html (not mirroring source directory structure).
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
import { existsSync, readFileSync, readdirSync, rmSync } from "fs";
import { createHash } from "crypto";
import { mediapipeAssetSources } from "../scripts/mediapipe-assets";
import { resolve } from "path";
import { randomBytes } from "crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "vite";

const root = resolve(import.meta.dirname, "../../");

// Unique relative outDir per test run, nested under .build-test-tmp/ so it
// is easy to gitignore and clean up without touching a real dist/.
const relOutDir = `.build-test-tmp/run-${Date.now()}-${randomBytes(4).toString("hex")}`;

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
  // Remove only this run's folder so concurrent runs are unaffected.
  rmSync(resolve(root, relOutDir), { recursive: true, force: true });
});

describe("Vite build output paths", () => {
  const out = (p: string) => existsSync(resolve(root, relOutDir, p));

  it("produces index.html at the output root (skeleton demo at /)", () => {
    expect(out("index.html")).toBe(true);
  });

  it("produces board/index.html (App A at /board/)", () => {
    expect(out("board/index.html")).toBe(true);
  });

  it("produces seance/index.html (App B, Séance, at /seance/)", () => {
    expect(out("seance/index.html")).toBe(true);
  });
  it("has no game/ page: the old App B stub was replaced by Séance", () => {
    expect(out("game/index.html")).toBe(false);
  });

  it("does NOT output index.html inside a skeleton/demo/ subdirectory", () => {
    expect(out("skeleton/demo/index.html")).toBe(false);
  });

  it("does NOT output board/index.html inside an apps/ subdirectory", () => {
    expect(out("apps/board/index.html")).toBe(false);
  });
});

describe("head-tracking files are served from the app's own origin (Task 14.1)", () => {
  const out = (p: string) => resolve(root, relOutDir, p);
  it("copies both MediaPipe WASM pairs (SIMD and nosimd) and the face model into mediapipe/", () => {
    for (const f of ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm", "face_landmarker.task"]) {
      expect(existsSync(out(`mediapipe/${f}`)), f).toBe(true);
    }
  });
  it("copies the WASM from the pinned @mediapipe/tasks-vision, byte for byte", () => {
    const src = mediapipeAssetSources()["vision_wasm_internal.wasm"];
    expect(readFileSync(out("mediapipe/vision_wasm_internal.wasm")).equals(readFileSync(src))).toBe(true);
  });
  it("the face model is the published float16 v1 file (SHA-256 as in THIRD_PARTY.md)", () => {
    const hash = createHash("sha256").update(readFileSync(out("mediapipe/face_landmarker.task"))).digest("hex");
    expect(hash).toBe("64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff");
  });
  it("does not copy the module WASM pair, which the adapter does not use", () => {
    expect(existsSync(out("mediapipe/vision_wasm_module_internal.wasm"))).toBe(false);
  });
  it("loads MediaPipe from no CDN: no jsdelivr, unpkg or googleapis URL in the built JavaScript", () => {
    const assets = readdirSync(out("assets")).filter((f: string) => f.endsWith(".js"));
    for (const f of assets) {
      const text = readFileSync(out(`assets/${f}`), "utf8");
      expect(text, f).not.toMatch(/cdn\.jsdelivr\.net|unpkg\.com|storage\.googleapis\.com/);
    }
  });
});

