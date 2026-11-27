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

/** Prediction slots registered with the default 4 slots (a slot with no word is not a target). */
const SLOTS = 4;
/** Core view: 36 grid targets + speak, backspace, clear, undo, spell, cancel, camera toggle, Phrases toggle, rest area + filled slots. */
const CORE_TARGETS = 36 + 9 + SLOTS;
/** Spell mode: 28 letter-board targets + the same 9 + slots (filled while the Partial word is empty). */
const SPELL_TARGETS = 28 + 9 + SLOTS;

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
  for (let i = 0; i < SLOTS; i++) expect(ids, `target prediction-slot-${i}`).toContain(`prediction-slot-${i}`);
  for (const id of ['speak', 'backspace-action', 'clear', 'undo', 'spell-toggle', 'cancel', 'camera-toggle', 'phrases-toggle', 'rest-area']) {
    expect(ids, `target ${id}`).toContain(id);
  }
  for (const t of targets) {
    expect(inside(t.rect, vp.width, vp.height), `target ${t.id} inside ${vp.width}x${vp.height}: ${JSON.stringify(t.rect)}`).toBe(true);
  }

  const overflowing = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.target'))
      .filter((e) => e.offsetParent !== null)
      // Phrase cells are clamped to two lines by design (scrollHeight > clientHeight); they get their own check.
      .filter((e) => !e.classList.contains('phrase'))
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

type Hook = {
  planchetteBoard: {
    planchette: { getTargets(): Array<{ id: string; rect: Box }> };
    quickPhrases: { phrases: ReadonlyArray<{ id: string; text: string }>; add(t: string): unknown; remove(id: string): void };
  };
};

/** The rendered cell size and gap, read from the page (`--target-size`, `--target-gap`), never a fixed number. */
interface Scale {
  /** Cell height `s`. */
  h: number;
  /** Gap between targets. */
  g: number;
  /** A Phrases cell spans three of the six Core columns: 3 * (4s/3) + 2g. */
  phraseW: number;
  /** Message-bar-independent figure: the Camera row's three targets share `.camera-rest`'s width. */
  cameraW: number;
}
async function readScale(page: Page): Promise<Scale> {
  const v = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      s: parseFloat(cs.getPropertyValue('--target-size')),
      g: parseFloat(cs.getPropertyValue('--target-gap')),
      row: document.querySelector('.camera-rest')!.getBoundingClientRect().width,
    };
  });
  return { h: v.s, g: v.g, phraseW: (4 * v.s) / 3 * 3 + 2 * v.g, cameraW: (v.row - 2 * v.g) / 3 };
}

/** Task 31.4 / 33.4: s is 96 at 1366x768 and 139 at 1920x1080 (131 px two-line bar). */
function checkRenderedSize(sc: Scale, size: { width: number }): void {
  if (size.width === 1366) expect(sc.h, 'cell size at 1366x768').toBe(96);
  else expect(sc.h, 'cell size at 1920x1080').toBe(139);
  expect(sc.g).toBe(16);
}

/**
 * The `.page` box covers at least 90% of the viewport height at 1920x1080 (Req 14 AC 13, 17): 972 px at least,
 * and 1077 px in every view (`--page-min-height` holds the Spell view at the Core view's height).
 * Returns the coverage.
 */
async function checkCoverage(page: Page, size: { width: number; height: number }): Promise<number> {
  const box = (await page.locator('.page').boundingBox())!;
  const cover = box.height / size.height;
  if (size.height === 1080) {
    expect(box.height, `.page box ${box.height} of ${size.height}`).toBeGreaterThanOrEqual(0.9 * size.height);
    expect(box.height, `.page box ${box.height} is the Core view's height`).toBe(1077);
    const min = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--page-min-height')));
    expect(min, '--page-min-height').toBe(1077);
  }
  console.log(`coverage ${size.width}x${size.height}: .page ${box.height.toFixed(1)} / ${size.height} = ${(cover * 100).toFixed(1)}%`);
  return cover;
}

