import { describe, expect, it } from "vitest";
import { devices } from "@playwright/test";
import config from "../../../playwright.config";

// The Playwright config is shared with the skeleton. These values are the ones the skeleton
// projects had before the Board projects were added; they must not change.
const DEV_URL = "http://localhost:5199";
const BUILT_URL = "http://localhost:5198";

type Project = NonNullable<typeof config.projects>[number];
const project = (name: string): Project | undefined => config.projects?.find((p) => p.name === name);

describe("playwright.config", () => {
  it("keeps the top-level testDir on the skeleton specs", () => {
    expect(config.testDir).toBe("skeleton/test");
    expect(config.testMatch).toBe("**/*.e2e.ts");
  });

  it("leaves the chromium project unchanged", () => {
    expect(project("chromium")).toEqual({ name: "chromium", use: { ...devices["Desktop Chrome"] } });
  });

  it("leaves the built project unchanged", () => {
    expect(project("built")).toEqual({
      name: "built",
      testMatch: "**/demo.e2e.ts",
      use: { ...devices["Desktop Chrome"], baseURL: BUILT_URL },
    });
  });

  it("adds the board project on the dev server, with its own testDir", () => {
    expect(project("board")).toEqual({
      name: "board",
      testDir: "apps/board/test",
      testMatch: "**/*.e2e.ts",
      use: { ...devices["Desktop Chrome"], baseURL: DEV_URL },
    });
  });

  it("adds the board-built project on the built output, with its own testDir", () => {
    expect(project("board-built")).toEqual({
      name: "board-built",
      testDir: "apps/board/test",
      testMatch: "**/*.e2e.ts",
      use: { ...devices["Desktop Chrome"], baseURL: BUILT_URL },
    });
  });

  it("serves the dev server on 5199 and the build on 5198", () => {
    const servers = Array.isArray(config.webServer) ? config.webServer : [config.webServer];
    expect(servers.map((s) => s?.url)).toEqual([
      `${DEV_URL}/skeleton/test/e2e/ui-fixture.html`,
      `${BUILT_URL}/`,
    ]);
  });
});
