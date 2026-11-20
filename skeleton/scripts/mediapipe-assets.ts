/**
 * A Vite plugin that serves the head-tracking files from the app's own origin
 * (tech.md: never a third-party CDN; Task 14.1).
 *
 *  - `npm run dev`: the files are served at `<base>mediapipe/<file>` straight from
 *    node_modules and skeleton/assets.
 *  - `npm run build`: they are copied into the build output at `mediapipe/<file>`.
 *
 * The files: MediaPipe's WASM loaders and binaries (the SIMD and nosimd non-module pairs,
 * from @mediapipe/tasks-vision's own `wasm/` folder, so they always match the pinned
 * library version) and the face model, `face_landmarker.task`, from skeleton/assets.
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import type { Plugin } from 'vite';

const here = dirname(new URL(import.meta.url).pathname);
const requireFromSkeleton = createRequire(resolve(here, '../package.json'));

/** Where each served file comes from. */
export function mediapipeAssetSources(): Record<string, string> {
  // Subpaths the package exports, which point into its wasm/ folder. MediaPipe picks the
  // SIMD pair when the browser supports WebAssembly SIMD and the nosimd pair otherwise, so
  // a browser downloads one of the two.
  const wasm = (name: string) => requireFromSkeleton.resolve(`@mediapipe/tasks-vision/${name}`);
  return {
    'vision_wasm_internal.js': wasm('vision_wasm_internal.js'),
    'vision_wasm_internal.wasm': wasm('vision_wasm_internal.wasm'),
    'vision_wasm_nosimd_internal.js': wasm('vision_wasm_nosimd_internal.js'),
    'vision_wasm_nosimd_internal.wasm': wasm('vision_wasm_nosimd_internal.wasm'),
    'face_landmarker.task': resolve(here, '../assets/face_landmarker.task'),
  };
}

const TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
};

export function mediapipeAssets(folder = 'mediapipe'): Plugin {
  const sources = mediapipeAssetSources();
  for (const [name, path] of Object.entries(sources)) {
    if (!existsSync(path)) throw new Error(`mediapipe-assets: ${name} not found at ${path}`);
  }
  let base = '/';
  return {
    name: 'planchette-mediapipe-assets',
    configResolved(config) {
      base = config.base;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        const prefix = `${base}${folder}/`;
        if (!url.startsWith(prefix)) return next();
        const path = sources[url.slice(prefix.length)];
        if (path === undefined) return next();
        const ext = path.slice(path.lastIndexOf('.'));
        res.setHeader('Content-Type', TYPES[ext] ?? 'application/octet-stream');
        res.setHeader('Content-Length', String(statSync(path).size));
        createReadStream(path).pipe(res);
      });
    },
    generateBundle() {
      for (const [name, path] of Object.entries(sources)) {
        this.emitFile({ type: 'asset', fileName: `${folder}/${name}`, source: readFileSync(path) });
      }
    },
  };
}
