/**
 * Séance stays on the device (Requirement 13): only same-origin requests, no Content-Security-Policy
 * violation, no camera call, no AudioContext until Sound is pressed, and only the two allowed storage keys.
 */
import { expect, test } from '@playwright/test';
import { KEY_BOARD, KEY_SEANCE, audioContexts, chooseMode, gum, open, playToSummary, tap } from './seance-e2e-helpers';
test('only same-origin requests, no policy violation, no camera, no sound, and only the Séance key is written', async ({ page, baseURL }) => {
  const requests: string[] = [];
  const problems: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('websocket', (w) => requests.push(w.url()));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(String(e)));
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await open(page);
  await chooseMode(page, 'mouse');
  await playToSummary(page);
  await tap(page, 'next-round');
  const origin = new URL(baseURL!).origin;
  // the dev server's own hot-reload websocket (dev project only) is the same host and port, so compare host:port
  const hostOf = (u: string): string => new URL(u).host;
  for (const url of requests) expect(hostOf(url), url).toBe(new URL(origin).host);
  expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
  expect(problems.filter((p) => /content security policy|refused to/i.test(p))).toEqual([]);
  expect(problems).toEqual([]);
  expect(await gum(page)).toBe(0);
  expect(await audioContexts(page)).toBe(0);
  // the only key written is Séance's own; the Board's is untouched; no Round, count or Message is stored
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.every((k) => k === KEY_SEANCE)).toBe(true);
  expect(keys).not.toContain(KEY_BOARD);
  const value = (await page.evaluate((k) => localStorage.getItem(k), KEY_SEANCE)) ?? '';
  expect(value).not.toMatch(/miss|round|message|letter|spelled|support/i);
  expect(await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content'))).toBe(
    "default-src 'self'; connect-src 'self'; script-src 'self' 'wasm-unsafe-eval'",
  );
});
