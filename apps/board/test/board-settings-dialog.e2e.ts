/**
 * Task 25.1: the Settings dialog in a real browser (Playwright, Chromium), mouse mode, the
 * camera never started. Runs in the `board` (dev server) and `board-built` (built output)
 * projects. Checks what jsdom cannot: the focus trap, Escape, focus return, that selecting
 * a target under the modal does nothing, the Controls row layout, and axe-core on the open
 * dialog. `getUserMedia` is wrapped only to count and refuse calls.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
type Win = { __gum: number; planchetteBoard: { planchette: { getTargets(): Array<{ id: string; rect: Box }> } } };

const SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
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

const gum = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as Win).__gum);
const dialogOpen = (page: Page): Promise<boolean> => page.evaluate(() => (document.getElementById('settings') as HTMLDialogElement).open);
const activeInfo = (page: Page): Promise<{ id: string; inDialog: boolean }> =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    return { id: a?.id ?? '', inDialog: a?.closest('#settings') != null };
  });

async function clickTarget(page: Page, id: string): Promise<void> {
  const box = (await page.locator(`[data-planchette-target="${id}"]`).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.waitForTimeout(30);
  await page.mouse.click(x, y);
}

test.describe('Settings dialog behaviour (1366x768)', () => {
  test.beforeEach(async ({ page }) => {
    await openBoard(page, SIZES[0]);
  });

  test('traps focus: Tab and Shift+Tab stay inside, and the page behind is unreachable', async ({ page }) => {
    await page.locator('#settings-button').click();
    expect(await dialogOpen(page)).toBe(true);
    const count = await page.evaluate(
      () => document.querySelectorAll('#settings input:not([disabled]), #settings select:not([disabled]), #settings textarea, #settings button:not([disabled])').length,
    );
    expect(count).toBeGreaterThan(40);
    const seen = new Set<string>();
    for (let i = 0; i < count + 5; i++) {
      await page.keyboard.press('Tab');
      const a = await activeInfo(page);
      expect(a.inDialog, `Tab ${i + 1}: focus on #${a.id}`).toBe(true);
      seen.add(a.id);
    }
    expect(seen.has('mode')).toBe(false);
    expect(seen.has('settings-button')).toBe(false);
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Shift+Tab');
      expect((await activeInfo(page)).inDialog, `Shift+Tab ${i + 1}`).toBe(true);
    }
    // Shift+Tab from the first control wraps within the dialog.
    await page.evaluate(() => {
      const first = document.querySelector<HTMLElement>('#settings input:not([disabled]), #settings select:not([disabled]), #settings button:not([disabled])')!;
      first.focus();
    });
    await page.keyboard.press('Shift+Tab');
    expect((await activeInfo(page)).inDialog, 'Shift+Tab from the first control').toBe(true);
    expect(await gum(page)).toBe(0);
  });

  test('Escape closes it and focus returns to the Settings button', async ({ page }) => {
    await page.locator('#settings-button').click();
    expect(await dialogOpen(page)).toBe(true);
    await page.keyboard.press('Escape');
    expect(await dialogOpen(page)).toBe(false);
    await expect(page.locator('#settings-button')).toBeFocused();
  });

  test('the Close button closes it and focus returns to the Settings button', async ({ page }) => {
    await page.locator('#settings-button').click();
    await page.locator('#settings-close').click();
    expect(await dialogOpen(page)).toBe(false);
    await expect(page.locator('#settings-button')).toBeFocused();
  });

  test('the About button shows About inside the same dialog, Back returns, Escape closes the whole dialog', async ({ page }) => {
    await page.locator('#settings-button').click();
    await page.locator('#about-button').click();
    await expect(page.locator('#about')).toBeVisible();
    await expect(page.locator('#about-version')).not.toBeEmpty();
    await page.locator('#about-back').click();
    await expect(page.locator('#about')).toBeHidden();
    await page.locator('#about-button').click();
    await page.keyboard.press('Escape');
    expect(await dialogOpen(page)).toBe(false);
    await expect(page.locator('#settings-button')).toBeFocused();
  });

  test('a click on a target under the open dialog changes nothing; the same click works after closing', async ({ page }) => {
    await clickTarget(page, 'core-i');
    await expect(page.locator('#message-bar')).toHaveText('I');
    await page.locator('#settings-button').click();
    const hit = await page.evaluate(() => {
      const d = document.getElementById('settings')!.getBoundingClientRect();
      const targets = (window as unknown as Win).planchetteBoard.planchette.getTargets();
      for (const t of targets) {
        const x = t.rect.x + t.rect.width / 2;
        const y = t.rect.y + t.rect.height / 2;
        if (x < d.left || x > d.right || y < d.top || y > d.bottom) continue;
        // Skip points that land on one of the dialog's own controls: the click should be a pure "under the modal" one.
        const el = document.elementFromPoint(x, y);
        if (el?.closest('button, input, select, textarea, a, label') != null) continue;
        return { id: t.id, x, y };
      }
      return null;
    });
    expect(hit, 'a registered target lies under the dialog, away from its controls').not.toBeNull();
    await page.mouse.move(hit!.x, hit!.y);
    await page.waitForTimeout(30);
    await page.mouse.click(hit!.x, hit!.y);
    await page.waitForTimeout(100);
    await expect(page.locator('#message-bar')).toHaveText('I');
    expect(await gum(page)).toBe(0);
    await page.locator('#settings-close').click();
    await clickTarget(page, 'core-can');
    await expect(page.locator('#message-bar')).toHaveText('I can');
    expect(await gum(page)).toBe(0);
  });

  test('Calibrate with the camera off keeps the dialog open and says why', async ({ page }) => {
    await page.locator('#settings-button').click();
    await page.locator('#calibrate').click();
    expect(await dialogOpen(page)).toBe(true);
    await expect(page.locator('#settings-message')).toContainText('Start camera first');
    expect(await gum(page)).toBe(0);
  });

  test('the open dialog has no axe-core violations, on the settings and on the About screen', async ({ page }) => {
    await page.locator('#settings-button').click();
    let result = await new AxeBuilder({ page }).analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    await page.locator('#about-button').click();
    result = await new AxeBuilder({ page }).analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    expect(await gum(page)).toBe(0);
  });
});

for (const size of SIZES) {
  test.describe(`${size.width}x${size.height} layout`, () => {
    test('the Controls row is one line and fits; the dialog fits or scrolls inside itself; the page does not scroll', async ({ page }) => {
      await openBoard(page, size);
      const m = await page.evaluate(() => {
        const rect = (sel: string): DOMRect => document.querySelector(sel)!.getBoundingClientRect();
        const row = document.querySelector<HTMLElement>('.controls-row')!;
        return {
          label: rect('.controls-row label'),
          select: rect('#mode'),
          button: rect('#settings-button'),
          rowScroll: row.scrollWidth,
          rowClient: row.clientWidth,
          lineHeight: parseFloat(getComputedStyle(row.querySelector('label')!).lineHeight),
          iw: innerWidth,
          ih: innerHeight,
        };
      });
      expect(Math.abs(m.label.top - m.select.top) <= 2 || Math.abs(m.label.top + m.label.height / 2 - (m.select.top + m.select.height / 2)) <= 2).toBe(true);
      const mid = (r: DOMRect): number => r.top + r.height / 2;
      expect(Math.abs(mid(m.label) - mid(m.select)), 'label and selector on one line').toBeLessThanOrEqual(2);
      expect(Math.abs(mid(m.button) - mid(m.select)), 'button and selector on one line').toBeLessThanOrEqual(2);
      expect(m.label.height, 'label does not wrap').toBeLessThanOrEqual(m.lineHeight * 1.5);
      expect(m.rowScroll, 'row does not overflow').toBeLessThanOrEqual(m.rowClient);
      expect(m.button.left >= 0 && m.button.right <= m.iw && m.button.top >= 0 && m.button.bottom <= m.ih, `Settings button inside the viewport: ${JSON.stringify(m.button)}`).toBe(true);
      expect(m.label.right).toBeLessThanOrEqual(m.select.left + 0.5);
      expect(m.select.right).toBeLessThanOrEqual(m.button.left + 0.5);

      await page.locator('#settings-button').click();
      const d = await page.evaluate(() => {
        const dlg = document.getElementById('settings')!;
        const r = dlg.getBoundingClientRect();
        return {
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
          overflowY: getComputedStyle(dlg).overflowY,
          dlgScroll: dlg.scrollHeight,
          dlgClient: dlg.clientHeight,
          sh: document.documentElement.scrollHeight,
          sw: document.documentElement.scrollWidth,
          ih: innerHeight,
          iw: innerWidth,
        };
      });
      expect(d.left >= 0 && d.top >= 0 && d.right <= d.iw && d.bottom <= d.ih, `dialog inside the viewport: ${JSON.stringify(d)}`).toBe(true);
      if (d.dlgScroll > d.dlgClient) expect(d.overflowY).toBe('auto');
      expect(d.sh, 'page does not scroll vertically').toBeLessThanOrEqual(d.ih);
      expect(d.sw, 'page does not scroll horizontally').toBeLessThanOrEqual(d.iw);
      expect(await gum(page)).toBe(0);
    });
  });
}

test('six suggestions use a second strip row and still fit 1920x1080; the Settings control saves the count for the next load', async ({ page }) => {
  await openBoard(page, SIZES[1]);
  await page.locator('#settings-button').click();
  const count = page.getByLabel('Number of suggestions');
  await count.fill('6');
  await count.dispatchEvent('change');
  await page.locator('#settings-close').click();
  await page.reload();
  await page.waitForLoadState('networkidle');
  const m = await page.evaluate(() => ({
    slots: document.querySelectorAll('#prediction-strip > button').length,
    strip: document.getElementById('prediction-strip')!.getBoundingClientRect().height,
    sh: document.documentElement.scrollHeight,
    ih: innerHeight,
    s: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--target-size')),
    g: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--target-gap')),
  }));
  expect(m.slots).toBe(6);
  expect(m.s, 'rendered cell size is read from the page').toBeGreaterThanOrEqual(96);
  expect(m.strip, 'two rows of --target-size and a --target-gap gap').toBeCloseTo(2 * m.s + m.g, 0);
  expect(m.sh).toBeLessThanOrEqual(m.ih);
  expect(await gum(page)).toBe(0);
});
