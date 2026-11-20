/**
 * Task 13.2 — the integration example (Req 1 AC 6): skeleton/examples/minimal.ts is at
 * most 15 lines of code, and it compiles as a user's code would.
 *
 * Line-count convention (design §6, "Integration example"): count the lines that are not
 * blank, not comments and not part of an import statement.
 *
 * Compiling "as a user's code": the package is built with the real build config into a
 * temporary folder, and minimal.ts is type-checked on its own against the built
 * declarations, imported by the package name '@planchette/skeleton'. So the example checks
 * the public types that ship, not the source files.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../');
const pkgDir = resolve(root, 'skeleton');
const examplePath = resolve(pkgDir, 'examples/minimal.ts');
const runDir = resolve(root, '.build-test-tmp', `example-${Date.now()}-${randomBytes(4).toString('hex')}`);
const tsc = resolve(root, 'node_modules/.bin/tsc');
const MAX_LINES = 15;

/** Lines of code: not blank, not a comment, not part of an import statement. */
export function countCodeLines(source: string): number {
  let count = 0;
  let inImport = false;
  let inBlockComment = false;
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      continue;
    }
    if (line === '' || line.startsWith('//')) continue;
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlockComment = true;
      continue;
    }
    if (inImport) {
      if (/from\s+['"][^'"]+['"];?$/.test(line) || /^['"][^'"]+['"];?$/.test(line)) inImport = false;
      continue;
    }
    if (/^import\b/.test(line)) {
      // A multi-line import continues until its `from '...'`.
      if (!/['"][^'"]+['"];?$/.test(line)) inImport = true;
      continue;
    }
    count++;
  }
  return count;
}

/** Type-check one file against the package built into `runDir/dist`, as a user would. */
function typecheckAgainstBuild(file: string): { status: number | null; output: string } {
  const cfg = resolve(runDir, `tsconfig.${randomBytes(3).toString('hex')}.json`);
  writeFileSync(
    cfg,
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        strict: true,
        noImplicitAny: true,
        noUnusedLocals: true,
        noEmit: true,
        skipLibCheck: true,
        types: [],
        paths: { '@planchette/skeleton': [resolve(runDir, 'dist/index.d.ts')] },
      },
      files: [file],
    }),
  );
  const r = spawnSync(tsc, ['-p', cfg], { encoding: 'utf8' });
  return { status: r.status, output: r.stdout + r.stderr };
}

beforeAll(() => {
  mkdirSync(runDir, { recursive: true });
  const r = spawnSync(tsc, ['-p', 'tsconfig.build.json', '--outDir', resolve(runDir, 'dist')], { cwd: pkgDir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`package build failed:\n${r.stdout}${r.stderr}`);
}, 120_000);

afterAll(() => {
  rmSync(runDir, { recursive: true, force: true });
});

describe('the integration example (Req 1 AC 6)', () => {
  const source = readFileSync(examplePath, 'utf8');

  it(`is ${MAX_LINES} lines of code or fewer`, () => {
    expect(countCodeLines(source)).toBeLessThanOrEqual(MAX_LINES);
  });

  it('imports the kit by its package name, not a path into skeleton/', () => {
    const specifiers = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(specifiers).toEqual(['@planchette/skeleton']);
  });

  it('is a head + dwell integration: create, two targets, select listener, camera start', () => {
    expect(source).toMatch(/createPlanchette\(/);
    expect(source).toMatch(/mode:\s*'head \+ dwell'/);
    expect(source).toMatch(/registerTarget\(/);
    expect(source).toMatch(/\['yes',\s*'no'\]/);
    expect(source).toMatch(/addEventListener\('select'/);
    expect(source).toMatch(/startCamera\(\)/);
  });

  it('compiles against the built package declarations', () => {
    const r = typecheckAgainstBuild(examplePath);
    expect(r.output).toBe('');
    expect(r.status).toBe(0);
  });

  it('the type check really checks: a wrong call on the API fails', () => {
    const bad = resolve(runDir, 'bad-example.ts');
    writeFileSync(bad, source.replace("planchette.registerTarget(id, { x, y, width, height });", "planchette.registerTarget(id, { x, y });"));
    const r = typecheckAgainstBuild(bad);
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/registerTarget|width|height/);
  });
});

describe('countCodeLines', () => {
  it('skips blank lines, comments and imports, including multi-line imports', () => {
    const src = [
      '// a comment',
      '/* a block',
      '   comment */',
      "import { a } from 'x';",
      'import {',
      '  b,',
      '  c,',
      "} from 'y';",
      "import 'side-effect';",
      '',
      'const one = 1;',
      '   ',
      'const two = 2; // trailing comment counts as code',
      '/* one-line block */',
    ].join('\n');
    expect(countCodeLines(src)).toBe(2);
  });

  it('counts a 16-line file as 16', () => {
    expect(countCodeLines(Array.from({ length: 16 }, (_, i) => `const v${i} = ${i};`).join('\n'))).toBe(16);
  });
});
