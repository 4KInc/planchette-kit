/**
 * Task 16.4 — the UI helpers in a real browser (Playwright, Chromium), driven only by
 * synthetic samples fed through `feedSamples`. No camera is used: the two camera failures
 * that need the camera API are made by replacing `getUserMedia` in the page.
 *
 * Also: no request leaves localhost (Req 2 AC 11), none goes to a googleapis.com host, and
 * axe-core finds no accessibility problem with each UI part showing.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { messages } from '../src/messages';

const PAGE = '/skeleton/test/e2e/ui-fixture.html';

type Win = { fixture: Record<string, (...a: never[]) => unknown> & { events: Array<[string, unknown]>; ringAtSelect: string[]; ringValues: string[] } };

const requests: string[] = [];

async function open(page: Page, options: Record<string, unknown> = {}): Promise<void> {
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(PAGE);
  await page.waitForSelector('body[data-ready="true"]');
  await page.evaluate((o) => (window as unknown as Win).fixture.setup(o as never), options);
}

const call = (page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(([n, a]) => (window as unknown as Win).fixture[n as string](...(a as never[])), [name, args] as const);

const ring = (page: Page) => page.locator('svg[data-planchette="dwell-ring"]');
const indicator = (page: Page) => page.locator('[data-planchette="tracking-indicator"]');

async function axe(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test.describe('dwell ring', () => {
  test('fills while the pointer rests on a target and is full at the select', async ({ page }) => {
    await open(page, { profile: { mode: 'head + dwell', dwellTime: 1000 } });
    await call(page, 'look', 60, 'centre'); // the start-up centre step
    await expect(ring(page)).toBeHidden();
    await call(page, 'look', 15, 'yes'); // about half the dwell time
    await expect(ring(page)).toBeVisible();
    await expect(ring(page)).toHaveAttribute('data-state', 'filling');
    const half = Number(await ring(page).getAttribute('data-progress'));
    expect(half).toBeGreaterThan(0.2);
    expect(half).toBeLessThan(0.8);
    await axe(page); // ring showing
    await call(page, 'look', 30, 'yes');
    const w = await page.evaluate(() => (window as unknown as Win).fixture);
    expect(w.ringAtSelect).toEqual(['1']);
    await expect(ring(page)).toHaveAttribute('data-state', 'selected');
    await expect(page.locator('.planchette-ring-tick')).toBeVisible();
    // The ring sits at the pointer.
    const box = await ring(page).boundingBox();
    const target = await page.locator('[data-planchette-target="yes"]').boundingBox();
    expect(box!.x + box!.width / 2).toBeGreaterThan(target!.x);
    expect(box!.x + box!.width / 2).toBeLessThan(target!.x + target!.width);
  });

  test('a gesture select (no dwell progress before it) also shows the full ring with the tick', async ({ page }) => {
    await open(page, { profile: { mode: 'head + gesture', cancelByHold: false } });
    await call(page, 'look', 60, 'centre');
    await call(page, 'look', 5, 'maybe');
    await call(page, 'look', 15, 'maybe', 1, 0.9); // jaw open: a press after the acceptance time
    const w = await page.evaluate(() => (window as unknown as Win).fixture);
    expect(w.events.filter(([t]) => t === 'select').map(([, d]) => (d as { source: string }).source)).toEqual(['gesture']);
    expect(w.ringAtSelect).toEqual(['1']);
    await expect(ring(page)).toHaveAttribute('data-state', 'selected');
    await expect(page.locator('.planchette-ring-tick')).toBeVisible();
  });

  test('progress is the arc length (a shape), drawn light on a dark outline', async ({ page }) => {
    await open(page, { profile: { mode: 'head + dwell', dwellTime: 1000 } });
    await call(page, 'look', 60, 'centre');
    await call(page, 'look', 15, 'no');
    const arc = page.locator('.planchette-ring-arc');
    const dash = Number(await arc.getAttribute('stroke-dasharray'));
    const offset = Number(await arc.getAttribute('stroke-dashoffset'));
    const progress = Number(await ring(page).getAttribute('data-progress'));
    expect(offset).toBeCloseTo(dash * (1 - progress), 3);
    expect(await page.locator('.planchette-ring-track').getAttribute('stroke')).toBe('#111');
    expect(await page.locator('.planchette-ring-edge').getAttribute('stroke')).toBe('#fff');
  });

  test('moves smoothly when motion is allowed: every progress value, with a transition', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await open(page, { profile: { mode: 'head + dwell', dwellTime: 1000 } });
    await call(page, 'look', 60, 'centre');
    await call(page, 'look', 45, 'yes');
    const w = await page.evaluate(() => (window as unknown as Win).fixture);
    const values = new Set(w.ringValues.filter((v) => v !== '0'));
    expect(values.size).toBeGreaterThan(10);
    await expect(ring(page)).toHaveAttribute('data-reduced-motion', 'false');
    expect(await page.locator('.planchette-ring-arc').evaluate((el) => getComputedStyle(el).transitionDuration)).not.toBe('0s');
  });

  test('with prefers-reduced-motion: static quarter steps, no transition, no pulse', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, { profile: { mode: 'head + dwell', dwellTime: 1000 } });
    await call(page, 'look', 60, 'centre');
    await call(page, 'look', 45, 'yes');
    const w = await page.evaluate(() => (window as unknown as Win).fixture);
    for (const v of w.ringValues) expect(['0', '0.25', '0.5', '0.75', '1']).toContain(v);
    expect(new Set(w.ringValues).size).toBeGreaterThanOrEqual(4);
    expect(w.ringAtSelect).toEqual(['1']);
    await expect(ring(page)).toHaveAttribute('data-reduced-motion', 'true');
    expect(await page.locator('.planchette-ring-arc').evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
    expect(await ring(page).evaluate((el) => el.getAnimations().length)).toBe(0);
  });
});

test.describe('scan highlight', () => {
  test('moves with the highlight events: thick outline plus fill, one target at a time', async ({ page }) => {
    await open(page, { profile: { mode: 'scan', scanInterval: 500, cancelByHold: false } });
    const order: string[] = [];
    for (let i = 0; i < 12; i++) {
      await call(page, 'keys', 32, false); // 512 ms: one scan step
      const marked = await page.locator('[data-planchette-highlight]').evaluateAll((els) =>
        els.map((el) => ({
          id: (el as HTMLElement).dataset.planchetteTarget ?? el.textContent,
          kind: el.getAttribute('data-planchette-highlight'),
          outlineWidth: getComputedStyle(el).outlineWidth,
          outlineStyle: getComputedStyle(el).outlineStyle,
          shadow: getComputedStyle(el).boxShadow,
        })),
      );
      const w = await page.evaluate(() => (window as unknown as Win).fixture);
      const last = w.events.filter(([t]) => t === 'highlight').at(-1)![1] as { kind: string; targetIds: string[] };
      if (last.kind === 'item' || last.kind === 'row') {
        expect(marked.map((m) => m.id).sort()).toEqual([...last.targetIds].sort());
      } else if (last.kind === 'none') {
        expect(marked).toHaveLength(0); // scanning paused: nothing highlighted
      } else {
        expect(marked).toHaveLength(1); // the virtual item's bar
      }
      for (const m of marked) {
        expect(parseFloat(m.outlineWidth)).toBeGreaterThanOrEqual(6); // the shape changes, not only the colour
        expect(m.outlineStyle).toBe('solid');
        expect(m.shadow).toContain('inset'); // the fill change
      }
      order.push(last.kind === 'item' || last.kind === 'row' ? last.targetIds.join('+') : last.kind);
    }
    // A 3 x 2 grid scans by rows: two rows, then the cancel item.
    expect(order).toContain('yes+no+maybe');
    expect(order).toContain('help+more+stop');
    expect(order).toContain('cancel');
  });

  test('the virtual Cancel item is drawn, and the highlight clears when it moves on', async ({ page }) => {
    await open(page, { profile: { mode: 'scan', scanInterval: 500, cancelByHold: false } });
    for (let i = 0; i < 10; i++) {
      const w = await page.evaluate(() => (window as unknown as Win).fixture);
      const last = w.events.filter(([t]) => t === 'highlight').at(-1)?.[1] as { kind: string } | undefined;
      if (last?.kind === 'cancel') break;
      await call(page, 'keys', 32, false);
    }
    const bar = page.locator('[data-planchette="scan-virtual-item"]');
    await expect(bar).toBeVisible();
    await expect(bar).toHaveText(messages.scanCancel);
    await expect(page.locator('[data-planchette-target][data-planchette-highlight]')).toHaveCount(0);
    await axe(page); // highlight on the virtual item
    await call(page, 'keys', 32, false);
    await expect(bar).toBeHidden();
    await expect(page.locator('[data-planchette-target][data-planchette-highlight]')).not.toHaveCount(0);
    await axe(page); // highlight on a row of targets
  });

  test('an element keeps its own styles after the highlight leaves it', async ({ page }) => {
    await open(page, { profile: { mode: 'scan', scanInterval: 500 } });
    const yes = page.locator('[data-planchette-target="yes"]');
    await call(page, 'keys', 1, false); // the first sample starts scanning at the first row
    await expect(yes).toHaveAttribute('data-planchette-highlight', 'row');
    await call(page, 'keys', 32, false);
    await expect(yes).not.toHaveAttribute('data-planchette-highlight', /.*/);
    expect(await yes.evaluate((el) => (el as HTMLElement).style.outline)).toBe('');
  });
});

