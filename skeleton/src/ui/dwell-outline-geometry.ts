/**
 * dwell-outline-geometry.ts — the pure geometry of the dwell outline (Board spec, design.md
 * "Dwell progress outline"). No DOM. Given an element's border box, its border width and its
 * corner radius, it returns the three concentric strokes drawn just inside the border:
 * a light edge, a dark track and the progress arc.
 *
 * Coordinates are in the outline SVG's own space: the SVG sits on the border box, so the
 * box runs from (0, 0) to (width, height). Each stroke is a rect drawn on its centre line.
 */

/** Edge: 1 px white, directly inside the border. */
export const EDGE_WIDTH = 1;
export const EDGE_COLOUR = '#ffffff';
/** Track: 4 px near-black, inside the edge. */
export const TRACK_WIDTH = 4;
export const TRACK_COLOUR = '#111111';
/** Arc: 2 px lantern yellow, centred on the track (1 px of track on each side). */
export const ARC_WIDTH = 2;
export const ARC_COLOUR = '#ffd400';

export interface OutlineSize {
  width: number;
  height: number;
}

export type OutlineStrokeName = 'edge' | 'track' | 'arc';

export interface OutlineStroke {
  name: OutlineStrokeName;
  colour: string;
  /** Stroke width in px. */
  strokeWidth: number;
  /** Distance from the border box to the band's outer side. */
  outer: number;
  /** Distance from the border box to the band's centre line (where the rect is drawn). */
  inset: number;
  /** The rect on the centre line. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Corner radius of the centre-line rect: max(0, radius - inset), kept within half the shorter side. */
  radius: number;
  /** Length of the centre-line path: 2 (w + h) - 8 r + 2 pi r. */
  perimeter: number;
}

export interface OutlineGeometry {
  edge: OutlineStroke;
  track: OutlineStroke;
  arc: OutlineStroke;
}

function finiteNonNegative(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function stroke(
  name: OutlineStrokeName,
  colour: string,
  strokeWidth: number,
  outer: number,
  size: OutlineSize,
  radius: number,
): OutlineStroke {
  const inset = outer + strokeWidth / 2;
  const width = Math.max(0, size.width - 2 * inset);
  const height = Math.max(0, size.height - 2 * inset);
  const r = Math.min(Math.max(0, radius - inset), Math.min(width, height) / 2);
  const perimeter = 2 * (width + height) - 8 * r + 2 * Math.PI * r;
  return { name, colour, strokeWidth, outer, inset, x: inset, y: inset, width, height, radius: r, perimeter };
}

/**
 * @param rect   the element's border box size
 * @param border the computed border width (px)
 * @param radius the computed corner radius (px)
 */
export function outlineGeometry(rect: OutlineSize, border: number, radius: number): OutlineGeometry {
  const size = { width: finiteNonNegative(rect.width), height: finiteNonNegative(rect.height) };
  const b = finiteNonNegative(border);
  const rad = finiteNonNegative(radius);
  return {
    edge: stroke('edge', EDGE_COLOUR, EDGE_WIDTH, b, size, rad),
    track: stroke('track', TRACK_COLOUR, TRACK_WIDTH, b + EDGE_WIDTH, size, rad),
    arc: stroke('arc', ARC_COLOUR, ARC_WIDTH, b + EDGE_WIDTH + (TRACK_WIDTH - ARC_WIDTH) / 2, size, rad),
  };
}
