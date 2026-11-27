/**
 * Task 30.5: during a partial dwell the label stays visible and the dwell outline follows the
 * cell (Req 9 AC 11 to 13). Runs in the `board` and `board-built` projects.
 *
 * Mouse mode never emits `dwell-progress` (a click selects), so the dwell is driven in head +
 * dwell mode with synthetic camera samples through `window.planchetteBoard.planchette.feedSamples`,
 * the way skeleton/test/demo.e2e.ts does with `lookAt`. The camera is never started:
 * `getUserMedia` is wrapped to count and refuse calls, and every test asserts zero calls.
 * Views are reached in mouse mode (a click), then the mode is changed to head + dwell.
 *
 * At 1366x768 (96 px cells) and 1920x1080 (scaled cells), for the widest label of each view:
 *  - the label's text box clears the drawn strokes (the innermost stroke band, read from the
 *    outline's own rects), which for "⌫ Backspace" is the tight case (design.md: about 0.5 px);
 *  - `document.elementFromPoint` at the label's centre returns the button, never the outline;
 *  - every outline rect has a computed fill of `none`;
 *  - the outline's box equals the cell's border box, and nothing reflows (cell size, every region);
 *  - after a window resize, mid-dwell, the outline's box equals the cell's new box.
 */
import { expect, test, type Page } from '@playwright/test';

type Win = {
  __gum: number;
  __t: number;
  planchetteBoard: {
    planchette: {
      feedSamples(samples: unknown[]): void;
      getProfile(): { dwellTime: number };
    };
  };
};

const SIZES = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
] as const;

const REGIONS = ['#message-bar', '#prediction-strip', '.actions', '.camera-rest', '.controls-row', '#status-panel', '#rest-area', '#notice'];

const DWELL_RING = 'svg[data-planchette="dwell-ring"][data-shape="outline"]';

