/**
 * Task 33.4: the Message bar's text size and height (Req 14 AC 14 to 17), design.md "Message bar text",
 * at 1366x768 and 1920x1080, in mouse mode. Runs in the `board` (dev server) and `board-built` (built output)
 * projects.
 *
 * `navigator.mediaDevices.getUserMedia` is wrapped only to count and refuse calls; no camera is started.
 */
import { expect, test, type Page } from '@playwright/test';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
type Win = { __gum: number };

const SMALL = { width: 1366, height: 768 } as const;
const LARGE = { width: 1920, height: 1080 } as const;

async function openBoard(page: Page, size: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(size);
  await page.addInitScript(() => {
    const w = window as unknown as Win;
    w.__gum = 0;
    if (navigator.mediaDevices !== undefined) {
      navigator.mediaDevices.getUserMedia = () => {
        w.__gum++;
        return Promise.reject(new DOMException('no camera in the tests', 'NotFoundError'));
      };
    }
  });
  await page.goto('/board/');
  await page.waitForLoadState('networkidle');
  await page.locator('#mode').selectOption('mouse');
  await expect(page.locator('#mode')).toHaveValue('mouse');
  await expect(page.locator('#core-grid')).toBeVisible();
}

/** Click a target's centre with a real mouse (mouse mode selects on click). */
async function clickTarget(page: Page, id: string): Promise<void> {
  const box = (await page.locator(`[data-planchette-target="${id}"]`).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.waitForTimeout(30);
  await page.mouse.click(x, y);
}

interface BarMetrics {
  fontSize: number;
  bodyFontSize: number;
  lineHeight: number;
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
  clientWidth: number;
  scrollWidth: number;
  offsetHeight: number;
  text: string;
  pageScrollH: number;
  pageScrollW: number;
  innerH: number;
  innerW: number;
}

const metrics = (page: Page): Promise<BarMetrics> =>
  page.evaluate(() => {
    const el = document.getElementById('message-bar')!;
    const cs = getComputedStyle(el);
    const de = document.documentElement;
    return {
      fontSize: parseFloat(cs.fontSize),
      bodyFontSize: parseFloat(getComputedStyle(document.body).fontSize),
      lineHeight: parseFloat(cs.lineHeight),
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      offsetHeight: el.offsetHeight,
      text: el.textContent ?? '',
      pageScrollH: de.scrollHeight,
      pageScrollW: de.scrollWidth,
      innerH: innerHeight,
      innerW: innerWidth,
    };
  });

const barRect = async (page: Page): Promise<Box> => (await page.locator('#message-bar').boundingBox())!;
const pageHeight = async (page: Page): Promise<number> => (await page.locator('.page').boundingBox())!.height;

function expectNoPageScroll(m: BarMetrics): void {
  expect(m.pageScrollH, 'document scrollHeight <= innerHeight').toBeLessThanOrEqual(m.innerH);
  expect(m.pageScrollW, 'document scrollWidth <= innerWidth').toBeLessThanOrEqual(m.innerW);
}

/** Core, then Spell, then Phrases, then Core again; returns the bar rectangle and `.page` height in each. */
async function viewRects(page: Page): Promise<Array<{ view: string; bar: Box; pageH: number }>> {
  const out: Array<{ view: string; bar: Box; pageH: number }> = [];
  out.push({ view: 'core', bar: await barRect(page), pageH: await pageHeight(page) });
  await clickTarget(page, 'spell-toggle');
  await expect(page.locator('#letter-grid')).toBeVisible();
  out.push({ view: 'spell', bar: await barRect(page), pageH: await pageHeight(page) });
  await clickTarget(page, 'spell-toggle');
  await expect(page.locator('#core-grid')).toBeVisible();
  await clickTarget(page, 'phrases-toggle');
  await expect(page.locator('#phrases-grid')).toBeVisible();
  out.push({ view: 'phrases', bar: await barRect(page), pageH: await pageHeight(page) });
  await clickTarget(page, 'phrases-toggle');
  await expect(page.locator('#core-grid')).toBeVisible();
  return out;
}

function expectSameInViews(views: Array<{ view: string; bar: Box; pageH: number }>, label: string): void {
  for (const v of views) {
    expect(v.bar, `Message bar rectangle in ${v.view} (${label})`).toEqual(views[0]!.bar);
    expect(v.pageH, `.page height in ${v.view} (${label})`).toBe(views[0]!.pageH);
  }
}

for (const size of [SMALL, LARGE]) {
  test.describe(`${size.width}x${size.height} Message bar text`, () => {
    test('the text is at least twice the body text', async ({ page }) => {
      await openBoard(page, size);
      const m = await metrics(page);
      expect(m.fontSize, `bar ${m.fontSize}px, body ${m.bodyFontSize}px`).toBeGreaterThanOrEqual(2 * m.bodyFontSize);
      expect(m.bodyFontSize).toBeGreaterThanOrEqual(24);
      expect(await page.evaluate(() => (window as unknown as Win).__gum)).toBe(0);
    });

    test('the bar keeps its rectangle and the .page box its height in the three views, before and after a long message', async ({ page }) => {
      await openBoard(page, size);
      const before = await viewRects(page);
      expectSameInViews(before, 'before');
      for (let i = 0; i < 60; i++) await clickTarget(page, 'core-different');
      expect((await metrics(page)).text.endsWith('different')).toBe(true);
      const after = await viewRects(page);
      expectSameInViews(after, 'after');
      expect(after[0]!.bar, 'a long message does not move the bar').toEqual(before[0]!.bar);
      expect(after[0]!.pageH).toBe(before[0]!.pageH);
      expectNoPageScroll(await metrics(page));
      console.log(`bar rect ${size.width}x${size.height}: ${JSON.stringify(before[0]!.bar)}, .page height ${before[0]!.pageH}`);
      expect(await page.evaluate(() => (window as unknown as Win).__gum)).toBe(0);
    });
  });
}

test.describe('1920x1080 two-line Message bar', () => {
  test('a two-line message wraps inside the bar; a longer one scrolls to its end showing two full lines', async ({ page }) => {
    await openBoard(page, LARGE);
    const empty = await metrics(page);
    console.log(
      `1920x1080 bar: offsetHeight ${empty.offsetHeight}, clientHeight ${empty.clientHeight}, line-height ${empty.lineHeight}, font ${empty.fontSize}px`,
    );
    expect(empty.offsetHeight, 'bar height').toBe(131);
    expect(empty.clientHeight, 'bar clientHeight is at least two line heights').toBeGreaterThanOrEqual(2 * empty.lineHeight - 0.5);

    // Add Core words until the text needs a second line.
    // (An empty bar's scrollHeight equals its clientHeight, so lines are counted from the text's own line boxes.)
    const textLines = (): Promise<number> =>
      page.evaluate(() => {
        const range = document.createRange();
        range.selectNodeContents(document.getElementById('message-bar')!);
        return new Set(Array.from(range.getClientRects()).filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
      });
    let words = 0;
    while ((await textLines()) < 2 && words < 60) {
      await clickTarget(page, 'core-different');
      words++;
    }
    const m0 = await metrics(page);
    expect(await textLines(), `a second line after ${words} words`).toBe(2);
    expect(words, 'the message started empty').toBeGreaterThan(1);
    let m = m0;
    expect(m.scrollHeight, `two lines fit: scrollHeight ${m.scrollHeight}, clientHeight ${m.clientHeight}`).toBeLessThanOrEqual(m.clientHeight);
    expect(m.clientHeight, 'clientHeight >= 2 x line height').toBeGreaterThanOrEqual(2 * m.lineHeight - 0.5);
    expect(m.scrollWidth, 'no horizontal overflow').toBeLessThanOrEqual(m.clientWidth);
    expectNoPageScroll(m);
    console.log(`1920x1080 two-line message (${words} words): scrollHeight ${m.scrollHeight}, clientHeight ${m.clientHeight}, scrollWidth ${m.scrollWidth}/${m.clientWidth}`);

    // A longer message: scrolled to the end, exactly two whole lines visible.
    for (let i = 0; i < 40; i++) await clickTarget(page, 'core-different');
    m = await metrics(page);
    expect(m.scrollHeight, 'longer than the bar').toBeGreaterThan(m.clientHeight);
    expect(Math.abs(m.scrollTop + m.clientHeight - m.scrollHeight), `scrolled to its end: ${m.scrollTop} + ${m.clientHeight} vs ${m.scrollHeight}`).toBeLessThanOrEqual(1);
    expect(Math.abs(m.clientHeight / m.lineHeight - 2), 'two lines visible').toBeLessThan(0.02);
    const offset = m.scrollTop / m.lineHeight;
    expect(Math.abs(offset - Math.round(offset)), `scrollTop ${m.scrollTop} is a whole number of lines: no sliver of the line above`).toBeLessThan(0.02);
    expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth);
    expectNoPageScroll(m);
    expect(m.text.endsWith('different')).toBe(true);
    expect(await page.evaluate(() => (window as unknown as Win).__gum)).toBe(0);
  });
});

test.describe('1366x768 one-line Message bar', () => {
  test('the bar is 80 px with one visible line; a long message scrolls to its last line', async ({ page }) => {
    await openBoard(page, SMALL);
    const empty = await metrics(page);
    expect(empty.offsetHeight, 'bar height').toBe(80);
    expect(Math.abs(empty.clientHeight - empty.lineHeight), `clientHeight ${empty.clientHeight} equals one line height ${empty.lineHeight}`).toBeLessThanOrEqual(0.5);

    for (let i = 0; i < 60; i++) await clickTarget(page, 'core-different');
    const m = await metrics(page);
    console.log(
      `1366x768 bar: offsetHeight ${m.offsetHeight}, clientHeight ${m.clientHeight}, line-height ${m.lineHeight}, scrollHeight ${m.scrollHeight}, scrollTop ${m.scrollTop}`,
    );
    expect(m.scrollHeight, 'the message is longer than the bar').toBeGreaterThan(m.clientHeight);
    expect(Math.abs(m.scrollTop + m.clientHeight - m.scrollHeight), 'scrolled to its end').toBeLessThanOrEqual(1);
    const offset = m.scrollTop / m.lineHeight;
    expect(Math.abs(offset - Math.round(offset)), `scrollTop ${m.scrollTop} is a whole number of lines: no sliver of the line above`).toBeLessThan(0.02);
    expect(Math.abs(m.clientHeight / m.lineHeight - 1), 'one line visible').toBeLessThan(0.02);
    expect(m.text.endsWith('different'), 'the last word is shown').toBe(true);
    expectNoPageScroll(m);
    expect(await page.evaluate(() => (window as unknown as Win).__gum)).toBe(0);
  });
});
