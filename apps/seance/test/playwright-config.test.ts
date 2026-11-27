import { describe, expect, it } from "vitest";
import { devices } from "@playwright/test";
import config from "../../../playwright.config";

// The Playwright config is shared. The Séance projects mirror the Board's two.
const DEV_URL = "http://localhost:5199";
const BUILT_URL = "http://localhost:5198";

type Project = NonNullable<typeof config.projects>[number];
const project = (name: string): Project | undefined => config.projects?.find((p) => p.name === name);

describe("playwright.config (seance projects)", () => {
  it("adds the seance project on the dev server, with its own testDir", () => {
    expect(project("seance")).toEqual({
      name: "seance",
      testDir: "apps/seance/test",
      testMatch: "**/*.e2e.ts",
      use: { ...devices["Desktop Chrome"], baseURL: DEV_URL },
    });
  });
  it("adds the seance-built project on the built output, with its own testDir", () => {
    expect(project("seance-built")).toEqual({
      name: "seance-built",
      testDir: "apps/seance/test",
      testMatch: "**/*.e2e.ts",
      use: { ...devices["Desktop Chrome"], baseURL: BUILT_URL },
    });
  });
  it("leaves the skeleton and Board projects in place", () => {
    for (const name of ["chromium", "built", "board", "board-built"]) expect(project(name), name).toBeDefined();
  });
});
