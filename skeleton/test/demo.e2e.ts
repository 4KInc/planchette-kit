/**
 * Task 17 — the demo page (and the two app stubs) in a real browser, under the dev server
 * and again from the production build (the `built` project in playwright.config.ts).
 *
 * Synthetic samples only: no real or fake camera. `navigator.mediaDevices.getUserMedia` is
 * wrapped only to COUNT calls (and to refuse them), so a page that starts the camera on
 * load is caught.
 *
 * Checks: the Content-Security-Policy on every page and no violation; nothing leaves
 * localhost; the camera starts only on the button; a dwell select and a scan select work
 * on the grid; axe finds nothing; the Halloween colours meet WCAG AA.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PAGES = ['/', '/board/', '/seance/'] as const;

interface Watch {
  requests: string[];
  consoleProblems: string[];
  pageErrors: string[];
}
type Win = {
  __csp: Array<{ directive: string; blocked: string }>;
  __gum: number;
  planchetteDemo: { planchette: import('@planchette/skeleton').Planchette };
};

/** Open a page with the watchers installed before any page script runs. */
async function open(page: Page, path: string): Promise<Watch> {
  const watch: Watch = { requests: [], consoleProblems: [], pageErrors: [] };
  page.on('request', (r) => watch.requests.push(r.url()));
  page.on('websocket', (w) => watch.requests.push(w.url()));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') watch.consoleProblems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => watch.pageErrors.push(String(e)));
  await page.addInitScript(() => {
    const w = window as unknown as Win;
    w.__csp = [];
    w.__gum = 0;
    document.addEventListener('securitypolicyviolation', (e) =>
      w.__csp.push({ directive: e.violatedDirective, blocked: e.blockedURI }),
    );
    if (navigator.mediaDevices !== undefined) {
      navigator.mediaDevices.getUserMedia = () => {
        w.__gum++;
        return Promise.reject(new DOMException('no camera in the tests', 'NotFoundError'));
      };
    }
  });
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  return watch;
}
const violations = (page: Page) => page.evaluate(() => (window as unknown as Win).__csp);
const cspProblems = (w: Watch) => w.consoleProblems.filter((t) => /content security policy|refused to/i.test(t));
const demo = (page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => {
    const p = (window as unknown as Win).planchetteDemo.planchette as unknown as Record<string, (...x: unknown[]) => unknown>;
    return p[f as string](...(a as unknown[]));
  }, [fn, args] as const);

