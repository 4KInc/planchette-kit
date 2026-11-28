/**
 * Séance fits the viewport at 1366x768 and 1920x1080 (Requirements 6 and 9): no page scroll, every target
 * inside the viewport and at least the cell size, no label overflow, the Summary one panel that fills its area
 * with "Another round" inside it, the planchette clear of every label, and the fog without a visible edge.
 * Runs under the `seance` (dev server) and `seance-built` projects. No camera, no sound.
 */
import { expect, test, type Page } from '@playwright/test';
import { SIZES, chooseMode, dwellOn, gum, missFourByDwell, nextId, open, playToSummary, startHeadDwell, tap, target, wrongId, type Win } from './seance-e2e-helpers';
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
const REGIONS = [
  ['spelled line', '#spelled'],
  ['action row', '.actions'],
  ['camera row', '.camera-rest'],
  ['Controls row', '.controls-row'],
  ['Status panel', '#status-panel'],
  ['rest area', '#rest-area'],
  ['notice', '#notice'],
] as const;
async function targets(page: Page): Promise<Array<{ id: string; rect: Box }>> {
  return page.evaluate(() => (window as unknown as Win).planchetteSeance.planchette.getTargets().map((t) => ({ id: t.id, rect: t.rect })));
}
/** The page does not scroll, everything is inside the viewport, and every target is at least the cell size. */
async function checkFits(page: Page, size: (typeof SIZES)[number], expectedTargets: number): Promise<void> {
  const doc = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, iw: innerWidth, ih: innerHeight }));
  expect(doc.sh, 'no vertical scroll').toBeLessThanOrEqual(doc.ih);
  expect(doc.sw, 'no horizontal scroll').toBeLessThanOrEqual(doc.iw);
  for (const [name, selector] of REGIONS) {
    const b = (await page.locator(selector).boundingBox())!;
    expect(b, name).not.toBeNull();
    expect(b.x, name).toBeGreaterThanOrEqual(0);
    expect(b.y, name).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, name).toBeLessThanOrEqual(size.width + 0.5);
    expect(b.y + b.height, name).toBeLessThanOrEqual(size.height + 0.5);
  }
  const all = await targets(page);
  expect(all.length).toBe(expectedTargets);
  for (const { id, rect } of all) {
    expect(rect.x, id).toBeGreaterThanOrEqual(0);
    expect(rect.y, id).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width, id).toBeLessThanOrEqual(size.width + 0.5);
    expect(rect.y + rect.height, id).toBeLessThanOrEqual(size.height + 0.5);
    expect(rect.width, id).toBeGreaterThanOrEqual(size.cell - 0.5);
    expect(rect.height, id).toBeGreaterThanOrEqual(size.cell - 0.5);
  }
  // no label overflows its element
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.target')]
      .filter((el) => getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0)
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .map((el) => el.textContent),
  );
  expect(overflow).toEqual([]);
  // gaps between targets are at least the target spacing (16 px)
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]!.rect;
      const b = all[j]!.rect;
      const gapX = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
      const gapY = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
      expect(Math.max(gapX, gapY), `${all[i]!.id} and ${all[j]!.id}`).toBeGreaterThanOrEqual(16 - 0.5);
    }
}
for (const size of SIZES) {
  test.describe(`${size.width}x${size.height}`, () => {
    test('the playing view: 35 targets, cell size and positions as designed, no scroll', async ({ page }) => {
      await open(page, size);
      await chooseMode(page, 'mouse');
      await checkFits(page, size, 35);
      const rects = new Map((await targets(page)).map((t) => [t.id, t.rect]));
      const cellW = (8 * size.cell + 5 * 16 - 6 * 16) / 7; // (grid width - 6 gaps) / 7
      expect(rects.get('letter-a')!.width).toBeCloseTo(cellW, 0);
      expect(rects.get('letter-a')!.height).toBeCloseTo(size.cell, 0);
      expect(rects.get('yes')!.width).toBeCloseTo(3 * cellW + 32, 0);
      expect(rects.get('goodbye')!.width).toBeCloseTo(5 * cellW + 64, 0);
      expect(await gum(page)).toBe(0);
    });
    test('the board positions do not change with the Support level or a new Round', async ({ page }) => {
      await open(page, size);
      await chooseMode(page, 'mouse');
      const before = new Map((await targets(page)).filter((t) => t.id.startsWith('letter-') || ['yes', 'no', 'goodbye'].includes(t.id)).map((t) => [t.id, t.rect]));
      const wrong = await wrongId(page);
      for (let i = 0; i < 4; i++) await tap(page, wrong);
      await expect(page.locator('.page')).toHaveAttribute('data-support', '2');
      await playToSummary(page);
      await tap(page, 'next-round');
      await expect(page.locator('#board-section')).toBeVisible();
      // the pointer still rests where "Another round" was, over GOODBYE: the arrival guard holds GOODBYE until it moves
      await page.mouse.move(5, 5);
      await expect.poll(async () => (await targets(page)).some((t) => t.id === 'goodbye')).toBe(true);
      const after = new Map((await targets(page)).map((t) => [t.id, t.rect]));
      for (const [id, rect] of before) expect(after.get(id), id).toEqual(rect);
    });
    test('the Summary (completed) is one panel that fills the area, with "Another round" inside it', async ({ page }) => {
      await open(page, size);
      await chooseMode(page, 'mouse');
      await playToSummary(page);
      await checkFits(page, size, 7);
      const panel = (await page.locator('#summary').boundingBox())!;
      expect(panel.height).toBeCloseTo(6 * size.cell + 5 * 16, 0);
      const next = (await target(page, 'next-round').boundingBox())!;
      expect(next.x).toBeGreaterThanOrEqual(panel.x);
      expect(next.x + next.width).toBeLessThanOrEqual(panel.x + panel.width);
      expect(next.y + next.height).toBeLessThanOrEqual(panel.y + panel.height);
      // the figures take the space: no large empty panel
      const stats = (await page.locator('.stats').boundingBox())!;
      expect(stats.height).toBeGreaterThanOrEqual(0.2 * panel.height);
      expect(stats.height).toBeLessThanOrEqual(0.5 * panel.height); // the cards are not stretched into big empty boxes
      const detailsBottom = await page.evaluate(() => {
        const shown = [...document.querySelectorAll<HTMLElement>('#summary .details, #summary .carry-text')].filter((e) => e.getClientRects().length > 0 && (e.textContent ?? '') !== '');
        return shown[shown.length - 1]!.getBoundingClientRect().bottom;
      });
      expect(next.y - detailsBottom, 'free space above the actions').toBeLessThanOrEqual(2 * size.cell);
    });
    test('the Summary (stopped) fits', async ({ page }) => {
      await open(page, size);
      await chooseMode(page, 'mouse');
      await tap(page, (await nextId(page))!);
      await tap(page, 'stop');
      await expect(page.locator('#summary-section')).toBeVisible();
      await checkFits(page, size, 7);
    });
    test('head + dwell: the Suggestion open (37 targets) and the Summary with Carry (8) fit, and the actions are three gaps apart', async ({ page }) => {
      await open(page, size);
      let t = await startHeadDwell(page);
      t = await missFourByDwell(page, t);
      await expect(target(page, 'suggest-apply')).toBeVisible();
      await checkFits(page, size, 37);
      // the Suggestion uses the reserved slots: the side column kept its rows
      const stop = (await target(page, 'stop').boundingBox())!;
      expect(stop.y).toBeCloseTo(8 + size.cell + 16, 0);
      for (let i = 0; i < 3; i++) t = await dwellOn(page, (await nextId(page))!, t);
      await expect(target(page, 'carry-dwell')).toBeVisible();
      await checkFits(page, size, 8);
      const carry = (await target(page, 'carry-dwell').boundingBox())!;
      const next = (await target(page, 'next-round').boundingBox())!;
      expect(next.x - (carry.x + carry.width), 'the two actions are three gaps apart').toBeGreaterThanOrEqual(3 * 16 - 0.5);
    });
    test('the planchette sits in the corner of the next target, clear of its label, at levels 0 and 2', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' }); // the glide is a jump, so the position is final at once
      await open(page, size);
      await chooseMode(page, 'mouse');
      const measure = async (): Promise<{ glide: Box; cell: Box; label: Box }> =>
        page.evaluate(() => {
          const next = document.querySelector<HTMLElement>('[data-next="true"]')!;
          const g = document.getElementById('glide')!.getBoundingClientRect();
          const c = next.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(next);
          const l = range.getBoundingClientRect();
          return {
            glide: { x: g.x, y: g.y, width: g.width, height: g.height },
            cell: { x: c.x, y: c.y, width: c.width, height: c.height },
            label: { x: l.x, y: l.y, width: l.width, height: l.height },
          };
        });
      const clear = (m: { glide: Box; cell: Box; label: Box }): void => {
        const { glide: g, cell: c, label: l } = m;
        expect(g.x).toBeGreaterThanOrEqual(c.x);
        expect(g.y).toBeGreaterThanOrEqual(c.y);
        expect(g.x + g.width).toBeLessThanOrEqual(c.x + c.width);
        expect(g.y + g.height).toBeLessThanOrEqual(c.y + c.height);
        const overlapX = Math.min(g.x + g.width, l.x + l.width) - Math.max(g.x, l.x);
        const overlapY = Math.min(g.y + g.height, l.y + l.height) - Math.max(g.y, l.y);
        expect(overlapX > 0 && overlapY > 0, 'the glyph covers the label').toBe(false);
        // the same corner offsets every time: 6 px from the right edge, 4 px from the top
        expect(c.x + c.width - (g.x + g.width)).toBeCloseTo(6, 0);
        expect(g.y - c.y).toBeCloseTo(4, 0);
      };
      for (let step = 0; step < 2; step++) {
        const m = await measure();
        expect(m.glide.width).toBe(24);
        clear(m);
        await tap(page, (await nextId(page))!);
      }
      const wrong = await wrongId(page);
      for (let i = 0; i < 4; i++) await tap(page, wrong);
      await expect(page.locator('.page')).toHaveAttribute('data-support', '2');
      const m2 = await measure();
      expect(m2.glide.width).toBe(28);
      clear(m2);
    });
    test('the planchette clears the label of every one of the 29 targets at both glyph sizes (geometry)', async ({ page }) => {
      await open(page, size);
      const bad = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of document.querySelectorAll<HTMLElement>('#board .target')) {
          const c = el.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(el);
          const l = range.getBoundingClientRect();
          for (const s of [24, 28]) {
            const gx = c.x + c.width - s - 6;
            const gy = c.y + 4;
            const ox = Math.min(gx + s, l.x + l.width) - Math.max(gx, l.x);
            const oy = Math.min(gy + s, l.y + l.height) - Math.max(gy, l.y);
            if (ox > 0 && oy > 0) out.push(`${el.dataset.planchetteTarget}@${s}`);
          }
        }
        return out;
      });
      expect(bad).toEqual([]);
    });
    test('the fog has no visible edge or band: smooth gradients only', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await open(page, size);
      await page.evaluate(() => {
        document.querySelector<HTMLElement>('.page')!.style.visibility = 'hidden';
      });
      const png = (await page.screenshot()).toString('base64');
      const worst = await page.evaluate(async (b64) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = document.createElement('canvas');
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bmp, 0, 0);
        const { data, width, height } = ctx.getImageData(0, 0, bmp.width, bmp.height);
        // Chrome dithers gradients by a level or two, so compare the average of 6 px on each side of every point:
        // a real edge or band (the old linear fog stepped by about 11 levels) shows, dither and slope do not.
        const W = 6;
        let max = 0;
        const px = (x: number, y: number, c: number): number => data[(y * width + x) * 4 + c]!;
        const mean = (xs: number[], ys: number[], c: number): number => xs.reduce((a, x, i) => a + px(x, ys[i]!, c), 0) / xs.length;
        const range = (n: number, from: number): number[] => Array.from({ length: n }, (_, i) => from + i);
        for (const x of [40, Math.floor(width / 2), width - 40])
          for (let y = W; y < height - W; y++)
            for (let c = 0; c < 3; c++) {
              const above = mean(Array(W).fill(x), range(W, y - W), c);
              const below = mean(Array(W).fill(x), range(W, y), c);
              max = Math.max(max, Math.abs(below - above));
            }
        for (const y of [40, Math.floor(height / 2), height - 40])
          for (let x = W; x < width - W; x++)
            for (let c = 0; c < 3; c++) {
              const left = mean(range(W, x - W), Array(W).fill(y), c);
              const right = mean(range(W, x), Array(W).fill(y), c);
              max = Math.max(max, Math.abs(right - left));
            }
        return max;
      }, png);
      expect(worst, 'largest step between the 6 px averages either side of a point (0 to 255)').toBeLessThanOrEqual(2);
    });
  });
}
