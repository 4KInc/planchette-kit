/**
 * Task 28.1 — the Board in a real browser (Playwright, Chromium), driven by the mouse and
 * the keyboard only. It runs under the `board` (dev server) and `board-built` projects.
 *
 * No camera is used: `navigator.mediaDevices.getUserMedia` is wrapped only to COUNT calls
 * (and to refuse them), so a page that starts the camera on load is caught. `speechSynthesis`
 * is replaced in the page by a recording stub with one local voice.
 *
 * Covers Req 1 AC 2-7, Req 3 AC 1-2 (and 3.8 for the "I want" + H case), Req 5 AC 1, 9
 * and Req 9 AC 9.
 */
import { expect, test, type Page } from '@playwright/test';

interface SpokenUtterance {
  text: string;
  voiceURI: string | null;
}
interface HighlightDetail {
  kind: string;
  targetId: string;
  targetIds: string[];
}
type Win = {
  __gum: number;
  __spoken: SpokenUtterance[];
  __hl?: HighlightDetail;
  __cancels: number;
  planchetteBoard: { planchette: import('@planchette/skeleton').Planchette };
};

/** Open the Board with a getUserMedia counter and a recording speechSynthesis stub installed first. */
async function open(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Win;
    w.__gum = 0;
    w.__spoken = [];
    w.__cancels = 0;
    if (navigator.mediaDevices !== undefined) {
      navigator.mediaDevices.getUserMedia = () => {
        w.__gum++;
        return Promise.reject(new DOMException('no camera in the tests', 'NotFoundError'));
      };
    }
    const voice = { voiceURI: 'test-voice', name: 'Test voice', lang: 'en-US', localService: true, default: true };
    class FakeUtterance extends EventTarget {
      voice: unknown = null;
      rate = 1;
      constructor(public text: string) {
        super();
      }
    }
    class FakeSynth extends EventTarget {
      getVoices(): unknown[] {
        return [voice];
      }
      speak(u: FakeUtterance): void {
        w.__spoken.push({ text: u.text, voiceURI: (u.voice as { voiceURI: string } | null)?.voiceURI ?? null });
        setTimeout(() => u.dispatchEvent(new Event('end')), 10);
      }
      cancel(): void {}
    }
    (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance = FakeUtterance;
    Object.defineProperty(window, 'speechSynthesis', { value: new FakeSynth(), configurable: true });
  });
  await page.goto('/board/');
  await page.waitForFunction(() => (window as unknown as Partial<Win>).planchetteBoard !== undefined);
  await page.waitForLoadState('networkidle');
}

const target = (page: Page, id: string) => page.locator(`[data-planchette-target="${id}"]`);
const messageBar = (page: Page) => page.locator('#message-bar');

/** The mode is chosen with the real selector. */
async function chooseMode(page: Page, mode: string): Promise<void> {
  await page.locator('#mode').selectOption(mode);
}

