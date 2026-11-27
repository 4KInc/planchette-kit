// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Task 27.1: text 4.5:1, UI parts 3:1, text at least 24 px, no motion in board.css (Req 9 AC 1-7, 10).
 * The contrast math is the one in skeleton/test/demo.e2e.ts. jsdom does not resolve var(), so the
 * custom properties declared in :root are substituted into the CSS text before it is injected;
 * the cascade and inheritance are then jsdom's. :focus-visible, the viewport and the elements the
 * app builds at run time are checked in board-colours.e2e.ts.
 */
const html = readFileSync(resolve(__dirname, "../../../board/index.html"), "utf8");
const rawCss = readFileSync(resolve(__dirname, "../board.css"), "utf8");

const vars = new Map<string, string>();
for (const m of rawCss.matchAll(/(--[\w-]+):\s*([^;]+);/g)) vars.set(m[1], m[2].trim());
function substitute(text: string): string {
  let out = text;
  for (let i = 0; i < 5; i++) out = out.replace(/var\((--[\w-]+)\)/g, (_, n: string) => vars.get(n) ?? "");
  return out;
}
const css = substitute(rawCss);
const stripped = rawCss.replace(/\/\*[\s\S]*?\*\//g, "");

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function luminance([r, g, b]: number[]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function ratio(a: number[], b: number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function parseColour(c: string): number[] {
  const s = c.trim().toLowerCase();
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex !== null) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, "$&$&") : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m === null) throw new Error(`not a colour: ${c}`);
  return m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
}
const isClear = (c: string) => c === "" || c === "transparent" || /rgba\(.*,\s*0\)/.test(c);

let doc: Document;
let win: Window & typeof globalThis;
beforeAll(() => {
  document.documentElement.innerHTML = new DOMParser().parseFromString(html, "text/html").documentElement.innerHTML;
  document.querySelectorAll("link[rel=stylesheet], script").forEach((n) => n.remove());
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
  doc = document;
  win = window as unknown as Window & typeof globalThis;
  // Elements the app builds at run time (the real ones are checked in the e2e).
  const add = (parent: string, markup: string): void => {
    doc.querySelector(parent)!.insertAdjacentHTML("beforeend", markup);
  };
  add("#core-grid", `<button class="target" data-row="0" data-col="0">I</button>`);
  add("#letter-grid", `<button class="target" data-row="0" data-col="0">A</button>`);
  add(
    "#phrases-grid",
    `<button class="target phrase">Hello there</button><button class="target" aria-disabled="true">Previous</button>`,
  );
  add(
    "#prediction-strip",
    `<button class="target">word</button><button class="target" data-empty="true" aria-disabled="true"></button>`,
  );
  add(
    "#camera-status",
    `<div data-planchette="tracking-indicator" data-state="on"><p>Camera on</p></div>` +
      `<div data-planchette="tracking-indicator" data-state="failed"><p>Camera failed</p><button>Try again</button></div>`,
  );
  add(
    "#settings-sections",
    `<section class="settings-group"><h3>Group</h3><div class="settings-row"><label>Name</label><input type="text"/>` +
      `<p class="help">Help text</p></div><div class="settings-row"><select><option>a</option></select></div>` +
      `<textarea>x</textarea><ul class="phrase-list"><li><input type="text"/><button>Remove</button></li></ul>` +
      `<div class="settings-buttons"><button disabled>Disabled</button></div></section>`,
  );
  add("#about-body", `<p>Credits</p><a href="https://example.org">Link</a>`);
  doc.querySelector("#message-bar")!.textContent = "hello";
  doc.querySelector("#controls-message")!.textContent = "message";
  doc.querySelector("#mode")!.innerHTML = "<option>Mouse</option>";
  doc.querySelector('label[for="mode"]')!.textContent = "Mode";
  doc.querySelector('[data-planchette-target="camera-toggle"]')!.textContent = "Start camera";
  doc.querySelector("#notice")!.textContent = "Not a medical device";
  doc.querySelector(".rest p")!.textContent = "Rest here";
  doc.querySelectorAll("[data-text]").forEach((e) => {
    if ((e.textContent ?? "") === "") e.textContent = "Text";
  });
});

/** The first non-clear background up the tree, as in demo.e2e.ts; the page background is the last resort. */
function bgOf(el: Element): number[] {
  for (let e: Element | null = el; e !== null; e = e.parentElement) {
    const c = win.getComputedStyle(e).backgroundColor;
    if (!isClear(c)) return parseColour(c);
  }
  return parseColour(win.getComputedStyle(doc.body).backgroundColor);
}
const colourOf = (el: Element, prop: "color" | "borderTopColor"): number[] =>
  parseColour(win.getComputedStyle(el)[prop]);

/** Elements that carry their own text. */
function textElements(): Element[] {
  return Array.from(doc.body.querySelectorAll("*")).filter(
    (e) =>
      !["SCRIPT", "STYLE", "OPTION", "OPTGROUP"].includes(e.tagName) &&
      !e.hasAttribute("hidden") &&
      Array.from(e.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== ""),
  );
}
const label = (e: Element) => `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}${e.className ? "." + e.className : ""} "${(e.textContent ?? "").trim().slice(0, 20)}"`;

