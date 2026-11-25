import { defineConfig, devices } from '@playwright/test';

const PORT = 5199; // the dev server
const BUILT_PORT = 5198; // the production build, served as static files (vite preview)
const BUILT_DIR = 'node_modules/.e2e-dist'; // separate from dist/, so `npm run build` output is untouched

export default defineConfig({
  testDir: 'skeleton/test',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // The demo page and the app stubs again, from the built output: the Content-Security-Policy
    // has to hold there too, not only under the dev server.
    {
      name: 'built',
      testMatch: '**/demo.e2e.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${BUILT_PORT}` },
    },
    // The Board app's specs. The top-level testDir stays 'skeleton/test' (the two projects above
    // inherit it), so each Board project sets its own testDir; that keeps the skeleton projects
    // from picking up apps/board files and the Board projects from picking up skeleton files.
    // `board` runs against the dev server, `board-built` against the built output, so the
    // Content-Security-Policy is checked on the Board page there too.
    {
      name: 'board',
      testDir: 'apps/board/test',
      testMatch: '**/*.e2e.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${PORT}` },
    },
    {
      name: 'board-built',
      testDir: 'apps/board/test',
      testMatch: '**/*.e2e.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${BUILT_PORT}` },
    },
  ],
  webServer: [
    {
      command: `npx vite --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}/skeleton/test/e2e/ui-fixture.html`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite build --outDir ${BUILT_DIR} --emptyOutDir && npx vite preview --outDir ${BUILT_DIR} --port ${BUILT_PORT} --strictPort`,
      url: `http://localhost:${BUILT_PORT}/`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
