/**
 * The npm package build (docs/npm-package-plan.md, Phase 1).
 *
 * Runs the real build config (`tsconfig.build.json`) into a temporary folder, so the
 * test works on a clean checkout and leaves `skeleton/dist/` alone. Checks what a
 * published package would contain and what it exports, using real Node ESM to load it.
 *
 * Also checks the repo rule that the apps and tools import the kit only as
 * '@planchette/skeleton', never by a path into skeleton/.
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../');
const pkgDir = resolve(root, 'skeleton');
const tmpBase = resolve(root, '.build-test-tmp');
const runDir = resolve(tmpBase, `pkg-${Date.now()}-${randomBytes(4).toString('hex')}`);
const outDir = resolve(runDir, 'dist');

/** The runtime names exported from the package entry point. Types do not appear here. */
const EXPECTED_EXPORTS = ['createPlanchette'];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

let build: SpawnSyncReturns<string>;
let files: string[] = [];

beforeAll(() => {
  mkdirSync(runDir, { recursive: true });
  build = spawnSync(
    resolve(root, 'node_modules/.bin/tsc'),
    ['-p', 'tsconfig.build.json', '--outDir', outDir],
    { cwd: pkgDir, encoding: 'utf8' },
  );
  if (existsSync(outDir)) files = walk(outDir).map((f) => relative(outDir, f));
}, 120_000);

afterAll(() => {
  // Remove only this run's folder, so a real dist/ and concurrent runs are untouched.
  rmSync(runDir, { recursive: true, force: true });
});

describe('the package build', () => {
  it('compiles without errors', () => {
    expect(build.stderr + build.stdout).toBe('');
    expect(build.status).toBe(0);
  });

  it('emits dist/index.js and dist/index.d.ts, with declaration maps', () => {
    expect(files).toContain('index.js');
    expect(files).toContain('index.d.ts');
    expect(files).toContain('index.d.ts.map');
    expect(files).toContain('engine/profile.d.ts.map');
  });

  it('puts src/ at the root of dist/ (rootDir is src)', () => {
    expect(files.some((f) => f.startsWith('src/'))).toBe(false);
    expect(files.some((f) => f.startsWith('skeleton/'))).toBe(false);
  });

  it('holds no test, demo or example code', () => {
    const bad = files.filter((f) => /(^|\/)(test|tests|demo|examples|e2e)(\/|$)/.test(f) || /\.(test|props\.test|e2e)\./.test(f));
    expect(bad).toEqual([]);
    for (const f of files.filter((x) => x.endsWith('.js') || x.endsWith('.d.ts'))) {
      const text = readFileSync(join(outDir, f), 'utf8');
      expect(text, f).not.toMatch(/from ['"][^'"]*\/(test|demo|examples)\//);
      expect(text, f).not.toMatch(/vitest|fast-check/);
    }
  });

  it('emits only JavaScript, type declarations and their maps', () => {
    for (const f of files) expect(f, f).toMatch(/\.(js|d\.ts|d\.ts\.map)$/);
  });

  it('every relative import in the JavaScript has a .js extension, so it loads without a bundler', () => {
    for (const f of files.filter((x) => x.endsWith('.js'))) {
      const text = readFileSync(join(outDir, f), 'utf8');
      for (const m of text.matchAll(/from ['"](\.[^'"]*)['"]/g)) expect(m[1], `${f}: ${m[1]}`).toMatch(/\.js$/);
    }
  });

  it('exports exactly the expected names when loaded by Node as an ES module', () => {
    const entry = pathToFileURL(join(outDir, 'index.js')).href;
    const script = `
      const before = new Set(Object.getOwnPropertyNames(globalThis));
      const m = await import(${JSON.stringify(entry)});
      const added = Object.getOwnPropertyNames(globalThis).filter((k) => !before.has(k));
      console.log(JSON.stringify({ names: Object.keys(m).sort(), added }));
    `;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as { names: string[]; added: string[] };
    expect(out.names).toEqual([...EXPECTED_EXPORTS].sort());
    // sideEffects: false holds only if importing does nothing: no globals added.
    expect(out.added).toEqual([]);
  });

  it('the exported factory works from the compiled output', async () => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(join(outDir, 'index.js')).href)) as {
      createPlanchette: (o: { screen: { width: number; height: number } }) => {
        getProfile(): { mode: string };
        setMode(m: string): void;
      };
    };
    const p = mod.createPlanchette({ screen: { width: 100, height: 100 } });
    expect(p.getProfile().mode).toBe('head + dwell');
    p.setMode('scan');
    expect(p.getProfile().mode).toBe('scan');
  });

  it('the declaration file declares createPlanchette and the public types', () => {
    const dts = readFileSync(join(outDir, 'index.d.ts'), 'utf8');
    expect(dts).toMatch(/export declare function createPlanchette\(/);
    for (const t of ['Planchette', 'PlanchetteOptions', 'TimestampedSample', 'Profile', 'InputMode']) {
      expect(dts, t).toContain(t);
    }
  });
});