/** Every grid's cells in `selector` have one width (and one height, s). */
async function checkEqualWidths(page: Page, selector: string, sc: Scale): Promise<void> {
  const rects = await page.evaluate(
    (sel) => Array.from(document.querySelectorAll<HTMLElement>(sel)).filter((e) => e.offsetParent !== null).map((e) => e.getBoundingClientRect().width),
    selector,
  );
  expect(rects.length, `cells in ${selector}`).toBeGreaterThan(0);
  for (const w of rects) expect(near(w, rects[0]!), `${selector} widths ${rects}`).toBe(true);
  expect(near(rects[0]!, (4 * sc.h) / 3, 1), `${selector} width ${rects[0]} = 4s/3`).toBe(true);
}

/** Target rectangles from getTargets() match the rendered elements. */
async function checkTargetsMatchDom(page: Page): Promise<void> {
  const bad = await page.evaluate(() => {
    const ts = (window as unknown as Win).planchetteBoard.planchette.getTargets();
    const out: string[] = [];
    for (const t of ts) {
      const el = document.querySelector<HTMLElement>(`[data-planchette-target="${t.id}"]`);
      if (el === null) { out.push(`${t.id} missing`); continue; }
      const r = el.getBoundingClientRect();
      if (Math.abs(r.x - t.rect.x) > 1 || Math.abs(r.y - t.rect.y) > 1 || Math.abs(r.width - t.rect.width) > 1 || Math.abs(r.height - t.rect.height) > 1) {
        out.push(`${t.id} dom ${r.x},${r.y},${r.width},${r.height} target ${JSON.stringify(t.rect)}`);
      }
    }
    return out;
  });
  expect(bad, 'getTargets() rectangles match the rendered elements').toEqual([]);
}
const near = (a: number, b: number, tol = 0.5): boolean => Math.abs(a - b) <= tol;
const LONG_PHRASE =
  'I would like to talk with the doctor about my medicine, my pain at night, and whether the new schedule for visits can start earlier this week please';

const targetsOf = (page: Page): Promise<Array<{ id: string; rect: Box }>> =>
  page.evaluate(() => (window as unknown as Win).planchetteBoard.planchette.getTargets());

/** Replace the Quick phrases through the store the hook exposes: `count` phrases, the long one at index 2. */
async function loadPhrases(page: Page, count: number): Promise<string[]> {
  const texts = Array.from({ length: count }, (_, i) => (i === 2 ? LONG_PHRASE : `Phrase number ${i + 1}`));
  await page.evaluate((list) => {
    const store = (window as unknown as Hook).planchetteBoard.quickPhrases;
    for (const p of [...store.phrases]) store.remove(p.id);
    for (const t of list) store.add(t);
  }, texts);
  return texts;
}

/** The Camera row: three equal targets, s high, with --target-gap gaps; the rest area is one unclipped line "Rest area". */
async function checkCameraRow(page: Page, sc: Scale): Promise<void> {
  const rects = [];
  for (const id of ['camera-toggle', 'phrases-toggle', 'rest-area']) {
    const b = (await page.locator(`[data-planchette-target="${id}"]`).boundingBox())!;
    expect(near(b.width, sc.cameraW), `${id} width ${b.width} vs ${sc.cameraW}`).toBe(true);
    expect(near(b.height, sc.h), `${id} height ${b.height}`).toBe(true);
    rects.push(b);
  }
  expect(near(rects[1]!.x - (rects[0]!.x + rects[0]!.width), sc.g), 'gap camera/phrases').toBe(true);
  expect(near(rects[2]!.x - (rects[1]!.x + rects[1]!.width), sc.g), 'gap phrases/rest').toBe(true);
  const rest = page.locator('#rest-area');
  await expect(rest).toBeVisible();
  await expect(rest).toHaveText('Rest area');
  await expect(rest).toHaveAttribute('aria-label', 'Rest area. Nothing here is selected.');
  const p = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('#rest-area p')!;
    const r = el.getBoundingClientRect();
    const box = document.getElementById('rest-area')!.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(el).lineHeight);
    return { h: r.height, lh, scrollW: el.scrollWidth, clientW: el.clientWidth, inside: r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom };
  });
  expect(p.h, 'rest area text is one line').toBeLessThanOrEqual(p.lh * 1.5);
  expect(p.scrollW).toBeLessThanOrEqual(p.clientW);
  expect(p.inside, 'rest area text inside its box').toBe(true);
}