/** A real pointer click at the centre of a target (down and up back to back, like a tap). */
async function tap(page: Page, id: string): Promise<void> {
  const el = target(page, id);
  await el.scrollIntoViewIfNeeded();
  const box = (await el.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
}
const core = (page: Page, ...ids: string[]) => ids.reduce((p, id) => p.then(() => tap(page, `core-${id}`)), Promise.resolve());

const gum = (page: Page) => page.evaluate(() => (window as unknown as Win).__gum);
const spoken = (page: Page) => page.evaluate(() => (window as unknown as Win).__spoken);

test.describe('mouse mode', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await chooseMode(page, 'mouse');
    await expect(page.locator('#mode')).toHaveValue('mouse');
  });

  test('a core word click puts the word in the Message bar (Req 1 AC 2)', async ({ page }) => {
    await expect(messageBar(page)).toHaveText('');
    await core(page, 'i', 'want');
    await expect(messageBar(page)).toHaveText('I want');
  });

  test('Backspace removes the last word in the core view (Req 1 AC 3)', async ({ page }) => {
    await core(page, 'i', 'want', 'help');
    await expect(messageBar(page)).toHaveText('I want help');
    await tap(page, 'backspace-action');
    await expect(messageBar(page)).toHaveText('I want');
  });

  test('Backspace removes the last character in Spell mode (Req 1 AC 3)', async ({ page }) => {
    await tap(page, 'spell-toggle');
    await tap(page, 'letter-h');
    await tap(page, 'letter-i');
    await expect(messageBar(page)).toHaveText('hi');
    await tap(page, 'backspace-action');
    await expect(messageBar(page)).toHaveText('h');
  });

  test('Clear empties the Message and Undo restores it (Req 1 AC 4, 6)', async ({ page }) => {
    await core(page, 'i', 'want');
    await tap(page, 'clear');
    await expect(messageBar(page)).toHaveText('');
    await tap(page, 'undo');
    await expect(messageBar(page)).toHaveText('I want');
  });

  test('Speak says the message once with a local voice (Req 1 AC 5)', async ({ page }) => {
    await core(page, 'i', 'want');
    await tap(page, 'speak');
    await expect.poll(() => spoken(page)).toEqual([{ text: 'I want', voiceURI: 'test-voice' }]);
  });

  test('Speak on an empty Message does nothing (Req 1 AC 5)', async ({ page }) => {
    await tap(page, 'speak');
    await page.waitForTimeout(300);
    expect(await spoken(page)).toEqual([]);
    await expect(messageBar(page)).toHaveText('');
  });

  test('the Spell toggle shows the Letter board and back (Req 3 AC 1)', async ({ page }) => {
    await expect(page.locator('#core-grid')).toBeVisible();
    await expect(page.locator('#letter-grid')).toBeHidden();
    await tap(page, 'spell-toggle');
    await expect(page.locator('#letter-grid')).toBeVisible();
    await expect(page.locator('#core-grid')).toBeHidden();
    await expect(target(page, 'spell-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(target(page, 'letter-h')).toBeVisible();
    await tap(page, 'spell-toggle');
    await expect(page.locator('#core-grid')).toBeVisible();
    await expect(page.locator('#letter-grid')).toBeHidden();
  });

  test('"I want" then H gives "I want h" (Req 3 AC 8)', async ({ page }) => {
    await core(page, 'i', 'want');
    await tap(page, 'spell-toggle');
    await tap(page, 'letter-h');
    await expect(messageBar(page)).toHaveText('I want h');
  });

  test('picking a prediction after "he" replaces the partial word (Req 3 AC 2)', async ({ page }) => {
    await tap(page, 'spell-toggle');
    await tap(page, 'letter-h');
    await tap(page, 'letter-e');
    await expect(messageBar(page)).toHaveText('he');
    const slots = page.locator('.prediction-slot:not([data-empty])');
    await expect.poll(() => slots.count()).toBeGreaterThan(0);
    const words = await slots.allTextContents();
    const word = words.find((w) => w.length > 2 && w.startsWith('he'));
    expect(word, `a longer "he…" prediction among ${words.join(', ')}`).toBeDefined();
    await page.locator('.prediction-slot', { hasText: new RegExp(`^${word}$`) }).first().click();
    await expect(messageBar(page)).toHaveText(word!);
  });

  test('the not-a-medical-device notice is on the page (Req 9 AC 9)', async ({ page }) => {
    await expect(page.locator('#notice')).toContainText('not a medical device');
    await expect(page.locator('#notice')).toBeVisible();
  });

  test('the camera was never asked for (Req 5 AC 1)', async ({ page }) => {
    await core(page, 'i', 'want');
    await tap(page, 'spell-toggle');
    await tap(page, 'letter-h');
    expect(await gum(page)).toBe(0);
    await expect(target(page, 'camera-toggle')).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('switch scanning with the keyboard', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    // The listeners and a long interval first, then the mode: scanning starts with the mode
    // change, and the first highlight (row 1) must not be missed.
    await page.evaluate(() => {
      const w = window as unknown as Win;
      const p = w.planchetteBoard.planchette;
      p.addEventListener('highlight', (e) => (w.__hl = e.detail as HighlightDetail));
      p.addEventListener('cancel', () => w.__cancels++);
      p.setProfile({ scanInterval: 2500 });
    });
    await chooseMode(page, 'scan');
    await expect(page.locator('#mode')).toHaveValue('scan');
    // Focus off the select, so Space is the switch and not a key for the control.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  });

  const hl = (page: Page) => page.evaluate(() => (window as unknown as Win).__hl);
  const press = async (page: Page): Promise<void> => {
    await page.keyboard.down(' ');
    await page.waitForTimeout(120);
    await page.keyboard.up(' ');
  };

  test('the default switch binding is Space', async ({ page }) => {
    expect(await page.evaluate(() => (window as unknown as Win).planchetteBoard.planchette.getProfile().switchBinding)).toBe(' ');
  });

  test('Space enters the highlighted row, then selects the highlighted word', async ({ page }) => {
    // Row 1 of the core grid (all, can, different, do, finished, get) is highlighted first.
    await expect.poll(async () => (await hl(page))?.targetIds?.[0]).toBe('core-all');
    expect((await hl(page))?.kind).toBe('row');
    await press(page);
    await expect.poll(async () => (await hl(page))?.kind).toBe('item');
    await expect.poll(async () => (await hl(page))?.targetId).toBe('core-all');
    await page.waitForTimeout(600); // a press inside the post-selection pause (500 ms) is ignored
    await press(page);
    await expect(messageBar(page)).toHaveText('all');
    expect(await gum(page)).toBe(0);
  });

  test('Escape cancels: back to the first row, nothing added', async ({ page }) => {
    await expect.poll(async () => (await hl(page))?.kind).toBe('row');
    await press(page);
    await expect.poll(async () => (await hl(page))?.kind).toBe('item');
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => (window as unknown as Win).__cancels)).toBe(1);
    await expect.poll(async () => (await hl(page))?.kind).toBe('row');
    await expect(messageBar(page)).toHaveText('');
  });
});
