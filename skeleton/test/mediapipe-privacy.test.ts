/**
 * Nothing leaves the device (Req 2 AC 11, product.md principle 2). @mediapipe/tasks-vision
 * 1.0.0 and later send usage and latency statistics to https://odml.pa.googleapis.com/v1/log
 * every minute; 0.10.35, the version pinned here, does not. This test reads the pinned
 * library and the WASM loaders the app serves, and fails if a later version (or another
 * file) brings in that logger or any other network call besides fetching its own files.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mediapipeAssetSources } from '../scripts/mediapipe-assets';

const req = createRequire(resolve(import.meta.dirname, '../package.json'));
const bundle = readFileSync(req.resolve('@mediapipe/tasks-vision'), 'utf8');
const sources = mediapipeAssetSources();
const loaders = ['vision_wasm_internal.js', 'vision_wasm_nosimd_internal.js'].map((f) => [f, readFileSync(sources[f], 'utf8')] as const);

describe('the pinned MediaPipe sends nothing off the device', () => {
  it('is version 0.10.35', () => {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['@mediapipe/tasks-vision']).toBe('0.10.35');
  });

  it('has no usage logger: no logging endpoint, no API key header', () => {
    for (const [name, text] of [['vision_bundle.mjs', bundle] as const, ...loaders]) {
      expect(text, name).not.toContain('odml.pa.googleapis.com');
      expect(text, name).not.toContain('x-goog-api-key');
      expect(text, name).not.toMatch(/sendBeacon|new WebSocket|EventSource\(/);
    }
    // The library itself makes no XMLHttpRequest. (The Emscripten WASM loaders do, to read
    // the .wasm file from the URL the library gives them: the app's own assets folder.)
    expect(bundle).not.toMatch(/XMLHttpRequest/);
  });

  it('fetches only what it is given: the model file and graph paths', () => {
    const calls = [...bundle.matchAll(/fetch\(([^)]{0,60})\)/g)].map((m) => m[1]);
    expect(calls).toEqual(['e.modelAssetPath.toString(', 't']); // the model path we pass, and the graph
  });

  it('contains no hard-coded https URL it could call', () => {
    const urls = [...bundle.matchAll(/https?:\/\/[A-Za-z0-9.\-]+[^\s"'`)]*/g)].map((m) => m[0]);
    expect(urls).toEqual([]);
  });
});
