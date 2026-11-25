// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Pins the viewport layout structure (Req 14 AC 4-6; design.md "Viewport layout"). */
const html = readFileSync(resolve(__dirname, "../../../board/index.html"), "utf8");
const css = readFileSync(resolve(__dirname, "../board.css"), "utf8");
const doc = new DOMParser().parseFromString(html, "text/html");

function one(selector: string): Element {
  const el = doc.querySelector(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
}

/** CSS declarations of every rule whose selector list contains `selector` exactly. */
function declarations(selector: string): string {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectors = m[1]!.replace(/\/\*[\s\S]*?\*\//g, "").split(",").map((s) => s.trim());
    if (selectors.includes(selector)) out.push(m[2]!);
  }
  return out.join(";");
}

describe("board/index.html region order", () => {
  it("lists the regions in the documented DOM order", () => {
    const regions = [
      one("#message-bar"),
      one("#core-grid"),
      one("#letter-grid"),
      one("#prediction-strip"),
      one(".actions"),
      one('[data-planchette-target="camera-toggle"]'),
      one("#rest-area"),
      one(".controls-row"),
      one("#status-panel"),
      one("footer #notice"),
    ];
    for (let i = 1; i < regions.length; i++) {
      const follows = regions[i - 1]!.compareDocumentPosition(regions[i]!) & Node.DOCUMENT_POSITION_FOLLOWING;
      expect(follows, `region ${i} should follow region ${i - 1}`).toBeTruthy();
    }
  });

  it("puts the right-column blocks inside .side and the grids outside it", () => {
    const side = one(".side");
    for (const sel of ["#prediction-strip", ".actions", ".camera-rest", ".controls", "#status-panel", "footer"]) {
      expect(side.contains(one(sel)), sel).toBe(true);
    }
    expect(side.contains(one("#core-grid"))).toBe(false);
    expect(side.contains(one("#letter-grid"))).toBe(false);
    expect(side.contains(one("#message-bar"))).toBe(false);
  });

  it("keeps the camera toggle and rest area in one row, Status panel a sibling of Controls", () => {
    const row = one(".camera-rest");
    expect(row.contains(one('[data-planchette-target="camera-toggle"]'))).toBe(true);
    expect(row.contains(one("#rest-area"))).toBe(true);
    expect(one("#status-panel").parentElement).toBe(one(".controls").parentElement);
  });

  it("reserves #prediction-strip with no slot children", () => {
    const strip = one("#prediction-strip");
    expect(strip.children.length).toBe(0);
    expect(strip.querySelector("button")).toBeNull();
  });
});

describe("board.css cell sizing", () => {
  it("defines --cell-w as target size * 4 / 3", () => {
    expect(css).toMatch(/--cell-w:\s*calc\(var\(--target-size\) \* 4 \/ 3\)\s*;/);
  });

  it("uses equal-width columns and fixed row height for both grids", () => {
    const grid = declarations(".core-grid") + declarations(".letter-grid");
    expect(declarations(".core-grid")).toMatch(/grid-template-columns:\s*repeat\(6, var\(--cell-w\)\)/);
    expect(declarations(".letter-grid")).toMatch(/grid-template-columns:\s*repeat\(6, var\(--cell-w\)\)/);
    expect(grid).toMatch(/grid-auto-rows:\s*var\(--target-size\)/);
  });

  it("no longer uses minmax(var(--target-size), max-content)", () => {
    expect(css).not.toMatch(/minmax\(\s*var\(--target-size\)\s*,\s*max-content\s*\)/);
  });

  it("keeps grid and action targets at normal weight", () => {
    const target = declarations(".target");
    expect(target).toMatch(/font-weight:\s*normal/);
    expect(css).not.toMatch(/font-weight:\s*(bold|bolder|[6-9]00)/);
  });

  it("uses no font size below 24px", () => {
    const sizes = [...css.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    for (const s of sizes) expect(s).toBeGreaterThanOrEqual(24);
    expect(declarations(".target")).toMatch(/font-size:\s*24px/);
    expect(css).not.toMatch(/font-size:\s*(small|smaller|x-small|xx-small|[\d.]+(em|rem|%))/);
    for (const m of css.matchAll(/font:\s*(\d+(?:\.\d+)?)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(24);
  });
});