/** Camera samples pointing at a target's centre (33 ms apart), plus the start-up centre step first. */
async function lookAt(page: Page, targetId: string | 'centre', n: number, t0: number): Promise<number> {
  return page.evaluate(
    ([id, count, start]) => {
      const planchette = (window as unknown as Win).planchetteDemo.planchette;
      let x = (innerWidth - 1) / 2;
      let y = (innerHeight - 1) / 2;
      if (id !== 'centre') {
        const r = document.querySelector(`[data-planchette-target="${id}"]`)!.getBoundingClientRect();
        x = r.x + r.width / 2;
        y = r.y + r.height / 2;
      }
      // Inverse of the default head mapping (R 15°, dead zone 0.5°, gain 1).
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

// ---------------------------------------------------------------------------

test.describe('Content-Security-Policy', () => {
  for (const path of PAGES) {
    test(`${path}: the policy is set, strict, and nothing violates it`, async ({ page }) => {
      const watch = await open(page, path);
      const content = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
      expect(content, 'the page has a CSP meta tag').not.toBeNull();
      const directives = new Map(
        content!.split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0] !== '').map(([name, ...values]) => [name, values] as const),
      );
      expect(directives.get('default-src')).toEqual(["'self'"]);
      expect(directives.get('connect-src')).toEqual(["'self'"]);
      // Scripts: same origin, plus WebAssembly compilation for MediaPipe. Nothing else.
      expect(directives.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"]);
      expect(content).not.toMatch(/unsafe-inline|(?<!wasm-)unsafe-eval|https?:|\*|data:|blob:/);
      expect([...directives.keys()].sort()).toEqual(['connect-src', 'default-src', 'script-src']);
      // The same policy on every page.
      expect(content).toBe("default-src 'self'; connect-src 'self'; script-src 'self' 'wasm-unsafe-eval'");
      // No inline script (the policy would block it).
      expect(await page.locator('script:not([src])').count()).toBe(0);
      expect(await violations(page)).toEqual([]);
      expect(cspProblems(watch)).toEqual([]);
      expect(watch.pageErrors).toEqual([]);
    });
  }

  test('the guard works: a script from a CDN is blocked and reported', async ({ page }) => {
    await open(page, '/');
    await page.evaluate(() => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/left-pad@1.3.0/index.js';
      document.head.appendChild(s);
    });
    await expect.poll(() => violations(page)).toEqual([expect.objectContaining({ directive: expect.stringContaining('script-src') })]);
  });
});

test.describe('the demo page', () => {
  test('loads with no console problems, and nothing leaves localhost', async ({ page }) => {
    const watch = await open(page, '/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('[data-planchette-target]')).toHaveCount(9 + 2 + 1); // grid, cancel and undo, rest area
    expect(watch.consoleProblems).toEqual([]);
    expect(watch.pageErrors).toEqual([]);
    expect(await violations(page)).toEqual([]);
    const outside = watch.requests.filter((u) => {
      const url = new URL(u);
      return /^(https?|wss?):$/.test(url.protocol) && url.hostname !== 'localhost';
    });
    expect(outside).toEqual([]);
    expect(watch.requests.length).toBeGreaterThan(0);
  });

  test('the camera is not started on load; only the button starts it', async ({ page }) => {
    const watch = await open(page, '/');
    expect(await page.evaluate(() => (window as unknown as Win).__gum)).toBe(0);
    expect(watch.requests.filter((u) => u.includes('/mediapipe/'))).toEqual([]);
    await expect(page.getByRole('button', { name: 'Start camera' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop camera' })).toBeHidden();
    await expect(page.locator('[data-planchette="tracking-indicator"]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as Win).planchetteDemo.planchette.getProfile().mode)).toBe('head + dwell');

    await page.getByRole('button', { name: 'Start camera' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as Win).__gum)).toBe(1);
    // This machine's camera request is refused: the indicator says so in plain words and
    // offers the other modes, and the Start button is back.
    await expect(page.locator('[data-planchette="tracking-indicator"]')).toContainText('No camera was found');
    await expect(page.getByRole('button', { name: 'Start camera' })).toBeVisible();
  });

  test('a dwell select works on the grid (head + dwell, synthetic samples)', async ({ page }) => {
    await open(page, '/');
    let t = await lookAt(page, 'centre', 60, 0); // the start-up centre step
    t = await lookAt(page, 'bat', 15, t);
    await expect(page.locator('svg[data-planchette="dwell-ring"]')).toBeVisible();
    expect(await page.locator('#log-list li').count()).toBe(0);
    await lookAt(page, 'bat', 30, t); // past the 1000 ms dwell time
    await expect(page.locator('#log-list li')).toHaveText(['Bat']);
    await expect(page.locator('#message')).toHaveText('Summoned: Bat.');
  });

  test('undo and cancel targets work by dwell', async ({ page }) => {
    await open(page, '/');
    let t = await lookAt(page, 'centre', 60, 0);
    t = await lookAt(page, 'moon', 45, t);
    await expect(page.locator('#log-list li')).toHaveText(['Moon']);
    t = await lookAt(page, 'rest', 10, t); // the rest area selects nothing
    expect(await page.locator('#log-list li').count()).toBe(1);
    t = await lookAt(page, 'undo', 45, t);
    await expect(page.locator('#log-list li')).toHaveCount(0);
    await lookAt(page, 'cancel', 45, t);
    await expect(page.locator('#message')).toHaveText('Cancelled. Nothing was added.');
  });

  test('a scan select works on the grid with the keyboard only, without the camera', async ({ page }) => {
    await open(page, '/');
    // The listener and the interval first, then the mode: scanning starts with the mode
    // change, and the first highlight (row 1) must not be missed. A long interval, so the
    // poll below (up to half a second late) still sees row 1 before it moves on.
    await page.evaluate(() => {
      const w = window as unknown as Win & { __hl: { kind: string; targetId: string; targetIds: string[] } };
      w.planchetteDemo.planchette.addEventListener('highlight', (e) => (w.__hl = e.detail));
    });
    await demo(page, 'setProfile', { scanInterval: 2500 });
    await page.locator('#mode').selectOption('scan');
    await page.locator('#rest').click(); // focus off the select, so Space is the switch
    const hl = () => page.evaluate(() => (window as unknown as { __hl?: { kind: string; targetId: string; targetIds: string[] } }).__hl);
    const press = async () => {
      await page.keyboard.down(' ');
      await page.waitForTimeout(120);
      await page.keyboard.up(' ');
    };
    // Row 1 (ghost, pumpkin, bat) is highlighted first: press to enter it, press on ghost.
    await expect.poll(async () => (await hl())?.targetIds?.[0]).toBe('ghost');
    expect((await hl())?.kind).toBe('row');
    await press();
    await expect.poll(async () => (await hl())?.kind).toBe('item');
    await expect.poll(async () => (await hl())?.targetId).toBe('ghost');
    await page.waitForTimeout(600); // a press inside the post-selection pause (500 ms) is ignored
    await press();
    await expect(page.locator('#log-list li')).toHaveText(['Ghost']);
  });

  test('mouse mode selects with a real quick click (down and up inside one frame), without the camera', async ({ page }) => {
    await open(page, '/');
    await page.locator('#mode').selectOption('mouse');
    // page.mouse.click sends pointerdown and pointerup back to back, like a trackpad tap.
    const box = (await page.locator('[data-planchette-target="witch"]').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(100);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('#log-list li')).toHaveText(['Witch']);
  });

  test('profile export and import round-trip through the box', async ({ page }) => {
    await open(page, '/');
    await page.getByRole('button', { name: 'Export profile' }).click();
    const json = JSON.parse(await page.locator('#profile-json').inputValue());
    expect(json.mode).toBe('head + dwell');
    json.mode = 'mouse';
    json.targetSize = 120;
    await page.locator('#profile-json').fill(JSON.stringify(json));
    await page.getByRole('button', { name: 'Import profile' }).click();
    await expect(page.locator('#mode')).toHaveValue('mouse');
    await expect(page.locator('[data-planchette-target="ghost"]')).toHaveCSS('min-width', '120px');
  });

  test('the calibration button asks for the camera first', async ({ page }) => {
    await open(page, '/');
    await page.getByRole('button', { name: 'Calibrate' }).click();
    await expect(page.locator('#message')).toContainText('press Start camera');
  });

  test('axe finds nothing: at rest, with the dwell ring and with the scan highlight', async ({ page }) => {
    await open(page, '/');
    const axe = async () => {
      const r = await new AxeBuilder({ page }).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    };
    await axe();
    const t = await lookAt(page, 'centre', 60, 0);
    await lookAt(page, 'skull', 15, t);
    await expect(page.locator('svg[data-planchette="dwell-ring"]')).toBeVisible();
    await axe();
    await page.locator('#mode').selectOption('scan');
    await page.locator('#rest').click();
    await expect(page.locator('[data-planchette="scan-virtual-item"], [data-planchette-target]').first()).toBeVisible();
    await axe();
  });
});

// ---------------------------------------------------------------------------
// WCAG 2.x contrast, from the real computed styles.

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function luminance([r, g, b]: number[]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function ratio(a: number[], b: number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function parseColour(css: string): number[] {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (m === null) throw new Error(`not a colour: ${css}`);
  return m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
}
function over(top: number[], bottom: number[]): number[] {
  const a = top[3] ?? 1;
  return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a));
}

test.describe('Halloween colours meet WCAG AA', () => {
  test('text 4.5:1, target outlines and focus ring 3:1, against the dark background', async ({ page }) => {
    await open(page, '/');
    const found = await page.evaluate(() => {
      const bgOf = (el: Element): string => {
        for (let e: Element | null = el; e !== null; e = e.parentElement) {
          const c = getComputedStyle(e).backgroundColor;
          if (!/rgba\(.*, 0\)|transparent/.test(c)) return c;
        }
        return 'rgb(255, 255, 255)';
      };
      const texts = Array.from(document.querySelectorAll('h1, h2, p, label, button, select, textarea, li, .target span'))
        .filter((e) => (e.textContent ?? '').trim() !== '' && (e as HTMLElement).offsetParent !== null)
        .map((e) => ({ what: e.tagName + (e.className ? '.' + e.className : '') + ' ' + (e.textContent ?? '').trim().slice(0, 20), fg: getComputedStyle(e).color, bg: bgOf(e) }));
      const outlines = Array.from(document.querySelectorAll('.target, button, select, textarea, .rest'))
        .filter((e) => (e as HTMLElement).offsetParent !== null)
        .map((e) => ({ what: e.tagName + ' ' + (e.textContent ?? '').trim().slice(0, 20), line: getComputedStyle(e).borderTopColor, bg: bgOf(e.parentElement!) }));
      return { texts, outlines, focus: getComputedStyle(document.documentElement).getPropertyValue('--focus').trim(), page: getComputedStyle(document.body).backgroundColor };
    });
    expect(found.texts.length).toBeGreaterThan(10);
    for (const t of found.texts) expect(ratio(parseColour(t.fg), parseColour(t.bg)), `text ${t.what}`).toBeGreaterThanOrEqual(4.5);
    for (const o of found.outlines) expect(ratio(parseColour(o.line), parseColour(o.bg)), `outline ${o.what}`).toBeGreaterThanOrEqual(3);
    const focus = found.focus.startsWith('#') ? found.focus : '';
    const rgb = [1, 3, 5].map((i) => parseInt(focus.slice(i, i + 2), 16));
    expect(ratio(rgb, parseColour(found.page)), 'focus ring').toBeGreaterThanOrEqual(3);
  });

  test('text on a scan-highlighted target (yellow tint over the target) stays above 4.5:1', async ({ page }) => {
    await open(page, '/');
    await page.locator('#mode').selectOption('scan');
    await demo(page, 'setProfile', { scanInterval: 500 });
    // Item highlight: select the first row so single items are highlighted (any frame has some highlight).
    await expect
      .poll(() => page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('.target')).some((e) => e.style.boxShadow !== '')))
      .toBe(true);
    const found = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll<HTMLElement>('.target')).find((e) => e.style.boxShadow !== '')!;
      return { fg: getComputedStyle(el.querySelector('span:last-child')!).color, bg: getComputedStyle(el).backgroundColor, shadow: getComputedStyle(el).boxShadow, outline: getComputedStyle(el).outlineColor };
    });
    const tint = found.shadow.match(/rgba\([^)]*\)[^,]*inset/)?.[0] ?? found.shadow.match(/inset[^,]*rgba\([^)]*\)/)?.[0];
    expect(tint, `an inset tint in "${found.shadow}"`).toBeDefined();
    const fill = over(parseColour(tint!), parseColour(found.bg));
    expect(ratio(parseColour(found.fg), fill)).toBeGreaterThanOrEqual(4.5);
  });
});
