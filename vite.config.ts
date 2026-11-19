import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  // root is the repo root; Vite serves index.html at /, board/index.html at /board/, etc.
  root: ".",
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main:  resolve(import.meta.dirname, "index.html"),
        board: resolve(import.meta.dirname, "board/index.html"),
        game:  resolve(import.meta.dirname, "game/index.html"),
      },
    },
  },
});
