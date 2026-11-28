/**
 * axe-core finds no violation on any Séance view: the playing view at Support level 0 and at level 2 (with the
 * Suggestion open, in head + dwell), the Summary after a completed Round and after a stopped one, the open
 * Settings dialog (and its About screen), and the page with a camera-failure message showing. Also with
 * reduced motion requested. No camera, no sound.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { chooseMode, dwellOn, missFourByDwell, nextId, open, playToSummary, startHeadDwell, tap, target, wrongId, type Win } from './seance-e2e-helpers';
async function axe(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}
test.describe('axe on every view', () => {
  test('the playing view at Support level 0', async ({ page }) => {
    await open(page);
    await expect(page.locator('#board-section')).toBeVisible();
    await axe(page);
  });
  test('the playing view at level 2 (mouse mode, no Suggestion)', async ({ page }) => {
    await open(page);
    await chooseMode(page, 'mouse');
    const wrong = await wrongId(page);
    for (let i = 0; i < 4; i++) await tap(page, wrong);
    await expect(page.locator('.page')).toHaveAttribute('data-support', '2');
    await axe(page);
  });
  test('the playing view at level 2 with the Suggestion open (head + dwell)', async ({ page }) => {
    await open(page);
    let t = await startHeadDwell(page);
    t = await missFourByDwell(page, t);
    await expect(target(page, 'suggest-apply')).toBeVisible();
    await axe(page);
  });
  test('the Summary after a completed Round', async ({ page }) => {
    await open(page);
    await chooseMode(page, 'mouse');
    await playToSummary(page);
    await axe(page);
  });
  test('the Summary after a stopped Round', async ({ page }) => {
    await open(page);
    await chooseMode(page, 'mouse');
    await tap(page, (await nextId(page))!);
    await tap(page, 'stop');
    await expect(page.locator('#summary-section')).toBeVisible();
    await axe(page);
  });
  test('the Summary with Carry offered (head + dwell)', async ({ page }) => {
    await open(page);
    let t = await startHeadDwell(page);
    for (let i = 0; i < 3; i++) t = await dwellOn(page, (await nextId(page))!, t);
    await expect(target(page, 'carry-dwell')).toBeVisible();
    await axe(page);
  });
  test('the open Settings dialog and its About screen', async ({ page }) => {
    await open(page);
    await page.locator('#settings-button').click();
    await expect(page.locator('#settings')).toBeVisible();
    await axe(page);
    await page.locator('#about-button').click();
    await expect(page.locator('#about')).toBeVisible();
    await axe(page);
  });
  test('with a camera-failure message showing (permission denied)', async ({ page }) => {
    await open(page);
    await page.locator('[data-planchette-target="camera-toggle"]').click(); // a plain click starts the camera: it is refused
    await expect(page.locator('#camera-status')).not.toBeEmpty();
    await axe(page);
    expect(await page.evaluate(() => (window as unknown as Win).__gum)).toBe(1);
  });
  test('with reduced motion requested, and nothing is animating', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    await axe(page);
    const running = await page.evaluate(() => document.getAnimations().length);
    expect(running).toBe(0);
  });
  test('with motion allowed there is only the slow glow and fog (nothing faster than 3 s per cycle)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await open(page);
    const timings = await page.evaluate(() =>
      document.getAnimations().map((a) => (a.effect?.getComputedTiming().duration as number) ?? 0),
    );
    expect(timings.length).toBeGreaterThan(0);
    for (const d of timings) expect(d).toBeGreaterThanOrEqual(3000);
  });
});
