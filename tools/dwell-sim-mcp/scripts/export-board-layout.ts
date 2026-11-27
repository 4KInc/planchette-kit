// Exports the layout of the built Board as four JSON files, for the Board preset run (Task 36).
//
// It serves the built site (the root `npm run build` output) with `vite preview` on 127.0.0.1,
// opens `/board/` at 1920 × 1080 and again at 1366 × 768 in a fresh browser context (so the page
// is in its first-run state), chooses mouse mode, reads `planchetteBoard.planchette.getTargets()`
// for the Core view, presses the Spell toggle and reads again for the Spell view. It writes
// `board-layout-core-<size>.json` and `board-layout-spell-<size>.json` next to the package's
// package.json. `getUserMedia` is refused, so no camera is ever started.
// Run with `npm run demo:export:board`.
//
// `toBoardLayoutJson` and `summariseTargetIds` are pure so the test can call them without a browser.
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "@playwright/test";
import { preview } from "vite";
import { toLayoutJson, type ExportedRect, type LayoutJson } from "./export-demo-layout.js";

export type BoardView = "core" | "spell";

interface PageTarget {
  id: string;
  rect: ExportedRect;
  autoRepeat: boolean;
  role: string;
}

/** Converts the viewport and the targets read from the Board into the `{ screen, targets }` layout. */
export function toBoardLayoutJson(viewport: { width: number; height: number }, targets: ReadonlyArray<PageTarget>): LayoutJson {
  return toLayoutJson(viewport, targets);
}

/** The id groups of a layout, in a fixed order, each with its count. Ids that fit no group go under "other". */
export function summariseTargetIds(ids: ReadonlyArray<string>): Record<string, number> {
  const groups: Array<[string, (id: string) => boolean]> = [
    ["core-*", (id) => id.startsWith("core-")],
    ["letter-*", (id) => id.startsWith("letter-")],
    ["space/backspace (letter board)", (id) => id === "space" || id === "backspace"],
    ["prediction-slot-*", (id) => id.startsWith("prediction-slot-")],
    ["actions", (id) => ["speak", "backspace-action", "clear", "undo", "spell-toggle"].includes(id)],
    ["camera-toggle", (id) => id === "camera-toggle"],
    ["phrases-toggle", (id) => id === "phrases-toggle"],
    ["rest-area", (id) => id === "rest-area"],
    ["cancel", (id) => id === "cancel"],
  ];
  const out: Record<string, number> = {};
  for (const [name] of groups) out[name] = 0;
  out["other"] = 0;
  for (const id of ids) {
    const group = groups.find(([, test]) => test(id));
    out[group === undefined ? "other" : group[0]]++;
  }
  if (out["other"] === 0) delete out["other"];
  return out;
}

/** The file name for a view and viewport. */
export function boardLayoutFileName(view: BoardView, size: { width: number; height: number }): string {
  return `board-layout-${view}-${size.width}x${size.height}.json`;
}

const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
] as const;

type BoardWindow = { planchetteBoard?: { planchette: { getTargets(): ReadonlyArray<PageTarget> } } };

const readTargets = (page: Page): Promise<PageTarget[]> =>
  page.evaluate(() =>
    (window as unknown as Required<BoardWindow>).planchetteBoard.planchette.getTargets().map((t) => ({
      id: t.id,
      rect: { x: t.rect.x, y: t.rect.y, width: t.rect.width, height: t.rect.height },
      autoRepeat: t.autoRepeat,
      role: t.role,
    })),
  );

/** Reads the targets until two reads 150 ms apart agree, so a layout still moving after a resize is not exported. */
async function readSettledTargets(page: Page): Promise<PageTarget[]> {
  let previous = JSON.stringify(await readTargets(page));
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(150);
    const current = await readTargets(page);
    const text = JSON.stringify(current);
    if (text === previous && current.length > 0) return current;
    previous = text;
  }
  throw new Error("The Board's targets did not settle.");
}

async function main(): Promise<void> {
  const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const repoRoot = path.resolve(pkgDir, "..", "..");
  if (!existsSync(path.join(repoRoot, "dist", "board", "index.html"))) {
    throw new Error("The Board build is missing. Run `npm run build` in the repository root first.");
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
    const url = `http://127.0.0.1:${address.port}/board/`;
    for (const size of SIZES) {
      // A new context per size: empty storage, so the page is in its first-run state.
      const context = await browser.newContext({ viewport: size });
      const page = await context.newPage();
      // Count and refuse camera requests. No camera is ever started.
      await page.addInitScript(() => {
        if (navigator.mediaDevices !== undefined) {
          navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("no camera in the export", "NotFoundError"));
        }
      });
      await page.goto(url);
      await page.waitForFunction(() => (window as unknown as BoardWindow).planchetteBoard !== undefined, undefined, { timeout: 30_000 });
      await page.waitForLoadState("networkidle");
      await page.locator("#mode").selectOption("mouse");
      const viewport = page.viewportSize();
      if (viewport === null) throw new Error("The page has no viewport.");

      const views: Array<[BoardView, PageTarget[]]> = [];
      views.push(["core", await readSettledTargets(page)]);
      // Press the Spell toggle with a real click (mouse mode selects on click).
      await page.locator('[data-planchette-target="spell-toggle"]').click();
      await page.locator("#letter-grid").waitFor({ state: "visible" });
      views.push(["spell", await readSettledTargets(page)]);

      for (const [view, targets] of views) {
        const layout = toBoardLayoutJson(viewport, targets);
        const file = path.join(pkgDir, boardLayoutFileName(view, size));
        writeFileSync(file, JSON.stringify(layout, null, 2) + "\n");
        console.log(`Wrote ${file} (${layout.targets.length} targets) ${JSON.stringify(summariseTargetIds(layout.targets.map((t) => t.id)))}`);
      }
      await context.close();
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