/**
 * Phrase cells: each is (4s+2g) x s and shows the full phrase as text content. A long phrase is clamped, so
 * scrollHeight > clientHeight is expected; instead assert that nothing is drawn outside the cell: the cell
 * is overflow:hidden with computed line-clamp 2, its first two text line boxes lie fully inside it (a third
 * line is laid out but clamped away by the browser, so it is not asserted on), and its rect keeps that size.
 * The 25-phrase test also compares screenshots of the 16 px gap under a clamped cell and under a short one.
 */
async function checkPhraseCells(page: Page, expected: string[], sc: Scale): Promise<void> {
  const cells = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('#phrases-grid .phrase[data-planchette-target]')).map((el) => {
      const cell = el.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el);
      const lines = Array.from(range.getClientRects());
      const visible = lines.filter((r) => r.width > 0).sort((a, b) => a.top - b.top || a.left - b.left);
      // The first two line boxes (distinct tops) are the lines that can be drawn; a third, if laid out, is clamped away.
      const tops = [...new Set(visible.map((r) => Math.round(r.top)))].slice(0, 2);
      const drawn = visible.filter((r) => tops.includes(Math.round(r.top)));
      const cs = getComputedStyle(el);
      return {
        text: el.textContent ?? '',
        w: cell.width,
        h: cell.height,
        clamp: cs.getPropertyValue('-webkit-line-clamp') || cs.getPropertyValue('line-clamp'),
        overflow: cs.overflow,
        partial: drawn.filter((r) => r.top < cell.top - 0.5 || r.bottom > cell.bottom + 0.5 || r.left < cell.left - 0.5 || r.right > cell.right + 0.5).length,
      };
    }),
  );
  expect(cells.map((c) => c.text)).toEqual(expected);
  for (const c of cells) {
    expect(near(c.w, sc.phraseW) && near(c.h, sc.h), `phrase cell ${c.w}x${c.h} "${c.text.slice(0, 20)}"`).toBe(true);
    expect(c.clamp).toBe('2');
    expect(c.overflow).toBe('hidden');
    expect(c.partial, `first two line boxes of "${c.text.slice(0, 20)}" outside the cell`).toBe(0);
  }
}

/** Rows s apart + gap, two columns phraseW wide + gap, Previous/Next (or their placeholders) at row 5. */
async function checkPhraseGeometry(page: Page, ids: string[], sc: Scale): Promise<Box[]> {
  const rects = await targetsOf(page).then((ts) => ids.map((id) => ts.find((t) => t.id === id)!.rect));
  const grid = (await page.locator('#phrases-grid').boundingBox())!;
  rects.forEach((r, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    expect(near(r.x, grid.x + col * (sc.phraseW + sc.g)), `${ids[i]} x`).toBe(true);
    expect(near(r.y, grid.y + row * (sc.h + sc.g)), `${ids[i]} y`).toBe(true);
  });
  return rects;
}

/** Previous and Next, or the dashed placeholder in their place, always at row 5. */
async function navRects(page: Page): Promise<Box[]> {
  const out: Box[] = [];
  for (const col of [0, 1]) out.push((await page.locator(`#phrases-grid [data-row="5"][data-col="${col}"]`).boundingBox())!);
  return out;
}

const phraseIds = (ts: Array<{ id: string }>): string[] => ts.map((t) => t.id).filter((id) => id.startsWith('quick-phrase-'));

