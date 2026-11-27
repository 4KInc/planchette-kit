import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@planchette/skeleton/ui",
        replacement: fileURLToPath(new URL("../../skeleton/src/ui/index.ts", import.meta.url)),
      },
      {
        find: "@planchette/skeleton",
        replacement: fileURLToPath(new URL("../../skeleton/src/index.ts", import.meta.url)),
      },
    ],
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
