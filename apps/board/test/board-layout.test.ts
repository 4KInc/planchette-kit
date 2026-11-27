// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { messages } from "../src/messages";

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
      one("#phrases-grid"),
      one("#prediction-strip"),
      one(".actions"),
      one('[data-planchette-target="camera-toggle"]'),
      one('[data-planchette-target="phrases-toggle"]'),
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
    expect(side.contains(one("#phrases-grid"))).toBe(false);
    expect(side.contains(one("#message-bar"))).toBe(false);
  });

  it("keeps the camera toggle and rest area in one row, Status panel a sibling of Controls", () => {
    const row = one(".camera-rest");
    expect(row.contains(one('[data-planchette-target="camera-toggle"]'))).toBe(true);
    expect(row.contains(one("#rest-area"))).toBe(true);
    expect([...row.children].map((c) => (c as HTMLElement).dataset.planchetteTarget)).toEqual(["camera-toggle", "phrases-toggle", "rest-area"]);
    expect(one("#status-panel").parentElement).toBe(one(".controls").parentElement);
  });

  it("has a Phrases section (hidden) and a hidden live region for the page position", () => {
    const section = one("#phrases-grid").closest("section")!;
    expect(section.hasAttribute("hidden")).toBe(true);
    expect(one("#phrases-grid").hasAttribute("hidden")).toBe(true);
    const live = one("#phrases-page");
    expect(live.classList.contains("visually-hidden")).toBe(true);
    expect(live.getAttribute("aria-live")).toBe("polite");
  });
  it("shows 'Rest area' with the full sentence as its accessible label", () => {
    const rest = one("#rest-area");
    expect(rest.querySelector("p")!.getAttribute("data-text")).toBe("page.restArea");
    expect(rest.getAttribute("data-aria-label")).toBe("page.restAreaHelp");
    expect(messages.page.restArea).toBe("Rest area");
    expect(messages.page.restAreaHelp).toBe("Rest area. Nothing here is selected.");
  });
  it("reserves #prediction-strip with no slot children", () => {
    const strip = one("#prediction-strip");
    expect(strip.children.length).toBe(0);
    expect(strip.querySelector("button")).toBeNull();
  });
});

describe("Controls row and Settings dialog", () => {
  it("holds the label, the mode selector and the Settings button, and no Calibrate", () => {
    const row = one(".controls-row");
    expect([...row.children].map((c) => c.tagName + (c.id ? "#" + c.id : ""))).toEqual(["LABEL", "SELECT#mode", "BUTTON#settings-button"]);
    expect(row.querySelector("label")!.getAttribute("for")).toBe("mode");
    expect(row.querySelector("#calibrate")).toBeNull();
    expect(row.querySelector("#settings-button")!.hasAttribute("data-planchette-target")).toBe(false);
    expect(row.querySelector("#settings-button")!.getAttribute("type")).toBe("button");
  });
  it("has a labelled dialog with Calibrate, its message line, About, Back and Close inside, none a target", () => {
    const dialog = one("dialog#settings");
    expect(dialog.getAttribute("aria-labelledby")).toBe("settings-title");
    expect(dialog.querySelector("#settings-title")).not.toBeNull();
    for (const sel of ["#calibrate", "#settings-message", "#about-button", "#about", "#about-back", "#settings-close"]) {
      expect(dialog.querySelector(sel), sel).not.toBeNull();
    }
    expect(dialog.querySelector("[data-planchette-target]")).toBeNull();
    expect(one("#about").hasAttribute("hidden")).toBe(true);
    expect(one("main").contains(dialog)).toBe(false);
  });
  it("keeps the strip at four columns and lets a second row add height only when needed", () => {
    expect(declarations(".prediction-strip")).toMatch(/grid-template-columns:\s*repeat\(4, 1fr\)/);
    expect(declarations(".prediction-strip")).toMatch(/min-height:\s*var\(--target-size\)/);
    expect(declarations(".side")).toMatch(/grid-template-rows:\s*auto calc\(var\(--target-size\) \* 2/);
  });
  it("makes the dialog fit the viewport or scroll inside itself", () => {
    const d = declarations("#settings");
    expect(d).toMatch(/max-height:\s*calc\(100vh/);
    expect(d).toMatch(/overflow-y:\s*auto/);
  });
});

describe("board.css Camera row and Phrases view", () => {
  it("gives the Camera row three equal columns and no span 2", () => {
    expect(declarations(".camera-rest")).toMatch(/grid-template-columns:\s*repeat\(3, 1fr\)/);
    expect(css).not.toMatch(/span 2/);
  });
  it("sizes .phrases-grid as two columns of half the six-column grid width", () => {
    const d = declarations(".phrases-grid");
    expect(d).toContain("grid-template-columns: repeat(2, calc((var(--cell-w) * 6 + var(--target-gap) * 4) / 2))");
    expect(d).toMatch(/grid-auto-rows:\s*var\(--target-size\)/);
  });
  it("clamps phrase cells to two lines at 24px with no smaller text", () => {
    const d = declarations(".phrases-grid .phrase");
    expect(d).toMatch(/-webkit-line-clamp:\s*2/);
    expect(d).toMatch(/overflow:\s*hidden/);
    expect(d).not.toMatch(/font-size/);
    expect(declarations(".target")).toMatch(/font-size:\s*24px/);
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
