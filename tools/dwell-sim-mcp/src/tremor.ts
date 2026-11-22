/**
 * Tremor with a random phase and a slow size drift (design section 4.5).
 * A pure function of simulated time and the two streams. It holds no module state and no
 * caches: every call recomputes the phase and the two drift knots around t from u01
 * (three hashes per call), so equal-valued streams always give equal results.
 */
import { u01, type Stream } from "./rng.js";

/** The user parameters tremor reads. */
export interface TremorParams {
  tremorFrequencyHz: number;
  tremorPeakToPeakDeg: number;
  tremorDriftFraction: number;
}

/** One stream for the phase (Purpose.TremorPhase) and one for the drift knots (Purpose.TremorDriftKnot). */
export interface TremorStreams {
  phase: Stream;
  drift: Stream;
}

const KNOT_MS = 5000;

function phaseOf(s: Stream): number {
  return 2 * Math.PI * u01(s, 0);
}

/** U(i) = 2 u01(drift, i) - 1, in [-1, 1). */
function knotOf(s: Stream, i: number): number {
  return 2 * u01(s, i) - 1;
}

/** d(t), the drift in [-1, 1]: smoothstep blend of two knots 5 s apart. t in ms. */
export function tremorDrift(t: number, drift: Stream): number {
  const j = Math.floor(t / KNOT_MS);
  const x = t / KNOT_MS - j;
  const w = x * x * (3 - 2 * x);
  const a = knotOf(drift, j);
  const b = knotOf(drift, j + 1);
  return a + (b - a) * w;
}

/** a(t) in degrees peak to peak. */
export function tremorSize(t: number, params: TremorParams, streams: TremorStreams): number {
  return params.tremorPeakToPeakDeg * (1 + params.tremorDriftFraction * tremorDrift(t, streams.drift));
}

/** Tremor offset in degrees at simulated time `t` (ms). Exactly 0 when size or frequency is 0. */
export function tremorOffset(t: number, params: TremorParams, streams: TremorStreams): number {
  if (params.tremorPeakToPeakDeg === 0 || params.tremorFrequencyHz === 0) return 0;
  const phi = phaseOf(streams.phase);
  return (tremorSize(t, params, streams) / 2) * Math.sin((2 * Math.PI * params.tremorFrequencyHz * t) / 1000 + phi);
}
