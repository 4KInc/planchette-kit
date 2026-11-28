/**
 * Séance in a real browser (Playwright, Chromium): rounds in mouse mode and in head + dwell with synthetic
 * samples. It runs under the `seance` (dev server) and `seance-built` projects. No camera, no sound.
 */
import { expect, test } from '@playwright/test';
import {
  KEY_BOARD,
  KEY_SEANCE,
  audioContexts,
  chooseMode,
  dwellOn,
  gum,
  missFourByDwell,
  nextId,
  open,
  playToSummary,
  registeredIds,
  startHeadDwell,
  stored,
  tap,
  target,
  wrongId,
} from './seance-e2e-helpers';
const BOARD_RECORD = JSON.stringify({
  profile: { mode: 'scan', dwellTime: 900, targetSize: 120 },
  board: { predictionSlotCount: 6, voiceURI: 'v', speechRate: 1.25, filterOffensiveWords: false },
  version: 1,
});
test.describe('mouse mode', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
    await chooseMode(page, 'mouse');
  });
  test('a full Round: the line fills, the Summary shows the figures, and Another round starts a new Message', async ({ page }) => {
    const first = (await nextId(page))!;
    await expect(page.locator('#spelled-letters .todo')).toHaveCount(3);
    await tap(page, first);
    await expect(page.locator('#spelled-letters .todo')).toHaveCount(2);
    await playToSummary(page);
    await expect(page.locator('#spelled-letters')).toHaveText(/^Round complete: [A-Z]{3}$/);
    await expect(page.locator('#summary-letters')).toHaveText('3 of 3');
    await expect(page.locator('#summary-accidental')).toHaveText('0');
    await expect(page.locator('#summary-dwell')).toHaveText('Input: Mouse.'); // no dwell time outside head + dwell
    await expect(target(page, 'carry-dwell')).toBeHidden();
    expect(await registeredIds(page)).not.toContain('letter-a');
    await tap(page, 'next-round');
    await expect(page.locator('#board-section')).toBeVisible();
    await expect(page.locator('[data-next="true"]')).toHaveCount(1);
  });
  test('Stop ends the Round as stopped, with no Carry; Undo takes back one letter', async ({ page }) => {
    await tap(page, (await nextId(page))!);
    await expect(page.locator('#spelled-letters .todo')).toHaveCount(2);
    await tap(page, 'undo');
    await expect(page.locator('#spelled-letters .todo')).toHaveCount(3);
    await tap(page, (await nextId(page))!);
    await tap(page, 'stop');
    await expect(page.locator('#spelled-letters')).toHaveText('You stopped this round');
    await expect(page.locator('#summary-letters')).toHaveText('1 of 3');
    await expect(target(page, 'carry-dwell')).toBeHidden();
  });
  test('Misses add to the count with no penalty text; after four there is a stronger cue but NO Suggestion in mouse mode', async ({ page }) => {
    const next = (await nextId(page))!;
    const wrong = await wrongId(page);
    await tap(page, wrong);
    await expect(page.locator('#live')).not.toHaveText(/wrong|fail|bad|lose|lost|mistake|error|try harder/i);
    for (let i = 0; i < 3; i++) await tap(page, wrong);
    await expect(page.locator('.page')).toHaveAttribute('data-support', '2');
    await expect(page.locator('#spelled-callout')).toContainText('Next:');
    await expect(page.locator('[data-next="true"]')).toHaveAttribute('data-planchette-target', next);
    // no dwell Suggestion where dwell does not apply
    await expect(page.locator('#suggest-apply')).toBeHidden();
    await expect(page.locator('#suggest-dismiss')).toBeHidden();
    await expect(page.getByText('Hold longer')).toHaveCount(0);
    const ids = await registeredIds(page);
    expect(ids).not.toContain('suggest-apply');
    expect(ids).not.toContain('suggest-dismiss');
    await playToSummary(page);
    await expect(page.locator('#summary-accidental')).toHaveText('4');
    await expect(page.locator('#summary-dwell')).not.toContainText('Dwell time');
    await expect(page.locator('#summary-dwell')).not.toContainText('ms');
  });
  test('the empty Suggestion slots are invisible on first load, unregistered, and keep their space', async ({ page }) => {
    for (const id of ['suggest-apply', 'suggest-dismiss']) {
      const style = await target(page, id).evaluate((el) => {
        const cs = getComputedStyle(el);
        return { visibility: cs.visibility, w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height };
      });
      expect(style.visibility).toBe('hidden');
      expect(style.w).toBeGreaterThan(90);
      expect(style.h).toBeGreaterThan(90);
    }
    expect(await registeredIds(page)).not.toContain('suggest-apply');
  });
  test('Cancel and the rest area are registered in every view, and nothing starts the camera', async ({ page }) => {
    for (const id of ['cancel', 'undo', 'rest-area', 'stop', 'camera-toggle', 'sound-toggle']) expect(await registeredIds(page)).toContain(id);
    await playToSummary(page);
    for (const id of ['cancel', 'undo', 'rest-area', 'stop', 'camera-toggle', 'sound-toggle', 'next-round']) expect(await registeredIds(page)).toContain(id);
    expect(await gum(page)).toBe(0);
  });
  test('sound is off on load: no AudioContext until Sound is pressed; the same target mutes again', async ({ page }) => {
    expect(await audioContexts(page)).toBe(0);
    await tap(page, (await nextId(page))!);
    expect(await audioContexts(page)).toBe(0);
    await expect(target(page, 'sound-toggle')).toHaveText('Sound off');
    await tap(page, 'sound-toggle');
    await expect(target(page, 'sound-toggle')).toHaveText('Sound on');
    await expect(target(page, 'sound-toggle')).toHaveAttribute('aria-pressed', 'true');
    expect(await audioContexts(page)).toBe(1);
    await tap(page, 'sound-toggle');
    await expect(target(page, 'sound-toggle')).toHaveText('Sound off');
    expect(await audioContexts(page)).toBe(1);
    // sound is never saved
    expect(await stored(page, KEY_SEANCE)).not.toContain('sound');
  });
  test('the Board key is never written in mouse mode', async ({ page }) => {
    await playToSummary(page);
    expect(await stored(page, KEY_BOARD)).toBeNull();
  });
});
test.describe('head + dwell with synthetic samples (no camera)', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
  });
  test('four Misses show the Suggestion; "Hold longer" applies it once; the Suggestion closes when the Round ends', async ({ page }) => {
    let t = await startHeadDwell(page);
    t = await missFourByDwell(page, t);
    await expect(page.locator('.page')).toHaveAttribute('data-support', '2');
    await expect(target(page, 'suggest-apply')).toBeVisible();
    await expect(target(page, 'suggest-apply')).toHaveText('Hold longer: 2400 ms');
    expect(await registeredIds(page)).toContain('suggest-apply');
    expect(await page.evaluate(() => (window as unknown as { planchetteSeance: { planchette: { getProfile(): { dwellTime: number } } } }).planchetteSeance.planchette.getProfile().dwellTime)).toBe(2100);
    t = await dwellOn(page, 'suggest-apply', t);
    await expect(target(page, 'suggest-apply')).toBeHidden();
    expect(await page.evaluate(() => (window as unknown as { planchetteSeance: { planchette: { getProfile(): { dwellTime: number } } } }).planchetteSeance.planchette.getProfile().dwellTime)).toBe(2400);
    expect(JSON.parse((await stored(page, KEY_SEANCE))!).profile.dwellTime).toBe(2400);
    expect(await stored(page, KEY_BOARD)).toBeNull(); // accepting a Suggestion never touches the Board
    expect(await gum(page)).toBe(0);
  });
  test('an open Suggestion is gone from the Summary', async ({ page }) => {
    let t = await startHeadDwell(page);
    t = await missFourByDwell(page, t);
    await expect(target(page, 'suggest-apply')).toBeVisible();
    t = await dwellOn(page, 'stop', t);
    await expect(page.locator('#summary-section')).toBeVisible();
    await expect(target(page, 'suggest-apply')).toBeHidden();
    expect(await registeredIds(page)).not.toContain('suggest-apply');
  });
  test('a completed Round offers Carry; the Board key is untouched until the press; Undo puts it back', async ({ page }) => {
    await page.evaluate(([k, v]) => localStorage.setItem(k!, v!), [KEY_BOARD, BOARD_RECORD]);
    let t = await startHeadDwell(page);
    for (let i = 0; i < 3; i++) t = await dwellOn(page, (await nextId(page))!, t);
    await expect(page.locator('#summary-section')).toBeVisible();
    await expect(page.locator('#summary-dwell')).toHaveText('Dwell time: 2100 ms. Input: Head + dwell.');
    await expect(target(page, 'carry-dwell')).toBeVisible();
    await expect(target(page, 'carry-dwell')).toHaveText('Use 2100 ms on the Board');
    expect(await stored(page, KEY_BOARD)).toBe(BOARD_RECORD); // offered, not written
    t = await dwellOn(page, 'carry-dwell', t);
    await expect(page.locator('#summary-board')).toHaveText('The Board now uses 2100 ms.');
    const written = JSON.parse((await stored(page, KEY_BOARD))!);
    expect(written.profile).toEqual({ mode: 'scan', dwellTime: 2100, targetSize: 120 });
    expect(written.board).toEqual(JSON.parse(BOARD_RECORD).board);
    t = await dwellOn(page, 'undo', t);
    expect(await stored(page, KEY_BOARD)).toBe(BOARD_RECORD);
    await expect(target(page, 'carry-dwell')).toBeVisible();
    expect(await gum(page)).toBe(0);
  });
  test('with no Board settings saved, Carry writes a complete record and Undo removes it', async ({ page }) => {
    let t = await startHeadDwell(page);
    for (let i = 0; i < 3; i++) t = await dwellOn(page, (await nextId(page))!, t);
    await expect(page.locator('#summary-board')).toContainText('The Board has no saved settings yet.');
    t = await dwellOn(page, 'carry-dwell', t);
    const written = JSON.parse((await stored(page, KEY_BOARD))!);
    expect(written).toEqual({ profile: { dwellTime: 2100 }, board: { predictionSlotCount: 4, voiceURI: '', speechRate: 1, filterOffensiveWords: true }, version: 1 });
    await dwellOn(page, 'undo', t);
    expect(await stored(page, KEY_BOARD)).toBeNull();
  });
  test('a Board record it cannot read is left alone and Carry is not offered', async ({ page }) => {
    await page.evaluate(([k]) => localStorage.setItem(k!, '{not json'), [KEY_BOARD]);
    let t = await startHeadDwell(page);
    for (let i = 0; i < 3; i++) t = await dwellOn(page, (await nextId(page))!, t);
    await expect(page.locator('#summary-section')).toBeVisible();
    await expect(target(page, 'carry-dwell')).toBeHidden();
    await expect(page.locator('#summary-board')).toContainText('could not be read');
    expect(await stored(page, KEY_BOARD)).toBe('{not json');
  });
});
