// Exports the layout of the built Séance as four JSON files, for the Séance preset run (Task 17).
//
// It serves the built site (the root `npm run build` output) with `vite preview` on 127.0.0.1 and opens `/seance/`
// at 1920 x 1080 and at 1366 x 768 in a fresh browser context (so the page is in its first-run state). It reads
// `planchetteSeance.planchette.getTargets()` for the playing view, then plays a short Round in head + dwell with
// synthetic camera samples fed through the public `feedSamples` (no camera is ever started: `getUserMedia` is
// refused) and reads the targets again on the Summary, where the Carry target is registered. It writes
// `seance-layout-play-<size>.json` and `seance-layout-summary-<size>.json` next to the package's package.json.
// Run with `npm run demo:export:seance`.
//
// `toSeanceLayoutJson`, `summariseSeanceTargetIds` and `seanceLayoutFileName` are pure so the test can call them
// without a browser.
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "@playwright/test";
import { preview } from "vite";
import { toLayoutJson, type ExportedRect, type LayoutJson } from "./export-demo-layout.js";
export type SeanceView = "play" | "summary";
interface PageTarget {
  id: string;
  rect: ExportedRect;
  autoRepeat: boolean;
  role: string;
}
/** Converts the viewport and the targets read from Séance into the `{ screen, targets }` layout. */
export function toSeanceLayoutJson(viewport: { width: number; height: number }, targets: ReadonlyArray<PageTarget>): LayoutJson {
  return toLayoutJson(viewport, targets);
}
/** The id groups of a layout, in a fixed order, each with its count. Ids that fit no group go under "other". */
export function summariseSeanceTargetIds(ids: ReadonlyArray<string>): Record<string, number> {
  const groups: Array<[string, (id: string) => boolean]> = [
    ["letter-*", (id) => id.startsWith("letter-")],
    ["yes/no/goodbye", (id) => ["yes", "no", "goodbye"].includes(id)],
    ["suggest-*", (id) => id.startsWith("suggest-")],
    ["stop/undo/cancel", (id) => ["stop", "undo", "cancel"].includes(id)],
    ["camera-toggle", (id) => id === "camera-toggle"],
    ["sound-toggle", (id) => id === "sound-toggle"],
    ["rest-area", (id) => id === "rest-area"],
    ["next-round", (id) => id === "next-round"],
    ["carry-dwell", (id) => id === "carry-dwell"],
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
export function seanceLayoutFileName(view: SeanceView, size: { width: number; height: number }): string {
  return `seance-layout-${view}-${size.width}x${size.height}.json`;
}
const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
] as const;
type SeanceWindow = { planchetteSeance?: { planchette: { getTargets(): ReadonlyArray<PageTarget>; feedSamples(s: unknown[]): void } } };
const readTargets = (page: Page): Promise<PageTarget[]> =>
  page.evaluate(() =>
    (window as unknown as Required<SeanceWindow>).planchetteSeance.planchette.getTargets().map((t) => ({
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
  throw new Error("Séance's targets did not settle.");
}
/**
 * Synthetic camera samples (head modes), 33 ms apart, looking at a target's centre; 'centre' looks at the
 * middle of the screen (the start-up centre step). Timestamps continue from `t0`, which starts a little after
 * the page's own clock so the Round accepts them. Returns the last sample time. This mirrors what the page's own
 * end-to-end tests do; it uses only the public `feedSamples`.
 */
function lookAt(page: Page, targetId: string, n: number, t0: number): Promise<number> {
  return page.evaluate(
    ([id, count, start]) => {
      const planchette = (window as unknown as Required<SeanceWindow>).planchetteSeance.planchette;
      let x = (innerWidth - 1) / 2;
      let y = (innerHeight - 1) / 2;
      if (id !== "centre") {
        const r = document.querySelector(`[data-planchette-target="${id}"]`)!.getBoundingClientRect();
        x = r.x + r.width / 2;
        y = r.y + r.height / 2;
      }
      // Inverse of the default head mapping (R 15 degrees, dead zone 0.5, gain 1).
      const inv = (u: number): number => {
        const dz = (u - 0.5) * 2 * 14.5;
        return dz === 0 ? 0 : Math.sign(dz) * (Math.abs(dz) + 0.5);
      };
      const rotation = { yaw: inv(x / (innerWidth - 1)), pitch: inv(1 - y / (innerHeight - 1)) };
      const samples: unknown[] = [];
      let t = start as number;
      for (let i = 0; i < (count as number); i++) {
        samples.push({
          now: (t += 33),
          source: "camera",
          faces: [{ bbox: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.3 }, rotation, confidence: 1, gestureScores: { jawOpen: 0, browRaise: 0 } }],
        });
      }
      planchette.feedSamples(samples);
      return t;
    },
    [targetId, n, t0] as const,
  );
}
async function main(): Promise<void> {
  const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const repoRoot = path.resolve(pkgDir, "..", "..");
  if (!existsSync(path.join(repoRoot, "dist", "seance", "index.html"))) {
    throw new Error("The Séance build is missing. Run `npm run build` in the repository root first.");
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
    const url = `http://127.0.0.1:${address.port}/seance/`;
    for (const size of SIZES) {
      // A new context per size: empty storage, so the page is in its first-run state and the Board key is missing.
      const context = await browser.newContext({ viewport: size });
      const page = await context.newPage();
      // Refuse camera requests. No camera is ever started.
      await page.addInitScript(() => {
        if (navigator.mediaDevices !== undefined) {
          navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("no camera in the export", "NotFoundError"));
        }
      });
      await page.goto(url);
      await page.waitForFunction(() => (window as unknown as SeanceWindow).planchetteSeance !== undefined, undefined, { timeout: 30_000 });
      await page.waitForLoadState("networkidle");
      const viewport = page.viewportSize();
      if (viewport === null) throw new Error("The page has no viewport.");
      const views: Array<[SeanceView, PageTarget[]]> = [];
      // The playing view at Support level 0: the 29 Board targets and the side column (the Suggestion slots are empty).
      views.push(["play", await readSettledTargets(page)]);
      // Play one Round in head + dwell with synthetic samples (default dwell 2100 ms), so the Summary offers Carry.
      await page.locator("#mode").selectOption("head + dwell");
      let t = (await page.evaluate(() => performance.now())) + 300;
      t = await lookAt(page, "centre", 60, t);
      for (let guard = 0; guard < 8 && !(await page.locator("#summary-section").isVisible()); guard++) {
        const next = await page.locator('[data-next="true"]').getAttribute("data-planchette-target");
        if (next === null) break;
        t = await lookAt(page, next, 100, t);
      }
      await page.locator("#summary-section").waitFor({ state: "visible", timeout: 10_000 });
      // Move the pointer off the Summary's actions (the arrival guard holds a target the pointer rests on).
      await lookAt(page, "rest-area", 60, t);
      await page.locator("#carry-dwell").waitFor({ state: "visible", timeout: 10_000 });
      views.push(["summary", await readSettledTargets(page)]);
      for (const [view, targets] of views) {
        const layout = toSeanceLayoutJson(viewport, targets);
        const ids = layout.targets.map((tg) => tg.id);
        if (view === "summary" && !(ids.includes("carry-dwell") && ids.includes("next-round"))) {
          throw new Error(`The Summary layout at ${size.width}x${size.height} lacks carry-dwell or next-round: ${ids.join(", ")}`);
        }
        const file = path.join(pkgDir, seanceLayoutFileName(view, size));
        writeFileSync(file, JSON.stringify(layout, null, 2) + "\n");
        console.log(`Wrote ${file} (${layout.targets.length} targets) ${JSON.stringify(summariseSeanceTargetIds(ids))}`);
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
