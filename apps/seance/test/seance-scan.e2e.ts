/**
 * Séance with switch scanning (Space is the switch): a short Round to the Summary, Cancel with Escape, and
 * the camera never asked for. Runs under the `seance` and `seance-built` projects.
 */
import { expect, test, type Page } from '@playwright/test';
import { chooseMode, gum, nextId, open, summaryVisible, target, type HighlightDetail, type Win } from './seance-e2e-helpers';
test.describe('switch scanning', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const w = window as unknown as Win & { __cancels: number };
      const p = w.planchetteSeance.planchette;
      w.__cancels = 0;
      p.addEventListener('highlight', (e) => (w.__hl = e.detail as HighlightDetail));
      p.addEventListener('cancel', () => w.__cancels++);
      p.setProfile({ scanInterval: 600, scanLoopsBeforePause: 10 });
    });
    await chooseMode(page, 'scan');
    // Focus off the select, so Space is the switch and not a key for the control.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  });
  const hl = (page: Page) => page.evaluate(() => (window as unknown as Win).__hl);
  const press = async (page: Page): Promise<void> => {
    await page.keyboard.down(' ');
    await page.waitForTimeout(80);
    await page.keyboard.up(' ');
  };
  test('the default switch binding is Space', async ({ page }) => {
    expect(await page.evaluate(() => (window as unknown as Win).planchetteSeance.planchette.getProfile().switchBinding)).toBe(' ');
  });
  test('scanning reaches the next letter: Space enters its row, then selects it', async ({ page }) => {
    test.setTimeout(120_000);
    const first = (await nextId(page))!;
    const before = await page.locator('#spelled-letters .todo').count();
    // Press on the row that holds the next target, then on the target itself. A press that lands as the
    // highlight moves is just a Miss or a wasted press: loop until the letter is spelled.
    for (let guard = 0; guard < 200 && (await page.locator('#spelled-letters .todo').count()) === before; guard++) {
      const h = await hl(page);
      if (h?.kind === 'row' && h.targetIds.includes(first)) await press(page);
      else if (h?.kind === 'item' && h.targetId === first) await press(page);
      await page.waitForTimeout(40);
    }
    await expect(page.locator('#spelled-letters .todo')).toHaveCount(before - 1);
    expect(await gum(page)).toBe(0);
  });
  test('a whole Round with Space reaches the Summary, with the stronger cue shown when letters are missed', async ({ page }) => {
    test.setTimeout(240_000);
    for (let guard = 0; guard < 900 && !(await summaryVisible(page)); guard++) {
      const next = await nextId(page);
      const h = await hl(page);
      if (next !== null && h !== undefined) {
        if (h.kind === 'row' && h.targetIds.includes(next)) await press(page);
        else if (h.kind === 'item' && h.targetId === next) await press(page);
      }
      await page.waitForTimeout(40);
    }
    await expect(page.locator('#summary-section')).toBeVisible();
    await expect(page.locator('#spelled-letters')).toHaveText(/^Round complete: /);
    await expect(page.locator('#summary-dwell')).toHaveText('Input: Switch scanning.');
    await expect(target(page, 'carry-dwell')).toBeHidden();
    await expect(target(page, 'suggest-apply')).toBeHidden();
    expect(await gum(page)).toBe(0);
  });
  test('Escape cancels: back to the first row, nothing spelled', async ({ page }) => {
    await expect.poll(async () => (await hl(page))?.kind).toBe('row');
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => (window as unknown as Win & { __cancels: number }).__cancels)).toBe(1);
    await expect(page.locator('#spelled-letters .todo')).toHaveCount(3);
  });
});
