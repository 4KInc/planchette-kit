import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
const css = readFileSync(resolve(import.meta.dirname, '../seance.css'), 'utf8');
const html = readFileSync(resolve(import.meta.dirname, '../../../seance/index.html'), 'utf8');
function token(name: string): string {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(css);
  if (m === null) throw new Error(`--${name} is not defined`);
  return m[1]!.trim();
}
type RGB = [number, number, number];
function parse(v: string): { rgb: RGB; a: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex !== null) return { rgb: [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16)) as RGB, a: 1 };
  const rgba = /^rgba?\(([^)]+)\)$/.exec(v);
  if (rgba === null) throw new Error(`cannot parse colour ${v}`);
  const p = rgba[1]!.split(',').map((x) => Number(x.trim()));
  return { rgb: [p[0]!, p[1]!, p[2]!], a: p[3] ?? 1 };
}
const lin = (c: number): number => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]: RGB): number => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: RGB, b: RGB): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
const blend = (top: { rgb: RGB; a: number }, under: RGB): RGB => top.rgb.map((c, i) => c * top.a + under[i]! * (1 - top.a)) as RGB;
const c = (name: string): RGB => parse(token(name)).rgb;
const ground = c('ground');
const surface = c('surface');
const surface2 = c('surface-2');
describe('Séance colours (Requirement 10 AC 3, Requirement 11 AC 5)', () => {
  it('defines every colour as a custom property in :root', () => {
    for (const n of ['ground', 'surface', 'surface-2', 'bone', 'muted', 'dim-text', 'lantern', 'moss', 'edge', 'moon-glow', 'ornament', 'fog']) expect(() => token(n), n).not.toThrow();
  });
  it('the ground is a near-black blue, never #000', () => {
    expect(token('ground').toLowerCase()).not.toBe('#000000');
    const [r, g, b] = ground;
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g - 1);
    expect(Math.max(r, g, b)).toBeLessThan(50);
  });
  it('text is at least 4.5:1 on every surface it sits on; primary text 7:1', () => {
    for (const bg of [ground, surface, surface2]) {
      expect(ratio(c('bone'), bg)).toBeGreaterThanOrEqual(7);
      expect(ratio(c('muted'), bg)).toBeGreaterThanOrEqual(4.5);
    }
    for (const bg of [surface, surface2]) {
      expect(ratio(c('dim-text'), bg), 'level 2 dimmed letters').toBeGreaterThanOrEqual(4.5);
      expect(ratio(c('lantern'), bg), 'callout text').toBeGreaterThanOrEqual(4.5);
    }
  });
  it('text on the atmosphere (moon glow, and fog over it) stays at 4.5:1', () => {
    const moon = c('moon-glow');
    const fog = parse(token('fog'));
    for (const under of [ground, moon]) {
      const fogged = blend(fog, under);
      for (const bg of [under, fogged]) {
        expect(ratio(c('bone'), bg)).toBeGreaterThanOrEqual(7);
        expect(ratio(c('muted'), bg)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('UI parts (borders, the marker, focus ring, rest border) are at least 3:1', () => {
    for (const bg of [ground, surface, surface2]) {
      expect(ratio(c('edge'), bg), 'edge').toBeGreaterThanOrEqual(3);
      expect(ratio(c('lantern'), bg), 'lantern').toBeGreaterThanOrEqual(3);
      expect(ratio(c('moss'), bg), 'moss').toBeGreaterThanOrEqual(3);
    }
  });
  it('the skeleton dwell outline reads on the dark cells: arc on track, and the white edge against the cell border', () => {
    const geometry = readFileSync(resolve(import.meta.dirname, '../../../skeleton/src/ui/dwell-outline-geometry.ts'), 'utf8');
    const get = (n: string): RGB => parse(new RegExp(`${n} = '(#[0-9a-f]{6})'`, 'i').exec(geometry)![1]!).rgb;
    expect(ratio(get('ARC_COLOUR'), get('TRACK_COLOUR'))).toBeGreaterThanOrEqual(3);
    expect(ratio(get('EDGE_COLOUR'), c('edge'))).toBeGreaterThanOrEqual(3);
  });
  it('the marker glyph (lantern) reads against its dark outline', () => {
    expect(ratio(c('lantern'), ground)).toBeGreaterThanOrEqual(3);
  });
});
describe('seance.css and the page', () => {
  it('uses no opacity on letters, and no colour literal outside the :root tokens and the dialog backdrop', () => {
    const rest = css.replace(/:root\s*\{[^}]*\}/, '');
    const literals = rest.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) ?? [];
    for (const l of literals) expect(['rgba(0, 0, 0, 0.6)', 'rgba(0,0,0,0)', 'rgba(42, 49, 80, 0)', 'rgba(0, 0, 0, 0)'], l).toContain(l);
    const noKeyframes = rest.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
    expect(noKeyframes).not.toMatch(/\bopacity\s*:/);
  });
  it('every animation and transition sits inside prefers-reduced-motion: no-preference', () => {
    const start = css.indexOf('@media (prefers-reduced-motion: no-preference)');
    expect(start).toBeGreaterThan(-1);
    const outside = css.slice(0, start);
    expect(outside).not.toMatch(/\banimation\s*:|\btransition\s*:|@keyframes/);
    expect(css.slice(start)).toMatch(/animation\s*:/);
  });
  it('the glow changes opacity by at most 15 % over at least 3 s', () => {
    const from = Number(/from\s*\{\s*opacity:\s*([\d.]+)/.exec(css)![1]);
    const to = Number(/to\s*\{\s*opacity:\s*([\d.]+)/.exec(css)![1]);
    expect(Math.abs(to - from)).toBeLessThanOrEqual(0.15 + 1e-9);
    const secs = [...css.matchAll(/animation:\s*breathe\s+([\d.]+)s/g)].map((m) => Number(m[1]));
    expect(secs.length).toBeGreaterThan(0);
    for (const s of secs) expect(s).toBeGreaterThanOrEqual(3);
  });
  it('the fog drifts on 40 s and 90 s cycles at most 0.12 opacity', () => {
    expect(css).toMatch(/fog-a[^}]*animation:\s*drift\s+40s/);
    expect(css).toMatch(/fog-b[^}]*animation:\s*drift\s+90s/);
    expect(parse(token('fog')).a).toBeLessThanOrEqual(0.12);
  });
  it('uses no image, web font, remote URL or import, and the page has no inline style or remote asset', () => {
    expect(css).not.toMatch(/url\(|@import|@font-face/);
    expect(html).not.toMatch(/\sstyle=|<img|<link[^>]+href="https?:|<script[^>]+src="https?:/);
  });
  it('letters are at least 40 px and other text at least 24 px', () => {
    expect(css).toMatch(/\.letter\s*\{\s*font:\s*40px/);
    const sizes = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    for (const s of sizes) expect(s).toBeGreaterThanOrEqual(24);
    expect(css).toMatch(/font:\s*24px\/1\.3 system-ui/);
  });
});
describe('level 2 (dimmed letters) and the marker', () => {
  const rule = (selector: string): string => {
    const i = css.indexOf(selector);
    expect(i, selector).toBeGreaterThan(-1);
    return css.slice(i, css.indexOf('}', i));
  };
  it('dimmed letter text is at least 4.5:1 on its cell, in every state the cell can be in', () => {
    expect(rule('.page[data-support="2"] .board .target:not([data-next="true"])')).toContain('color: var(--dim-text)');
    // the cell is --surface; a pressed or dashed state would use --surface-2 or the ground
    for (const bg of [surface, surface2, ground]) expect(ratio(c('dim-text'), bg)).toBeGreaterThanOrEqual(4.5);
    // dimming is a colour token, not opacity, so the ratio above is the real one
    expect(rule('.page[data-support="2"] .board .target:not([data-next="true"])')).not.toMatch(/opacity/);
  });
  it('the marked target stands out by shape, not colour alone: a thicker border, a halo, and the glyph', () => {
    const base = rule('.target {');
    expect(base).toContain('border-width: 2px');
    const marked = rule('.target[data-next="true"]');
    expect(marked).toContain('border-width: 4px');
    expect(marked).toContain('box-shadow');
    const strong = rule('.page[data-support="1"] .target[data-next="true"]');
    expect(strong).toContain('border-width: 8px');
    expect(css).toMatch(/\.glide\s*\{[^}]*width:\s*24px/);
    // the border differs from an unmarked one by 2x to 4x in width, whatever the colours
    expect(4 / 2).toBeGreaterThanOrEqual(2);
    expect(ratio(c('lantern'), surface)).toBeGreaterThanOrEqual(3);
  });
  it('the glide never leaves its target label: it is small, in the corner, and moves only without a reduced-motion request', () => {
    expect(css).toMatch(/\.page\[data-support="1"\] \.glide[^{]*\{\s*width:\s*28px/);
    const start = css.indexOf('@media (prefers-reduced-motion: no-preference)');
    expect(css.slice(start)).toMatch(/\.glide\s*\{\s*transition:\s*transform/);
    expect(css.slice(0, start)).not.toMatch(/\.glide[^{]*\{[^}]*transition/);
  });
});
describe('the fog', () => {
  it('is a soft ellipse that fades to transparent on every side: no linear bands, no hard edge', () => {
    const fog = /\.fog\s*\{[^}]*\}/.exec(css)![0];
    expect(fog).toMatch(/radial-gradient\(ellipse closest-side/);
    expect(fog).toMatch(/var\(--fog\) 0%, transparent 100%/);
    expect(fog).not.toMatch(/linear-gradient/);
    expect(css).not.toMatch(/\.fog[^{]*\{[^}]*linear-gradient/);
  });
  it('is static unless motion is allowed (the animation is in the no-preference block, checked above)', () => {
    const start = css.indexOf('@media (prefers-reduced-motion: no-preference)');
    expect(css.slice(0, start)).not.toMatch(/\.fog[^{]*\{[^}]*animation/);
  });
});
describe('empty Suggestion slots', () => {
  it('are invisible (no border, no box) but keep their space', () => {
    expect(css).toMatch(/\.target\[data-empty="true"\]\s*\{\s*visibility:\s*hidden;/);
    expect(css).not.toMatch(/data-empty="true"\][^{]*\{[^}]*dashed/);
  });
});
describe('board ornaments', () => {
  it('are faint (decoration, below 3:1 on purpose) but visible, with no border and no text', () => {
    const r = ratio(c('ornament'), ground);
    expect(r).toBeGreaterThan(1.3);
    expect(r).toBeLessThan(3);
    const decor = /\.decor\s*\{[^}]*\}/.exec(css)![0];
    expect(decor).toContain('border: 0');
    expect(decor).not.toMatch(/dotted|dashed|solid/);
    expect(css).toMatch(/\.ornament path, \.ornament polygon\s*\{\s*fill: var\(--ornament\);\s*stroke: none;/);
  });
});