test.describe('tracking indicator', () => {
  const textOf = (page: Page) => indicator(page).locator('p').textContent();

  test('face lost, low confidence and found, from synthetic camera samples', async ({ page }) => {
    await open(page, { profile: { mode: 'head + dwell' } });
    await call(page, 'look', 10, 'centre');
    await expect(indicator(page)).toHaveCount(0); // no camera on, nothing wrong
    await call(page, 'look', 3, null);
    await expect(indicator(page)).toHaveAttribute('role', 'status');
    expect(await textOf(page)).toBe(messages.lost);
    await axe(page);
    await call(page, 'look', 3, 'centre', 0.2);
    expect(await textOf(page)).toBe(messages.lowConfidence);
    await axe(page);
    await call(page, 'look', 40, 'centre', 1);
    await expect(indicator(page)).toHaveCount(0);
  });

  test('no-face timeout: its message and the three choices', async ({ page }) => {
    await open(page, { profile: { mode: 'head + dwell', noFaceTimeout: 3000 } });
    await call(page, 'look', 5, 'centre');
    await call(page, 'look', 100, null); // 3.3 s with no face
    expect(await textOf(page)).toBe(`${messages.failure['no-face-timeout']} ${messages.alternatives}`);
    await expect(indicator(page).getByRole('button')).toHaveText([messages.tryAgain, messages.useScanning, messages.useMouse]);
    await axe(page);
    await indicator(page).getByRole('button', { name: messages.useScanning }).click();
    const w = await page.evaluate(() => (window as unknown as Win).fixture);
    expect(w.events.filter(([t]) => t === 'mode-change').at(-1)![1]).toEqual({ mode: 'scan' });
  });

  test('permission denied: the browser refuses the camera (getUserMedia replaced, no camera used)', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')) },
      });
    });
    await open(page);
    await call(page, 'startCamera');
    expect(await textOf(page)).toBe(`${messages.failure.denied} ${messages.alternatives}`);
    await expect(indicator(page).getByRole('button')).toHaveCount(3);
    await axe(page);
    // Keyboard reach: the buttons take focus and show it.
    await indicator(page).getByRole('button', { name: messages.tryAgain }).focus();
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe(messages.tryAgain);
  });

  test('load failure: the model files are not where the page says (getUserMedia gives an empty stream)', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: () => Promise.resolve(new MediaStream()) } });
    });
    await open(page, { assetsUrl: '/no-such-folder/' });
    await call(page, 'startCamera');
    await expect(indicator(page).locator('p')).toHaveText(`${messages.failure['load-failed']} ${messages.alternatives}`, { timeout: 15_000 });
    await axe(page);
  });

  test('every failure message is plain text with no error code', async () => {
    for (const m of Object.values(messages.failure)) expect(m).not.toMatch(/Error|Exception|\d{3}|0x/);
  });
});

// Runs last (one worker, tests in file order): the requests of every test above.
test('no request left localhost, and none went to a googleapis.com host (Req 2 AC 11)', async () => {
  expect(requests.length).toBeGreaterThan(0);
  const hostOf = (u: string): string => (u.startsWith('data:') || u.startsWith('blob:') ? 'local' : new URL(u).hostname);
  const outside = requests.filter((u) => !['local', 'localhost', '127.0.0.1'].includes(hostOf(u)));
  expect(outside).toEqual([]);
  expect(requests.filter((u) => /(^|\.)googleapis\.com$/.test(hostOf(u)))).toEqual([]);
  // The load-failure test did try to fetch the head-tracking files, from this origin.
  expect(requests.some((u) => u.includes('/no-such-folder/'))).toBe(true);
});
