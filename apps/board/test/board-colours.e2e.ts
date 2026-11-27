/**
 * Task 27.1: colours and text size in a real browser (Playwright, Chromium), mouse mode, the
 * camera never started. Runs in the `board` and `board-built` projects. Covers what jsdom
 * cannot (board-colours.test.ts has the stylesheet-level checks): real computed font sizes,
 * the cascade with var(), :focus-visible rings, dashed placeholders, the views and dialogs the
 * app builds at run time, and that nothing animates. Contrast is the math from
 * skeleton/test/demo.e2e.ts. Text is 4.5:1, borders and focus rings are 3:1.
 */
import { expect, test, type Page } from '@playwright/test';

interface Audit {
  texts: number;
  borders: number;
  minText: { ratio: number; what: string };
  minBorder: { ratio: number; what: string };
  smallText: string[];
  animated: string[];
}

async function openBoard(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.addInitScript(() => {
    if (navigator.mediaDevices !== undefined) {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('no camera in the tests', 'NotFoundError'));
    }
  });
  await page.goto('/board/');
  await page.waitForLoadState('networkidle');
  await page.locator('#mode').selectOption('mouse');
}

/** Runs in the page: measures every visible text element and bordered UI part. */
function audit(): Audit {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = (c: number[]) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
  const ratio = (a: number[], b: number[]) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const parse = (css: string): number[] => (css.match(/rgba?\(([^)]+)\)/)![1].split(/[ ,/]+/).filter(Boolean).map(Number));
  const over = (top: number[], bottom: number[]) => {
    const a = top[3] ?? 1;
    return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a));
  };
  // The effective background: composite the translucent layers down to the first opaque one.
  const bgOf = (el: Element | null): number[] => {
    if (el === null) return [255, 255, 255];
    const c = parse(getComputedStyle(el).backgroundColor);
    const a = c[3] ?? 1;
    return a === 0 ? bgOf(el.parentElement) : a === 1 ? c : over(c, bgOf(el.parentElement));
  };
  const visible = (e: Element) => {
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && e.closest('.visually-hidden') === null;
  };
  const name = (e: Element) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : ''} "${(e.textContent ?? '').trim().slice(0, 18)}"`;
  const out: Audit = {
    texts: 0,
    borders: 0,
    minText: { ratio: 99, what: '' },
    minBorder: { ratio: 99, what: '' },
    smallText: [],
    animated: [],
  };
  // The open dialog covers the page, so when it is open only its content is measured.
  const root = document.querySelector<HTMLDialogElement>('dialog[open]') ?? document.body;
  const all = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const e of all) {
    if (!visible(e) || ['SCRIPT', 'STYLE', 'OPTION'].includes(e.tagName)) continue;
    const cs = getComputedStyle(e);
    // The dwell ring is the skeleton's own SVG, with its own reduced-motion handling (not a Board animation).
    if (e.closest('svg') !== null) continue;
    if (cs.transitionDuration.split(',').some((d) => parseFloat(d) > 0) || cs.animationName !== 'none') out.animated.push(name(e));
    const hasText = Array.from(e.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '');
    if (hasText || e.tagName === 'INPUT' || e.tagName === 'SELECT' || e.tagName === 'TEXTAREA') {
      const empty = e.tagName === 'BUTTON' && (e.textContent ?? '').trim() === '';
      if (!empty && e.tagName !== 'INPUT') {
        out.texts++;
        if (parseFloat(cs.fontSize) < 24) out.smallText.push(`${name(e)} ${cs.fontSize}`);
        const r = ratio(parse(cs.color), bgOf(e));
        if (r < out.minText.ratio) out.minText = { ratio: r, what: name(e) };
      }
      if (e.tagName === 'INPUT' && parseFloat(cs.fontSize) < 24) out.smallText.push(`${name(e)} ${cs.fontSize}`);
    }
    if (cs.borderTopStyle !== 'none' && parseFloat(cs.borderTopWidth) > 0) {
      out.borders++;
      const r = ratio(parse(cs.borderTopColor), bgOf(e.parentElement));
      if (r < out.minBorder.ratio) out.minBorder = { ratio: r, what: `${name(e)} ${cs.borderTopStyle}` };
    }
  }
  return out;
}

const seen: Record<string, { text: number; border: number }> = {};
async function check(page: Page, view: string): Promise<void> {
  const a = await page.evaluate(audit);
  seen[view] = { text: a.minText.ratio, border: a.minBorder.ratio };
  test.info().annotations.push({ type: 'ratios', description: `${view}: ${a.texts} texts min ${a.minText.ratio.toFixed(2)} (${a.minText.what}); ${a.borders} borders min ${a.minBorder.ratio.toFixed(2)} (${a.minBorder.what})` });
  console.log(`[colours] ${view}: texts=${a.texts} minText=${a.minText.ratio.toFixed(2)} (${a.minText.what}) borders=${a.borders} minBorder=${a.minBorder.ratio.toFixed(2)} (${a.minBorder.what})`);
  expect(a.texts, `${view}: texts measured`).toBeGreaterThan(3);
  expect(a.smallText, `${view}: text under 24px`).toEqual([]);
  expect(a.animated, `${view}: animated elements`).toEqual([]);
  expect(a.minText.ratio, `${view} text ${a.minText.what}`).toBeGreaterThanOrEqual(4.5);
  expect(a.minBorder.ratio, `${view} border ${a.minBorder.what}`).toBeGreaterThanOrEqual(3);
}

test.describe('Board colours and text size (Req 9)', () => {
  test('core grid, strip, bar, status, notice, controls', async ({ page }) => {
    await openBoard(page);
    await page.locator('[data-planchette-target="core-i"], #core-grid button').first().click();
    await check(page, 'core view (a word in the bar, strip with empty slots)');
    // Any running animation must belong to the skeleton's dwell ring (an SVG), never to the Board's own elements.
    const running = await page.evaluate(() =>
      document
        .getAnimations()
        .map((a) => (a.effect as KeyframeEffect | null)?.target as Element | null)
        .filter((t) => t !== null && t.closest('svg') === null)
        .map((t) => t!.tagName),
    );
    expect(running).toEqual([]);
  });

  test('Letter grid and Phrases view (disabled Previous / Next)', async ({ page }) => {
    await openBoard(page);
    await page.locator('[data-planchette-target="spell-toggle"]').click();
    await expect(page.locator('#letter-grid')).toBeVisible();
    await check(page, 'letter view (spell toggle pressed)');
    await page.locator('[data-planchette-target="spell-toggle"]').click();
    await page.locator('[data-planchette-target="phrases-toggle"]').click();
    await expect(page.locator('#phrases-grid')).toBeVisible();
    await check(page, 'phrases view');
    const disabled = page.locator('#phrases-grid [aria-disabled="true"]');
    expect(await disabled.count()).toBeGreaterThan(0);
    expect(await disabled.first().evaluate((e) => getComputedStyle(e).borderTopStyle)).toBe('dashed');
  });

  test('empty prediction slots are dashed', async ({ page }) => {
    await openBoard(page);
    // Rare letters leave the strip with fewer than four predictions.
    await page.locator('[data-planchette-target="spell-toggle"]').click();
    for (const l of ['q', 'z', 'x']) await page.locator(`#letter-grid button:text-is("${l}"), #letter-grid button:text-is("${l.toUpperCase()}")`).first().click();
    await expect(page.locator('#message-bar')).toContainText(/qzx/i);
    const empty = page.locator('#prediction-strip [data-empty="true"]');
    expect(await empty.count()).toBeGreaterThan(0);
    expect(await empty.first().evaluate((e) => getComputedStyle(e).borderTopStyle)).toBe('dashed');
  });

  test('camera status messages (stand-in elements, camera not started)', async ({ page }) => {
    await openBoard(page);
    // The real indicator needs a camera start or failure; these carry the same attributes the CSS targets.
    await page.evaluate(() => {
      const host = document.querySelector('#camera-status')!;
      host.innerHTML =
        '<div data-planchette="tracking-indicator" data-state="failed"><p>The camera could not start.</p><button type="button">Try again</button></div>';
    });
    await check(page, 'status panel failure state');
  });

  test('Settings dialog and About', async ({ page }) => {
    await openBoard(page);
    await page.locator('#settings-button').click();
    await expect(page.locator('#settings')).toHaveAttribute('open', '');
    await check(page, 'settings dialog');
    await page.locator('#about-button').click();
    await expect(page.locator('#about')).toBeVisible();
    await check(page, 'about screen');
  });

  test('keyboard focus ring is drawn, 3:1, on buttons, select and dialog controls', async ({ page }) => {
    await openBoard(page);
    const rings: Array<{ what: string; style: string; width: number; ratio: number }> = [];
    const measure = () =>
      page.evaluate(() => {
        const channel = (v: number) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        const lum = (c: number[]) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
        const parse = (css: string) => css.match(/rgba?\(([^)]+)\)/)![1].split(/[ ,/]+/).filter(Boolean).map(Number);
        const bgOf = (el: Element | null): number[] => {
          if (el === null) return [255, 255, 255];
          const c = parse(getComputedStyle(el).backgroundColor);
          return (c[3] ?? 1) === 0 ? bgOf(el.parentElement) : c;
        };
        const el = document.activeElement!;
        const cs = getComputedStyle(el);
        const [hi, lo] = [lum(parse(cs.outlineColor)), lum(bgOf(el.parentElement))].sort((x, y) => y - x);
        return { what: `${el.tagName.toLowerCase()}#${el.id}`, style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), ratio: (hi + 0.05) / (lo + 0.05) };
      });
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      rings.push(await measure());
    }
    await page.locator('#settings-button').focus();
    await page.keyboard.press('Enter');
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      rings.push(await measure());
    }
    console.log(`[colours] focus rings: ${rings.length} measured, min ${Math.min(...rings.map((r) => r.ratio)).toFixed(2)}`);
    for (const r of rings) {
      // Controls other than buttons use the browser's own :focus-visible ring (select, input); a button gets the 4 px --focus ring.
      expect(r.style, r.what).not.toBe('none');
      expect(r.width, r.what).toBeGreaterThan(0);
      expect(r.ratio, r.what).toBeGreaterThanOrEqual(3);
    }
  });
});
