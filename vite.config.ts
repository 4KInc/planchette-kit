import { defineConfig } from "vite";
import { resolve } from "path";
import { mediapipeAssets } from "./skeleton/scripts/mediapipe-assets.ts";

export default defineConfig({
  // root is the repo root; Vite serves index.html at /, board/index.html at /board/, etc.
  root: ".",
  // The head-tracking WASM and model files, served and built at <base>mediapipe/ (Task 14).
  plugins: [mediapipeAssets()],
  resolve: {
    // The apps import the kit as '@planchette/skeleton' only. Here that name points at the
    // source, so `npm run dev` and `npm run build` work without building the package first.
    alias: {
      "@planchette/skeleton/ui": resolve(import.meta.dirname, "skeleton/src/ui/index.ts"),
      "@planchette/skeleton": resolve(import.meta.dirname, "skeleton/src/index.ts"),
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main:  resolve(import.meta.dirname, "index.html"),
        board: resolve(import.meta.dirname, "board/index.html"),
        game:  resolve(import.meta.dirname, "game/index.html"),
        seance: resolve(import.meta.dirname, "seance/index.html"),
      },
    },
  },
});
