// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Planchette } from "@planchette/skeleton";
import { createDwellRing } from "@planchette/skeleton/ui";

/**
 * Task 30.4: contrast of the dwell progress outline on the Board (Req 9 AC 4, 12; WCAG 1.4.11, 3:1).
 * The track, edge and arc colours are read from an outline built in jsdom with shape 'outline'
 * through the public API only. The backgrounds and --accent come from board.css,
 * and the scan highlight's tint from scan-highlight.ts source text, so a change to any of them
 * changes what is measured. The maths is the one in board-colours.test.ts.
 */
const rawCss = readFileSync(resolve(__dirname, "../board.css"), "utf8");
const scanSource = readFileSync(resolve(__dirname, "../../../skeleton/src/ui/scan-highlight.ts"), "utf8");

const vars = new Map<string, string>();
for (const m of rawCss.matchAll(/(--[\w-]+):\s*([^;]+);/g)) vars.set(m[1], m[2].trim());

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
const cssVar = (name: string): number[] => {
  const v = vars.get(name);
  if (v === undefined) throw new Error(`board.css has no ${name}`);
  return parseColour(v);
};

/** The outline's stroke colours, read from the SVG the skeleton builds. */
function outlineColours(): { edge: number[]; track: number[]; arc: number[]; raw: string[] } {
  const t = new EventTarget();
  const p = {
    addEventListener: (type: string, fn: EventListener) => t.addEventListener(type, fn),
    removeEventListener: (type: string, fn: EventListener) => t.removeEventListener(type, fn),
    getTargets: () => [{ id: "a", rect: { x: 10, y: 20, width: 128, height: 96 }, autoRepeat: false, role: "normal" }],
  } as unknown as Planchette;
  const ring = createDwellRing(p, { shape: "outline", reducedMotion: true });
  t.dispatchEvent(new CustomEvent("dwell-progress", { detail: { targetId: "a", progress: 0.5 } }));
  const read = (cls: string): string => {
    const el = ring.element.querySelector(`rect.planchette-ring-${cls}`);
    if (el === null) throw new Error(`no ${cls} rect`);
    return el.getAttribute("stroke") ?? "";
  };
  const raw = [read("edge"), read("track"), read("arc")];
  ring.destroy();
  return { edge: parseColour(raw[0]), track: parseColour(raw[1]), arc: parseColour(raw[2]), raw };
}

/** rgba(r, g, b, a) from the scan highlight's inset shadow, composed over a background. */
function scanTint(): { rgb: number[]; alpha: number } {
  const m = scanSource.match(/inset 0 0 0 9999px (rgba\([^)]*\))/);
  if (m === null) throw new Error("scan-highlight.ts: tint not found");
  const nums = parseColour(m[1]);
  return { rgb: nums.slice(0, 3), alpha: nums[3] };
}
const compose = (bg: number[]): number[] => {
  const { rgb, alpha } = scanTint();
  return [0, 1, 2].map((i) => rgb[i] * alpha + bg[i] * (1 - alpha));
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("dwell outline contrast (Req 9 AC 12; 3:1)", () => {
  const { edge, track, arc, raw } = outlineColours();
  const accent = cssVar("--accent");
  const states: Record<string, number[]> = {
    "normal (--panel)": cssVar("--panel"),
    "pressed (--pressed)": cssVar("--pressed"),
    "scan-highlighted (--panel + tint)": compose(cssVar("--panel")),
    "scan-highlighted and pressed (--pressed + tint)": compose(cssVar("--pressed")),
    "empty or dashed (--bg)": cssVar("--bg"),
  };
  const measured: string[] = [];
  const check = (name: string, value: number, floor = 3): void => {
    measured.push(`${name}: ${value.toFixed(2)}`);
    expect(value, name).toBeGreaterThanOrEqual(floor);
  };

  it("reads the colours the skeleton draws, and the tint from the scan highlight source", () => {
    // Read from the rendered SVG only. The skeleton's own tests pin the constants.
    expect([edge, track, arc]).toEqual([
      [255, 255, 255],
      [17, 17, 17],
      [255, 212, 0],
    ]);
    expect(raw).toHaveLength(3);
    expect(scanTint()).toEqual({ rgb: [255, 212, 0], alpha: 0.45 });
  });

  for (const [state, bg] of Object.entries(states)) {
    it(`track against ${state} is at least 3:1`, () => {
      check(`track on ${state}`, ratio(track, bg));
    });
  }

  it("edge against the cell border (--accent) is at least 3:1", () => {
    check("edge on --accent", ratio(edge, accent));
  });

  it("arc against the track is at least 3:1", () => {
    check("arc on track", ratio(arc, track));
  });

  it("edge against the track is at least 3:1", () => {
    check("edge on track", ratio(edge, track));
  });

  it("track against --accent alone is below 3:1, which is why the edge exists", () => {
    const r = ratio(track, accent);
    measured.push(`track on --accent: ${r.toFixed(2)}`);
    expect(r).toBeLessThan(3);
  });
});