describe("board.css text colours (Req 9 AC 7; 4.5:1)", () => {
  it("every text element has at least 4.5:1 against its background", () => {
    const els = textElements();
    expect(els.length).toBeGreaterThan(25);
    for (const e of els) {
      expect(ratio(colourOf(e, "color"), bgOf(e)), `text ${label(e)}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("pressed toggles and disabled controls keep 4.5:1 text, also under the scan tint", () => {
    const pressed = doc.querySelector<HTMLElement>('[data-planchette-target="spell-toggle"]')!;
    pressed.setAttribute("aria-pressed", "true");
    const fg = colourOf(pressed, "color");
    const bg = bgOf(pressed);
    expect(ratio(fg, bg), "pressed").toBeGreaterThanOrEqual(4.5);
    // Scan highlight (skeleton scan-highlight.ts): rgba(255, 212, 0, 0.45) over the target fill.
    const tinted = [0, 1, 2].map((i) => [255, 212, 0][i] * 0.45 + bg[i] * 0.55);
    expect(ratio(fg, tinted), "pressed + scan tint").toBeGreaterThanOrEqual(4.5);
    const plain = parseColour("#ffffff");
    const tintedPlain = [0, 1, 2].map((i) => [255, 212, 0][i] * 0.45 + plain[i] * 0.55);
    expect(ratio(colourOf(doc.querySelector(".prediction-strip button")!, "color"), tintedPlain)).toBeGreaterThanOrEqual(4.5);
    pressed.setAttribute("aria-pressed", "false");
    const disabled = doc.querySelector("#settings button:disabled")!;
    expect(ratio(colourOf(disabled, "color"), bgOf(disabled)), "disabled").toBeGreaterThanOrEqual(4.5);
  });
});

describe("board.css UI part colours (Req 9 AC 7; 3:1)", () => {
  const selector =
    ".target, button, select, textarea, input, #message-bar, .rest, [data-planchette='tracking-indicator'], #settings";
  it("every border has at least 3:1 against what is behind it", () => {
    const els = Array.from(doc.querySelectorAll(selector)).filter((e) => !e.hasAttribute("hidden"));
    expect(els.length).toBeGreaterThan(20);
    for (const e of els) {
      const cs = win.getComputedStyle(e);
      if (cs.borderTopStyle === "none" || cs.borderTopWidth === "0px") continue;
      const behind = e.parentElement === null ? parseColour("#ffffff") : bgOf(e.parentElement);
      expect(ratio(colourOf(e, "borderTopColor"), behind), `border ${label(e)}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("dashed placeholders (empty slot, disabled Previous/Next) keep a 3:1 dashed border", () => {
    expect(stripped).toMatch(/\.prediction-strip > button\[data-empty="true"\] \{[^}]*border-style: dashed/);
    expect(stripped).toMatch(/\.phrases-grid \[aria-disabled="true"\] \{[^}]*border-style: dashed/);
    for (const sel of [".prediction-strip [data-empty='true']", ".phrases-grid [aria-disabled='true']", "#settings button:disabled"]) {
      const e = doc.querySelector(sel)!;
      // The dashed style itself is checked in the e2e (jsdom drops it when the .target border-width longhand follows).
      expect(e.matches(sel)).toBe(true);
      expect(ratio(colourOf(e, "borderTopColor"), bgOf(e.parentElement!)), sel).toBeGreaterThanOrEqual(3);
    }
  });

  it("the focus ring colour has at least 3:1 against the page and the panel", () => {
    const focus = parseColour(vars.get("--focus")!);
    expect(ratio(focus, parseColour(vars.get("--bg")!))).toBeGreaterThanOrEqual(3);
    expect(ratio(focus, parseColour(vars.get("--panel")!))).toBeGreaterThanOrEqual(3);
    expect(stripped).toMatch(/button:focus-visible\s*\{\s*outline:\s*4px solid var\(--focus\)/);
  });
});

describe("board.css text size and motion (Req 9 AC 2, 3, 4)", () => {
  it("every font declaration is 24px or larger", () => {
    // jsdom does not inherit font-size through the shorthand, so check the declarations (the real
    // computed sizes of the live elements are checked in board-colours.e2e.ts).
    expect(stripped).toMatch(/body\s*\{[^}]*font:\s*24px/);
    for (const m of stripped.matchAll(/font(?:-size)?:\s*([\d.]+)(px|rem|em|pt)/g)) {
      const px = m[2] === "px" ? Number(m[1]) : m[2] === "pt" ? Number(m[1]) * (4 / 3) : Number(m[1]) * 16;
      expect(px, m[0]).toBeGreaterThanOrEqual(24);
    }
    expect(stripped).not.toMatch(/font(-size)?:\s*(small|smaller|x-small|xx-small|medium)\b/);
    expect(stripped).not.toMatch(/font-size:\s*\d+%/);
  });

  it("declares no transition, animation, keyframes or reduced-motion override", () => {
    expect(stripped).not.toMatch(/transition|animation|@keyframes|prefers-reduced-motion|blink/i);
  });
});