for (const size of SIZES) {
  test.describe(`${size.width}x${size.height} Phrases view`, () => {
    test('starter phrases: fits, one page, Camera row, view toggles', async ({ page }) => {
      await openBoard(page, size);
      await expect(page.locator('#core-grid')).toBeVisible();
      const coreBar = await barRect(page);
      const sc = await readScale(page);
      checkRenderedSize(sc, size);
      await checkCameraRow(page, sc);

      await clickTarget(page, 'phrases-toggle');
      await expect(page.locator('#phrases-grid')).toBeVisible();
      await expect(page.locator('#core-grid')).toBeHidden();
      const starters = await page.evaluate(() => (window as unknown as Hook).planchetteBoard.quickPhrases.phrases.map((p) => p.text));
      expect(starters.length).toBe(6);
      // 6 phrases, no Previous, no Next: 9 actions + 4 slots + 6 phrases.
      await checkFits(page, '#phrases-grid', 9 + SLOTS + 6);
      const ts = await targetsOf(page);
      expect(phraseIds(ts).length).toBe(6);
      expect(ts.map((t) => t.id)).not.toContain('phrases-next');
      expect(ts.map((t) => t.id)).not.toContain('phrases-prev');
      await checkPhraseCells(page, starters, sc);
      await checkEqualWidths(page, '#phrases-grid .phrase, #phrases-grid [data-row="5"]', { ...sc, h: (3 * sc.phraseW) / 4 });
      await checkTargetsMatchDom(page);
      await checkCoverage(page, size);
      expect(await barRect(page), 'Message bar unchanged in the Phrases view').toEqual(coreBar);
      await checkCameraRow(page, sc);

      // Toggle back goes to Core; Spell from Phrases goes to the Letter board.
      await clickTarget(page, 'phrases-toggle');
      await expect(page.locator('#core-grid')).toBeVisible();
      await expect(page.locator('#phrases-grid')).toBeHidden();
      await clickTarget(page, 'phrases-toggle');
      await expect(page.locator('#phrases-grid')).toBeVisible();
      await clickTarget(page, 'spell-toggle');
      await expect(page.locator('#letter-grid')).toBeVisible();
      await expect(page.locator('#phrases-grid')).toBeHidden();
      expect(await page.evaluate(() => (window as unknown as Win).__gum)).toBe(0);
    });

    test('25 phrases: three pages, fixed Previous/Next, clamped long phrase', async ({ page }) => {
      await openBoard(page, size);
      const coreBar = await barRect(page);
      const sc = await readScale(page);
      checkRenderedSize(sc, size);
      const texts = await loadPhrases(page, 25);
      await clickTarget(page, 'phrases-toggle');
      await expect(page.locator('#phrases-grid')).toBeVisible();

      const pageSizes = [10, 10, 5];
      let nav0: Box[] = [];
      for (let p = 0; p < 3; p++) {
        const expectedTexts = texts.slice(p * 10, p * 10 + pageSizes[p]!);
        const extra = (p > 0 ? 1 : 0) + (p < 2 ? 1 : 0); // Previous and Next
        await checkFits(page, '#phrases-grid', 9 + SLOTS + pageSizes[p]! + extra);
        const ts = await targetsOf(page);
        const ids = ts.map((t) => t.id);
        expect(phraseIds(ts).length, `phrase targets on page ${p}`).toBe(pageSizes[p]);
        expect(ids.includes('phrases-prev'), `Previous on page ${p}`).toBe(p > 0);
        expect(ids.includes('phrases-next'), `Next on page ${p}`).toBe(p < 2);
        await checkPhraseGeometry(page, phraseIds(ts), sc);
        await checkPhraseCells(page, expectedTexts, sc);
        await checkTargetsMatchDom(page);
        await checkCoverage(page, size);
        expect(await barRect(page), `Message bar on page ${p}`).toEqual(coreBar);
        await checkCameraRow(page, sc);
        const nav = await navRects(page);
        for (const b of nav) expect(near(b.width, sc.phraseW) && near(b.height, sc.h), `nav ${JSON.stringify(b)}`).toBe(true);
        for (const id of ['phrases-prev', 'phrases-next']) {
          const t = ts.find((x) => x.id === id);
          if (t === undefined) continue;
          const b = nav[id === 'phrases-prev' ? 0 : 1]!;
          expect(near(t.rect.x, b.x) && near(t.rect.y, b.y), `${id} target is where the placeholder slot is`).toBe(true);
        }
        if (p === 0) nav0 = nav;
        else expect(nav, `Previous/Next slots on page ${p} match page 0`).toEqual(nav0);
        if (p < 2) await clickTarget(page, 'phrases-next');
      }

      // Back to page 0, where the long phrase is.
      await clickTarget(page, 'phrases-prev');
      await clickTarget(page, 'phrases-prev');
      await expect(page.locator('#phrases-grid .phrase[data-planchette-target]').first()).toHaveText(texts[0]!);
      const longCell = page.locator('#phrases-grid .phrase[data-planchette-target]').nth(2);
      await expect(longCell).toHaveText(LONG_PHRASE);
      // The cell is taller at 1920x1080, so scrollHeight no longer shows the clamp. Check that the text needs more than
      // two lines (lift the clamp, count line boxes, restore it) while the computed clamp stays 2.
      const naturalLines = await longCell.evaluate((e) => {
        e.style.setProperty('-webkit-line-clamp', 'unset');
        const range = document.createRange();
        range.selectNodeContents(e);
        const tops = new Set(Array.from(range.getClientRects()).filter((r) => r.width > 0).map((r) => Math.round(r.top)));
        e.style.removeProperty('-webkit-line-clamp');
        return tops.size;
      });
      expect(naturalLines, 'the long phrase needs more than two lines, so it is clamped').toBeGreaterThan(2);
      // Nothing is drawn below the clamped cell: the gap strip under it looks the same as under a short cell.
      const strip = async (idx: number): Promise<Buffer> => {
        const ts = await targetsOf(page);
        const id = phraseIds(ts)[idx]!;
        const r = ts.find((t) => t.id === id)!.rect;
        return page.screenshot({ clip: { x: r.x, y: r.y + r.height + 1, width: r.width, height: 14 } });
      };
      expect((await strip(2)).equals(await strip(4)), 'nothing drawn under the clamped cell').toBe(true);
      const longId = phraseIds(await targetsOf(page))[2]!;
      await clickTarget(page, longId);
      await expect(page.locator('#message-bar')).toHaveText(LONG_PHRASE);
      await expect(page.locator('#phrases-grid')).toBeVisible(); // the view does not change
      await clickTarget(page, 'clear');
      expect(await page.evaluate(() => (window as unknown as Win).__gum)).toBe(0);
    });
  });
}

