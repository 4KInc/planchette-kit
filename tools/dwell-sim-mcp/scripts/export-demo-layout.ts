// Exports the layout of the built demo page as two JSON files, for the demo-layout run (Task 20).
//
// It serves the built demo (the root `npm run build` output) with `vite preview` on 127.0.0.1,
// opens `/` at 1920 × 1080 and again at 1366 × 768, reads `planchette.getTargets()` and the
// viewport, and writes `demo-layout-1920x1080.json` and `demo-layout-1366x768.json` next to the
// package's package.json. It never starts a camera. Run with `npm run demo:export`.
//
// `toLayoutJson` is pure so the test can call it without a browser.
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { preview } from "vite";

export interface ExportedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface ExportedTarget {
  id: string;
  rect: ExportedRect;
  autoRepeat: boolean;
  role: "default" | "rest-area" | string;
}
export interface LayoutJson {
  screen: { width: number; height: number };
  targets: ExportedTarget[];
}

/** Converts the viewport and the targets read from the page into the `{ screen, targets }` layout. */
export function toLayoutJson(
  viewport: { width: number; height: number },
  targets: ReadonlyArray<{ id: string; rect: ExportedRect; autoRepeat: boolean; role: string }>,
): LayoutJson {
  return {
    screen: { width: viewport.width, height: viewport.height },
    targets: targets.map((t) => ({
      id: t.id,
      rect: { x: t.rect.x, y: t.rect.y, width: t.rect.width, height: t.rect.height },
      autoRepeat: t.autoRepeat,
      role: t.role,
    })),
  };
}

const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
] as const;

async function main(): Promise<void> {
  const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const repoRoot = path.resolve(pkgDir, "..", "..");
  const distDir = path.join(repoRoot, "dist");
  if (!existsSync(path.join(distDir, "index.html"))) {
    throw new Error("The demo build is missing. Run `npm run build` in the repository root first.");
  }
  const server = await preview({
    root: repoRoot,
    configFile: path.join(repoRoot, "vite.config.ts"),
    preview: { host: "127.0.0.1", port: 0, strictPort: false, open: false },
  });
  const browser = await chromium.launch();
  try {
    const address = server.httpServer.address();
    if (address === null || typeof address === "string") throw new Error("The preview server has no port.");
    const url = `http://127.0.0.1:${address.port}/`;
    for (const size of SIZES) {
      const page = await browser.newPage({ viewport: size });
      await page.goto(url);
      await page.waitForFunction(
        () => {
          const demo = (window as unknown as { planchetteDemo?: { planchette: { getTargets(): unknown[] } } }).planchetteDemo;
          return demo !== undefined && demo.planchette.getTargets().length > 0;
        },
        undefined,
        { timeout: 30_000 },
      );
      const targets = await page.evaluate(() =>
        (
          window as unknown as {
            planchetteDemo: { planchette: { getTargets(): ReadonlyArray<ExportedTarget> } };
          }
        ).planchetteDemo.planchette.getTargets().map((t) => ({
          id: t.id,
          rect: { x: t.rect.x, y: t.rect.y, width: t.rect.width, height: t.rect.height },
          autoRepeat: t.autoRepeat,
          role: t.role,
        })),
      );
      const viewport = page.viewportSize();
      if (viewport === null) throw new Error("The page has no viewport.");
      const layout = toLayoutJson(viewport, targets);
      const file = path.join(pkgDir, `demo-layout-${size.width}x${size.height}.json`);
      writeFileSync(file, JSON.stringify(layout, null, 2) + "\n");
      console.log(`Wrote ${file} (${layout.targets.length} targets)`);
      await page.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