describe('package.json and build files (npm-package-plan.md, Phase 1)', () => {
  const pkg = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf8')) as Record<string, unknown>;

  it('stays private at version 0.0.0 until the first publish', () => {
    expect(pkg.private).toBe(true);
    expect(pkg.version).toBe('0.0.0');
    expect(pkg.name).toBe('@planchette/skeleton');
  });

  it('has the exports, files and sideEffects fields', () => {
    expect(pkg.exports).toEqual({ '.': { types: './dist/index.d.ts', import: './dist/index.js' } });
    expect(pkg.files).toEqual(['dist', 'assets', 'README.md', 'LICENSE']);
    expect(pkg.sideEffects).toBe(false);
  });

  it('has build and prepublishOnly scripts', () => {
    const scripts = pkg.scripts as Record<string, string>;
    expect(scripts.build).toBe('tsc -p tsconfig.build.json && node scripts/copy-license.mjs');
    expect(scripts.prepublishOnly).toBe('npm test && npm run build');
  });

  it('depends on @mediapipe/tasks-vision, pinned to an exact version (Task 14)', () => {
    expect(pkg.dependencies).toEqual({ '@mediapipe/tasks-vision': '0.10.35' });
  });

  it('loads MediaPipe only when the camera starts: no static import of it in the build', () => {
    for (const f of files.filter((x) => x.endsWith('.js'))) {
      const text = readFileSync(join(outDir, f), 'utf8');
      expect(text, f).not.toMatch(/^\s*import[^(]*['"]@mediapipe\/tasks-vision['"]/m);
    }
    const env = readFileSync(join(outDir, 'adapters/browser-env.js'), 'utf8');
    expect(env).toMatch(/import\(['"]@mediapipe\/tasks-vision['"]\)/);
  });

  it('ships the face model in assets/, the file listed in THIRD_PARTY.md', () => {
    expect(existsSync(resolve(pkgDir, 'assets/face_landmarker.task'))).toBe(true);
  });

  it('the build config compiles only src/ with declarations and maps', () => {
    const cfg = JSON.parse(readFileSync(resolve(pkgDir, 'tsconfig.build.json'), 'utf8')) as {
      compilerOptions: Record<string, unknown>;
      include: string[];
    };
    expect(cfg.compilerOptions).toMatchObject({ rootDir: 'src', outDir: 'dist', declaration: true, declarationMap: true });
    expect(cfg.include).toEqual(['src']);
  });

  it('git ignores dist/ and the copied LICENSE', () => {
    const ignore = readFileSync(resolve(root, '.gitignore'), 'utf8').split('\n');
    expect(ignore).toContain('dist/');
    expect(ignore).toContain('skeleton/LICENSE');
  });

  it('the copy-license script copies the repo LICENSE into the folder it is given', () => {
    const dest = resolve(runDir, 'license-copy');
    const r = spawnSync(process.execPath, [resolve(pkgDir, 'scripts/copy-license.mjs'), dest], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(readFileSync(resolve(dest, 'LICENSE'), 'utf8')).toBe(readFileSync(resolve(root, 'LICENSE'), 'utf8'));
  });
});

describe('the apps and tools use the kit only by its package name', () => {
  function sourceFiles(dir: string): string[] {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
      else if (/\.(ts|tsx|js|mjs|html)$/.test(name)) out.push(p);
    }
    return out;
  }
  const specifiers = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]|<script[^>]*src=['"]([^'"]+)['"]/g;
  const consumers = [...sourceFiles(resolve(root, 'apps')), ...sourceFiles(resolve(root, 'tools'))];

  it('no file in apps/ or tools/ imports a path into skeleton/', () => {
    const offenders: string[] = [];
    for (const file of consumers) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(specifiers)) {
        const spec = m[1] ?? m[2];
        const intoSkeleton = /(^|\/)skeleton(\/|$)/.test(spec) && spec !== '@planchette/skeleton';
        if (intoSkeleton) offenders.push(`${relative(root, file)}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the checker itself finds a bad import (so the test above can fail)', () => {
    const bad = `import { createPlanchette } from '../../../skeleton/src/index';`;
    const found = [...bad.matchAll(specifiers)].map((m) => m[1] ?? m[2]);
    expect(found.some((s) => /(^|\/)skeleton(\/|$)/.test(s) && s !== '@planchette/skeleton')).toBe(true);
    const good = `import { createPlanchette } from '@planchette/skeleton';`;
    const ok = [...good.matchAll(specifiers)].map((m) => m[1] ?? m[2]);
    expect(ok).toEqual(['@planchette/skeleton']);
  });

  it('vite resolves the package name to the source, so dev and build work without building first', () => {
    const cfg = readFileSync(resolve(root, 'vite.config.ts'), 'utf8');
    expect(cfg).toMatch(/['"]@planchette\/skeleton['"]\s*:\s*resolve\([^)]*skeleton\/src\/index\.ts/);
  });
});