for (const size of SIZES) {
  test.describe(`${size.width}x${size.height}`, () => {
    test('Core view and Spell mode fit the viewport; the Message bar stays put; no camera call', async ({ page }) => {
      await openBoard(page, size);

      // Core view.
      await expect(page.locator('#core-grid')).toBeVisible();
      await checkFits(page, '#core-grid', CORE_TARGETS);
      const sc = await readScale(page);
      checkRenderedSize(sc, size);
      await checkEqualWidths(page, '#core-grid > *', sc);
      await checkTargetsMatchDom(page);
      await checkCoverage(page, size);
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
      await checkEqualWidths(page, '#letter-grid > *', await readScale(page));
      await checkTargetsMatchDom(page);
      await checkCoverage(page, size);
      // Spelling "he": the slots show words starting with "he" (some may be empty); the layout holds.
      await clickTarget(page, 'letter-h');
      await clickTarget(page, 'letter-e');
      await expect(page.locator('#message-bar')).toHaveText('he');
      const spelling = await page.locator('#prediction-strip > button').allTextContents();
      expect(spelling.filter((w) => w !== '').every((w) => w.startsWith('he')), `slots while spelling "he": ${spelling}`).toBe(true);
      const spellingTargets = await page.evaluate(() => (window as unknown as Win).planchetteBoard.planchette.getTargets().length);
      await checkFits(page, '#letter-grid', spellingTargets);
      expect(spellingTargets).toBe(SPELL_TARGETS - SLOTS + spelling.filter((w) => w !== '').length);
      // Selecting a filled slot replaces the spelled "he" with that word.
      const filled = spelling.findIndex((w) => w !== '');
      expect(filled, 'a filled slot while spelling "he"').toBeGreaterThanOrEqual(0);
      await clickTarget(page, `prediction-slot-${filled}`);
      await expect(page.locator('#message-bar')).toHaveText(spelling[filled]!);
      await clickTarget(page, 'clear');
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

/**
 * Task 32.3: the first-run hint (Req 13 AC 10 to 13). A fresh context has no saved Profile, so
 * the Status panel's message line shows the hint; it fits, moves nothing, ends at the first
 * select (not at a mode change), and is not shown again once a Profile is saved.
 */
const FIRST_RUN_HINT = 'Choose an input mode, or press Start camera';

/** Open the Board with no saved Profile and no mode chosen; `getUserMedia` only counts and refuses. */
async function openFresh(page: Page, size: { width: number; height: number }): Promise<void> {
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
}

async function regionRects(page: Page): Promise<Record<string, Box | null>> {
  const out: Record<string, Box | null> = {};
  for (const [name, sel] of REGIONS) out[name] = await page.locator(sel).boundingBox();
  out['core grid'] = await page.locator('#core-grid').boundingBox();
  return out;
}

for (const size of SIZES) {
  test.describe(`${size.width}x${size.height} first-run hint`, () => {
    test('shows on a fresh page, fits, moves nothing, ends at the first select, never with a saved Profile', async ({ page }) => {
      await openFresh(page, size);
      const msg = page.locator('#controls-message');
      await expect(msg).toHaveText(FIRST_RUN_HINT);
      await expect(msg).toBeVisible();

      const fit = await page.evaluate(() => {
        const m = document.getElementById('controls-message')!.getBoundingClientRect();
        const p = document.getElementById('status-panel')!.getBoundingClientRect();
        const el = document.getElementById('controls-message')!;
        return {
          sh: document.documentElement.scrollHeight,
          sw: document.documentElement.scrollWidth,
          ih: innerHeight,
          iw: innerWidth,
          msgSh: el.scrollHeight,
          msgCh: el.clientHeight,
          msgSw: el.scrollWidth,
          msgCw: el.clientWidth,
          inPanel: m.left >= p.left - 0.5 && m.right <= p.right + 0.5 && m.top >= p.top - 0.5 && m.bottom <= p.bottom + 0.5,
          m: { x: m.x, y: m.y, w: m.width, h: m.height },
          p: { x: p.x, y: p.y, w: p.width, h: p.height },
        };
      });
      expect(fit.sh, 'page scrollHeight <= innerHeight').toBeLessThanOrEqual(fit.ih);
      expect(fit.sw, 'page scrollWidth <= innerWidth').toBeLessThanOrEqual(fit.iw);
      expect(fit.msgSh, `message line scrollHeight <= clientHeight ${JSON.stringify(fit)}`).toBeLessThanOrEqual(fit.msgCh);
      expect(fit.msgSw, 'message line scrollWidth <= clientWidth').toBeLessThanOrEqual(fit.msgCw);
      expect(fit.inPanel, `hint inside the Status panel ${JSON.stringify(fit)}`).toBe(true);

      const withHint = await regionRects(page);
      const targetsWithHint = await page.evaluate(() =>
        (window as unknown as Win).planchetteBoard.planchette.getTargets().map((t) => ({ id: t.id, rect: t.rect })),
      );

      // A mode change alone keeps the hint (design.md "First-run hint", After a reload).
      await page.locator('#mode').selectOption('mouse');
      await expect(page.locator('#mode')).toHaveValue('mouse');
      await expect(msg, 'a mode change alone does not end the hint').toHaveText(FIRST_RUN_HINT);

      // The first select ends it.
      await clickTarget(page, 'core-different');
      await expect(page.locator('#message-bar')).toHaveText('different');
      await expect(msg).not.toHaveText(FIRST_RUN_HINT);
      await expect(msg).not.toContainText('Choose an input mode');

      // No layout shift: every region and every target is where it was with the hint showing.
      expect(await regionRects(page), 'regions unchanged after the hint ends').toEqual(withHint);
      const targetsAfter = await page.evaluate(() =>
        (window as unknown as Win).planchetteBoard.planchette.getTargets().map((t) => ({ id: t.id, rect: t.rect })),
      );
      expect(targetsAfter, 'targets unchanged after the hint ends').toEqual(targetsWithHint);
      const after = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight }));
      expect(after.sh).toBeLessThanOrEqual(after.ih);

      // The mode change saved a Profile: after a reload the hint is not shown.
      await page.reload();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('#mode')).toHaveValue('mouse');
      await expect(page.locator('#controls-message')).not.toHaveText(FIRST_RUN_HINT);
      await expect(page.locator('#controls-message')).not.toContainText('Choose an input mode');

      expect(await page.evaluate(() => (window as unknown as Win).__gum), 'getUserMedia never called').toBe(0);
    });
  });
}
