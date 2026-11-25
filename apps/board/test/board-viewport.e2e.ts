/**
 * Task 21.2: the Board fits the viewport (Req 14.1 to 14.5) and the Message bar keeps its
 * place (Req 13.9), at 1366x768 and 1920x1080, in mouse mode, in the Core view and in Spell
 * mode. Runs in the `board` (dev server) and `board-built` (built output) projects.
 *
 * `navigator.mediaDevices.getUserMedia` is wrapped only to count and refuse calls; no camera
 * is started.
 */
import { expect, test, type Page } from '@playwright/test';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
type Win = {
  __gum: number;
  planchetteBoard: { planchette: { getTargets(): Array<{ id: string; rect: Box }> } };
};

const SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

/** Core view: 36 grid targets + speak, backspace, clear, undo, spell, cancel, camera toggle, rest area. */
const CORE_TARGETS = 36 + 8;
/** Spell mode: 28 letter-board targets + the same 8. */
const SPELL_TARGETS = 28 + 8;

const REGIONS = [
  ['Message bar', '#message-bar'],
  ['prediction strip', '#prediction-strip'],
  ['action row', '.actions'],
  ['camera toggle and rest area', '.camera-rest'],
  ['Controls row', '.controls-row'],
  ['Status panel', '#status-panel'],
  ['rest area', '#rest-area'],
  ['notice', '#notice'],
] as const;

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
}

const inside = (r: Box, vw: number, vh: number): boolean =>
  r.x >= 0 && r.y >= 0 && r.x + r.width <= vw && r.y + r.height <= vh && r.width > 0 && r.height > 0;

/** Every check that applies to both views. `activeGrid` is the visible grid's selector. */
async function checkFits(page: Page, activeGrid: string, expectedTargets: number): Promise<void> {
  const vp = page.viewportSize()!;
  const m = await page.evaluate(() => ({
    sh: document.documentElement.scrollHeight,
    sw: document.documentElement.scrollWidth,
    ih: innerHeight,
    iw: innerWidth,
  }));
  expect(m.sh, 'scrollHeight <= innerHeight').toBeLessThanOrEqual(m.ih);
  expect(m.sw, 'scrollWidth <= innerWidth').toBeLessThanOrEqual(m.iw);

  const regions: Array<[string, string]> = [...REGIONS.map(([n, s]) => [n, s] as [string, string]), ['active grid', activeGrid]];
  for (const [name, sel] of regions) {
    const box = await page.locator(sel).boundingBox();
    expect(box, `${name} (${sel}) is rendered`).not.toBeNull();
    expect(inside(box!, vp.width, vp.height), `${name} inside ${vp.width}x${vp.height}: ${JSON.stringify(box)}`).toBe(true);
  }

  const targets = await page.evaluate(() => (window as unknown as Win).planchetteBoard.planchette.getTargets());
  expect(targets.length, 'registered targets').toBe(expectedTargets);
  const ids = targets.map((t) => t.id);
  for (const id of ['speak', 'backspace-action', 'clear', 'undo', 'spell-toggle', 'cancel', 'camera-toggle', 'rest-area']) {
    expect(ids, `target ${id}`).toContain(id);
  }
  for (const t of targets) {
    expect(inside(t.rect, vp.width, vp.height), `target ${t.id} inside ${vp.width}x${vp.height}: ${JSON.stringify(t.rect)}`).toBe(true);
  }

  const overflowing = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.target'))
      .filter((e) => e.offsetParent !== null)
      .filter((e) => e.scrollWidth > e.clientWidth || e.scrollHeight > e.clientHeight)
      .map((e) => `${e.dataset.planchetteTarget} "${e.textContent}" scroll ${e.scrollWidth}x${e.scrollHeight} client ${e.clientWidth}x${e.clientHeight}`),
  );
  expect(overflowing, 'targets whose content overflows').toEqual([]);
}

const barRect = async (page: Page): Promise<Box> => (await page.locator('#message-bar').boundingBox())!;

/** Click a target's centre with a real mouse (mouse mode selects on click). */
async function clickTarget(page: Page, id: string): Promise<void> {
  const box = (await page.locator(`[data-planchette-target="${id}"]`).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.waitForTimeout(30);
  await page.mouse.click(x, y);
}

for (const size of SIZES) {
  test.describe(`${size.width}x${size.height}`, () => {
    test('Core view and Spell mode fit the viewport; the Message bar stays put; no camera call', async ({ page }) => {
      await openBoard(page, size);

      // Core view.
      await expect(page.locator('#core-grid')).toBeVisible();
      await checkFits(page, '#core-grid', CORE_TARGETS);
      const longestCore = page.locator('[data-planchette-target="core-different"]');
      await expect(longestCore).toHaveText('different');
      await expect(longestCore).toBeVisible();
      const coreBar = await barRect(page);
      expect(coreBar.height).toBeGreaterThan(0);

      // Spell mode.
      await page.getByRole('button', { name: 'Spell' }).click();
      await expect(page.locator('#letter-grid')).toBeVisible();
      await expect(page.locator('#core-grid')).toBeHidden();
      await checkFits(page, '#letter-grid', SPELL_TARGETS);
      const backspaceKey = page.locator('[data-planchette-target="backspace"]');
      await expect(backspaceKey).toHaveText('⌫ Backspace');
      await expect(backspaceKey).toBeVisible();
      const spellBar = await barRect(page);
      expect(spellBar, 'Message bar rectangle is the same in both views').toEqual(coreBar);
      await expect(page.locator('#message-bar')).toBeVisible();

      // A message longer than the bar: back to the Core view, add "different" until it overflows.
      await page.getByRole('button', { name: 'Spell' }).click();
      await expect(page.locator('#core-grid')).toBeVisible();
      for (let i = 0; i < 60; i++) await clickTarget(page, 'core-different');
      const bar = await page.evaluate(() => {
        const el = document.getElementById('message-bar')!;
        return { text: el.textContent ?? '', sh: el.scrollHeight, ch: el.clientHeight, top: el.scrollTop };
      });
      expect(bar.sh, 'the message is longer than the bar').toBeGreaterThan(bar.ch);
      expect(bar.text.endsWith('different'), `bar text ends with the last word: "${bar.text.slice(-30)}"`).toBe(true);
      expect(bar.top + bar.ch, 'the bar is scrolled to its end').toBeGreaterThanOrEqual(bar.sh - 1);
      expect(await barRect(page), 'a long message does not move the bar').toEqual(coreBar);
      const after = await page.evaluate(() => ({
        sh: document.documentElement.scrollHeight,
        sw: document.documentElement.scrollWidth,
        ih: innerHeight,
        iw: innerWidth,
      }));
      expect(after.sh).toBeLessThanOrEqual(after.ih);
      expect(after.sw).toBeLessThanOrEqual(after.iw);
      await checkFits(page, '#core-grid', CORE_TARGETS);

      // The camera was never asked for.
      expect(await page.evaluate(() => (window as unknown as Win).__gum)).toBe(0);
    });
  });
}