async function openBoard(page: Page, size: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(size);
  await page.addInitScript(() => {
    const w = window as unknown as Win;
    w.__gum = 0;
    w.__t = 0;
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

/** A real click on a target's centre (mouse mode selects on click), used only to change view. */
async function clickTarget(page: Page, id: string): Promise<void> {
  const box = (await page.locator(`[data-planchette-target="${id}"]`).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(100);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Head + dwell mode and the start-up centre step (60 samples of the head at rest). */
async function startHeadDwell(page: Page): Promise<void> {
  await page.locator('#mode').selectOption('head + dwell');
  await expect(page.locator('#mode')).toHaveValue('head + dwell');
  await lookAt(page, 'centre', 60);
}

/** Camera samples pointing at a target's centre (33 ms apart). Time carries on in `window.__t`. */
async function lookAt(page: Page, targetId: string | 'centre', n: number): Promise<void> {
  await page.evaluate(
    ([id, count]) => {
      const w = window as unknown as Win;
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
      let t = w.__t;
      for (let i = 0; i < (count as number); i++) {
        samples.push({
          now: (t += 33),
          source: 'camera' as const,
          faces: [{ bbox: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.3 }, rotation, confidence: 1, gestureScores: { jawOpen: 0, browRaise: 0 } }],
        });
      }
      w.planchetteBoard.planchette.feedSamples(samples);
      w.__t = t;
    },
    [targetId, n] as const,
  );
}

/** Samples that rest on a target for about 40% of the dwell time (plus the smoother's lag). */
async function partialDwell(page: Page, id: string): Promise<void> {
  const dwell = await page.evaluate(() => (window as unknown as Win).planchetteBoard.planchette.getProfile().dwellTime);
  await lookAt(page, id, Math.ceil((0.4 * dwell) / 33) + 6);
  await expect(page.locator(DWELL_RING)).toHaveAttribute('data-state', 'filling');
  const progress = Number(await page.locator(DWELL_RING).getAttribute('data-progress'));
  expect(progress, `progress on ${id}`).toBeGreaterThan(0.1);
  expect(progress, `progress on ${id} (a partial dwell, not a selection)`).toBeLessThan(0.9);
}

/** Back to rest (no selection), so the next partial dwell starts clean. */
async function rest(page: Page): Promise<void> {
  await lookAt(page, 'rest-area', 30);
  await expect(page.locator(DWELL_RING)).toBeHidden();
}

interface Measure {
  cell: { x: number; y: number; width: number; height: number };
  outline: { x: number; y: number; width: number; height: number };
  /** Depth from the cell's border-box edge to the inner side of the innermost stroke. */
  strokeDepth: number;
  border: number;
  text: { left: number; top: number; right: number; bottom: number } | null;
  clearance: number;
  hitIsButton: boolean;
  hit: string;
  fills: string[];
  regions: Array<{ x: number; y: number; width: number; height: number } | null>;
  cellSize: number;
  label: string;
}

async function measure(page: Page, id: string): Promise<Measure> {
  return page.evaluate(
    ([targetId, ring, regionSelectors]) => {
      const el = document.querySelector<HTMLElement>(`[data-planchette-target="${targetId}"]`)!;
      const cell = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const border = parseFloat(cs.borderTopWidth);
      const svg = document.querySelector(ring as string)!;
      const rects = Array.from(svg.querySelectorAll('rect'));
      const strokeDepth = Math.max(...rects.map((r) => parseFloat(r.getAttribute('x')!) + parseFloat(r.getAttribute('stroke-width')!) / 2));
      // The label's text box: union of the client rects of a Range over the button's contents,
      // keeping only line boxes that start inside the cell (a clamped third line is not drawn).
      const range = document.createRange();
      range.selectNodeContents(el);
      const lines = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0 && r.top < cell.bottom - border - 1);
      let text: Measure['text'] = null;
      if (lines.length > 0) {
        text = {
          left: Math.min(...lines.map((r) => r.left)),
          top: Math.min(...lines.map((r) => r.top)),
          right: Math.max(...lines.map((r) => r.right)),
          bottom: Math.max(...lines.map((r) => r.bottom)),
        };
      }
      const clearance =
        text === null
          ? NaN
          : Math.min(text.left - (cell.left + strokeDepth), text.top - (cell.top + strokeDepth), cell.right - strokeDepth - text.right, cell.bottom - strokeDepth - text.bottom);
      const hit = text === null ? null : document.elementFromPoint((text.left + text.right) / 2, (text.top + text.bottom) / 2);
      const box = (e: Element | null) => {
        if (e === null) return null;
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      return {
        cell: box(el)!,
        outline: box(svg)!,
        strokeDepth,
        border,
        text,
        clearance,
        hitIsButton: hit !== null && (hit === el || el.contains(hit)),
        hit: hit === null ? 'null' : `${hit.tagName.toLowerCase()}${hit.id ? '#' + hit.id : ''}`,
        fills: rects.map((r) => getComputedStyle(r).fill),
        regions: (regionSelectors as string[]).map((s) => box(document.querySelector(s))),
        cellSize: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--target-size')),
        label: (el.textContent ?? '').trim().slice(0, 30),
      };
    },
    [id, DWELL_RING, REGIONS] as const,
  );
}

const near = (a: number, b: number, tol = 0.5): boolean => Math.abs(a - b) <= tol;
const boxesEqual = (a: Measure['cell'], b: Measure['cell']): boolean =>
  near(a.x, b.x) && near(a.y, b.y) && near(a.width, b.width) && near(a.height, b.height);

/**
 * A partial dwell on `id`: checks label, outline and layout. Returns the measurement.
 * `before` is the same measurement taken with no dwell, to compare for reflow.
 */
async function checkDuringDwell(page: Page, id: string): Promise<Measure> {
  const before = await page.evaluate(
    ([targetId, regionSelectors]) => {
      const box = (e: Element | null) => {
        if (e === null) return null;
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      return {
        cell: box(document.querySelector(`[data-planchette-target="${targetId}"]`))!,
        regions: (regionSelectors as string[]).map((s) => box(document.querySelector(s))),
      };
    },
    [id, REGIONS] as const,
  );
  await partialDwell(page, id);
  const m = await measure(page, id);
  const where = `${page.viewportSize()!.width}px, cell ${m.cellSize}, "${m.label}" (${id})`;
  expect(m.text, `${where}: the label has a text box`).not.toBeNull();
  expect(m.hitIsButton, `${where}: elementFromPoint at the label's centre returned ${m.hit}`).toBe(true);
  expect(m.fills, `${where}: outline rect fills`).toEqual(['none', 'none', 'none']);
  expect(boxesEqual(m.outline, m.cell), `${where}: outline ${JSON.stringify(m.outline)} vs cell ${JSON.stringify(m.cell)}`).toBe(true);
  expect(boxesEqual(m.cell, before.cell), `${where}: the cell moved or changed size during the dwell`).toBe(true);
  m.regions.forEach((r, i) => {
    const b = before.regions[i];
    expect(r === null ? b === null : b !== null && boxesEqual(r, b), `${where}: region ${REGIONS[i]} changed during the dwell`).toBe(true);
  });
  // The stroke bands lie inside the border (outer side at the border width) and the label clears them.
  expect(m.strokeDepth, `${where}: stroke depth ${m.strokeDepth} vs border ${m.border}`).toBeCloseTo(m.border + 5, 1);
  console.log(`[dwell-outline] ${where}: text box clearance to the strokes = ${m.clearance.toFixed(2)} px (stroke depth ${m.strokeDepth}, border ${m.border})`);
  test.info().annotations.push({ type: 'clearance', description: `${where}: ${m.clearance.toFixed(2)} px` });
  expect(m.clearance, `${where}: the label's text box clears the strokes by ${m.clearance.toFixed(2)} px; text ${JSON.stringify(m.text)}, cell ${JSON.stringify(m.cell)}, depth ${m.strokeDepth}`).toBeGreaterThanOrEqual(0);
  return m;
}

async function noCamera(page: Page): Promise<void> {
  expect(await page.evaluate(() => (window as unknown as Win).__gum), 'getUserMedia calls').toBe(0);
}

/** The prediction slot with the widest word. */
async function widestSlot(page: Page): Promise<string> {
  const id = await page.evaluate(() => {
    const slots = Array.from(document.querySelectorAll<HTMLElement>('#prediction-strip [data-planchette-target]'));
    slots.sort((a, b) => (b.textContent ?? '').length - (a.textContent ?? '').length);
    return slots[0]?.getAttribute('data-planchette-target') ?? null;
  });
  expect(id, 'a filled prediction slot').not.toBeNull();
  return id!;
}

for (const size of SIZES) {
  test.describe(`${size.width}x${size.height} dwell outline`, () => {
    test('Core view: "different" and the widest prediction slot', async ({ page }) => {
      await openBoard(page, size);
      await startHeadDwell(page);
      await checkDuringDwell(page, 'core-different');
      await rest(page);
      await checkDuringDwell(page, await widestSlot(page));
      await rest(page);
      await expect(page.locator('#message-bar')).toHaveText('');
      await noCamera(page);
    });

    test('Spell mode: the pressed Spell toggle and "⌫ Backspace" (the tightest label)', async ({ page }) => {
      await openBoard(page, size);
      await clickTarget(page, 'spell-toggle');
      await expect(page.locator('#letter-grid')).toBeVisible();
      await startHeadDwell(page);
      await expect(page.locator('[data-planchette-target="spell-toggle"]')).toHaveAttribute('aria-pressed', 'true');
      await checkDuringDwell(page, 'spell-toggle');
      await rest(page);
      await expect(page.locator('[data-planchette-target="backspace"]')).toHaveText('⌫ Backspace');
      const m = await checkDuringDwell(page, 'backspace');
      // Reported, not tuned: design.md says the clearance here is about 0.5 px.
      test.info().annotations.push({ type: 'backspace-clearance', description: `${m.clearance.toFixed(2)} px at cell ${m.cellSize}` });
      await rest(page);
      await expect(page.locator('#message-bar')).toHaveText('');
      await noCamera(page);
    });

    test('Phrases view: a two-line phrase', async ({ page }) => {
      await openBoard(page, size);
      await page.evaluate(() => {
        const store = (window as unknown as { planchetteBoard: { quickPhrases: { add(t: string): unknown } } }).planchetteBoard.quickPhrases;
        store.add('Could you please help me with my breakfast and then open the window');
      });
      await clickTarget(page, 'phrases-toggle');
      await expect(page.locator('#phrases-grid')).toBeVisible();
      await startHeadDwell(page);
      // The phrase whose text is the longest (it takes two lines).
      const id = await page.evaluate(() => {
        const cells = Array.from(document.querySelectorAll<HTMLElement>('#phrases-grid .phrase[data-planchette-target]'));
        cells.sort((a, b) => (b.textContent ?? '').length - (a.textContent ?? '').length);
        return cells[0]!.getAttribute('data-planchette-target')!;
      });
      await checkDuringDwell(page, id);
      await rest(page);
      await expect(page.locator('#message-bar')).toHaveText('');
      await noCamera(page);
    });

    test('a resize during the dwell: the outline follows the cell to its new box', async ({ page }) => {
      await openBoard(page, size);
      await startHeadDwell(page);
      await partialDwell(page, 'core-different');
      const other = size.width === 1366 ? { width: 1920, height: 1080 } : { width: 1366, height: 768 };
      await page.setViewportSize(other);
      await expect
        .poll(async () => {
          const m = await measure(page, 'core-different');
          return boxesEqual(m.outline, m.cell);
        }, { message: 'the outline follows the cell after the resize' })
        .toBe(true);
      await noCamera(page);
    });
  });
}
