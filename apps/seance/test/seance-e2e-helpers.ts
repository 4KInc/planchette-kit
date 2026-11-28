/**
 * Helpers for the Séance end-to-end suites (not a test file itself). No camera is ever started and no
 * sound is ever made: `getUserMedia` and `AudioContext` are wrapped only to COUNT calls.
 */
import { expect, type Page } from '@playwright/test';
import type { Planchette } from '@planchette/skeleton';
export interface HighlightDetail {
  kind: string;
  targetId: string;
  targetIds: string[];
}
export type Win = {
  __gum: number;
  __audio: number;
  __hl?: HighlightDetail;
  planchetteSeance: { planchette: Planchette };
};
export const SIZES = [
  { width: 1366, height: 768, cell: 96 },
  { width: 1920, height: 1080, cell: 148 },
] as const;
export const KEY_BOARD = 'planchette-board:settings';
export const KEY_SEANCE = 'planchette-seance:settings';
/** Opens Séance with counters for camera and audio installed before any page script runs. */
export async function open(page: Page, size: { width: number; height: number } = { width: 1366, height: 768 }, seedStorage?: Record<string, string>): Promise<void> {
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.addInitScript((seed) => {
    const w = window as unknown as Win;
    w.__gum = 0;
    w.__audio = 0;
    if (navigator.mediaDevices !== undefined) {
      navigator.mediaDevices.getUserMedia = () => {
        w.__gum++;
        return Promise.reject(new DOMException('no camera in the tests', 'NotFoundError'));
      };
    }
    const Original = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
    if (Original !== undefined) {
      const Counted = function (this: unknown): AudioContext {
        w.__audio++;
        return new Original();
      };
      (window as unknown as { AudioContext: unknown }).AudioContext = Counted;
    }
    if (seed !== undefined && !sessionStorage.getItem('__seeded')) {
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
      sessionStorage.setItem('__seeded', '1');
    }
  }, seedStorage);
  await page.goto('/seance/');
  await page.waitForFunction(() => (window as unknown as Partial<Win>).planchetteSeance !== undefined);
  await page.waitForLoadState('networkidle');
}
export const target = (page: Page, id: string) => page.locator(`[data-planchette-target="${id}"]`);
export const chooseMode = async (page: Page, mode: string): Promise<void> => {
  await page.locator('#mode').selectOption(mode);
  await expect(page.locator('#mode')).toHaveValue(mode);
};
/** A real pointer click at the centre of a target (in mouse mode the skeleton turns it into a select). */
export async function tap(page: Page, id: string): Promise<void> {
  const box = (await target(page, id).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
}
export const nextId = (page: Page): Promise<string | null> => page.locator('[data-next="true"]').getAttribute('data-planchette-target');
export const summaryVisible = (page: Page): Promise<boolean> => page.locator('#summary-section').isVisible();
/** A letter that is not the next one (and not `not`), to make a Miss. */
export async function wrongId(page: Page, avoid: string[] = []): Promise<string> {
  const next = await nextId(page);
  return ['letter-a', 'letter-c', 'letter-e', 'letter-g'].find((id) => id !== next && !avoid.includes(id))!;
}
/** Taps the next target until the Summary shows (each tap is one Hit). */
export async function playToSummary(page: Page): Promise<void> {
  for (let i = 0; i < 12 && !(await summaryVisible(page)); i++) {
    await tap(page, (await nextId(page))!);
    await page.waitForTimeout(60);
  }
  await expect(page.locator('#summary-section')).toBeVisible();
}
export const gum = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as Win).__gum);
export const audioContexts = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as Win).__audio);
export const stored = (page: Page, key: string): Promise<string | null> => page.evaluate((k) => localStorage.getItem(k), key);
export const registeredIds = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as Win).planchetteSeance.planchette.getTargets().map((t) => t.id));
/**
 * Camera samples looking at a target's centre, 33 ms apart (head modes, synthetic: no camera). The first call
 * with 'centre' runs the start-up centre step. Returns the last sample time.
 */
export async function lookAt(page: Page, targetId: string | 'centre', n: number, t0: number): Promise<number> {
  return page.evaluate(
    ([id, count, start]) => {
      const planchette = (window as unknown as Win).planchetteSeance.planchette;
      let x = (innerWidth - 1) / 2;
      let y = (innerHeight - 1) / 2;
      if (id !== 'centre') {
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
      const samples = [];
      let t = start as number;
      for (let i = 0; i < (count as number); i++) {
        samples.push({
          now: (t += 33),
          source: 'camera' as const,
          faces: [{ bbox: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.3 }, rotation, confidence: 1, gestureScores: { jawOpen: 0, browRaise: 0 } }],
        });
      }
      planchette.feedSamples(samples);
      return t;
    },
    [targetId, n, t0] as const,
  );
}
/** In head + dwell: hold on a target long enough to select it at the default 2100 ms dwell. */
export const dwellOn = (page: Page, id: string, t: number): Promise<number> => lookAt(page, id, 100, t);
/** Starts head + dwell with synthetic samples: chooses the mode, runs the centre step, returns the time to continue from. */
export async function startHeadDwell(page: Page): Promise<number> {
  await chooseMode(page, 'head + dwell');
  const t0 = (await page.evaluate(() => performance.now())) + 300;
  return lookAt(page, 'centre', 60, t0);
}
/** Four Misses in head + dwell, alternating between two wrong letters (each stay selects once). */
export async function missFourByDwell(page: Page, t: number): Promise<number> {
  const a = await wrongId(page);
  const b = await wrongId(page, [a]);
  for (const id of [a, b, a, b]) t = await dwellOn(page, id, t);
  return t;
}
