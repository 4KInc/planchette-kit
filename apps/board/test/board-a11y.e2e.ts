/**
 * Task 28.1 — axe-core finds no violation on the Board's views: the core grid, the Spell
 * view, the Phrases view and the open Settings dialog. No camera is used.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function open(page: Page): Promise<void> {
  await page.goto('/board/');
  await page.waitForFunction(() => (window as unknown as { planchetteBoard?: unknown }).planchetteBoard !== undefined);
  await page.waitForLoadState('networkidle');
}

async function axe(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

/** A real pointer click on a target; in mouse mode the skeleton turns it into a select. */
async function tap(page: Page, id: string): Promise<void> {
  const box = (await page.locator(`[data-planchette-target="${id}"]`).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
}

test('the core grid view has no axe violations', async ({ page }) => {
  await open(page);
  await expect(page.locator('#core-grid')).toBeVisible();
  await axe(page);
});

test('the Spell view has no axe violations', async ({ page }) => {
  await open(page);
  await page.locator('#mode').selectOption('mouse');
  await tap(page, 'spell-toggle');
  await expect(page.locator('#letter-grid')).toBeVisible();
  await axe(page);
});

test('the Phrases view has no axe violations', async ({ page }) => {
  await open(page);
  await page.locator('#mode').selectOption('mouse');
  await tap(page, 'phrases-toggle');
  await expect(page.locator('#phrases-grid')).toBeVisible();
  await axe(page);
});

test('the open Settings dialog has no axe violations', async ({ page }) => {
  await open(page);
  await page.locator('#settings-button').click();
  await expect(page.locator('#settings')).toBeVisible();
  await axe(page);
});
