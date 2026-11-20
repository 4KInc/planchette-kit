/**
 * smoother.ts — One Euro filter on head angles (design §2).
 *
 * Pure logic: time arrives as `dt`; no clocks, DOM or devices. No dependencies.
 * One instance filters one axis (yaw or pitch), in degrees.
 *
 * The filter parameters follow the smoothing strength `s` (profile field,
 * 0 to 1). The constants below are set by the tuning test (smoother.test.ts).
 */

/** Cutoff of the derivative low-pass in Hz. Fixed, not a profile field. */
export const FC_DERIV_HZ = 1;

/** Largest derivative the filter works with (deg/s). Keeps extreme inputs finite. */
const MAX_RATE_DEG_PER_S = 1e6;

export interface SmootherState {
  /** False until the first sample after creation or reset. */
  initialised: boolean;
  /** Previous filtered value (degrees). */
  prev: number;
  /** Previous derivative estimate (deg/s). */
  dPrev: number;
}

export interface SmootherInput {
  /** Raw centred angle in degrees. */
  angle: number;
  /** Seconds since the previous sample, `dt > 0`. */
  dt: number;
  /** Profile smoothing strength, 0 to 1. */
  smoothingStrength: number;
}

export function createSmootherState(): SmootherState {
  return { initialised: false, prev: 0, dPrev: 0 };
}

export function cloneSmootherState(s: SmootherState): SmootherState {
  return { initialised: s.initialised, prev: s.prev, dPrev: s.dPrev };
}

/** Forget the filter history, for example after a tracking loss (design §2). */
export function resetSmoother(s: SmootherState): void {
  s.initialised = false;
  s.prev = 0;
  s.dPrev = 0;
}

/**
 * Filter parameters for a smoothing strength `s`.
 *   fCMin = FC_MIN_AT_0 − (FC_MIN_AT_0 − FC_MIN_AT_1) × s
 *   beta  = BETA_AT_0 × (BETA_AT_1 / BETA_AT_0) ^ s      (log-linear)
 * A non-finite `s` uses the default 0.5. `s` is clamped to [0, 1].
 */
export const FC_MIN_AT_0 = 1.5;
export const FC_MIN_AT_1 = 0.2;
export const BETA_AT_0 = 0.4;
export const BETA_AT_1 = 0.004;

export function smootherParams(s: number): { fCMin: number; beta: number } {
  const x = Number.isFinite(s) ? Math.min(1, Math.max(0, s)) : 0.5;
  return {
    fCMin: FC_MIN_AT_0 - (FC_MIN_AT_0 - FC_MIN_AT_1) * x,
    beta: BETA_AT_0 * Math.pow(BETA_AT_1 / BETA_AT_0, x),
  };
}

/** alpha = k / (1 + k) with k = 2π × fc × dt. Stays in [0, 1] even when k overflows. */
function alphaOf(fc: number, dt: number): number {
  const k = 2 * Math.PI * fc * dt;
  return Number.isFinite(k) ? k / (1 + k) : 1;
}

/**
 * Filter one sample and return the filtered angle. Mutates `state` in place.
 *
 * The first sample after creation or reset is returned unchanged (`prev = x`,
 * `dPrev = 0`). A sample with a non-finite angle, or with a `dt` that is not a
 * positive finite number, changes nothing and returns the previous output.
 */
export function stepSmoother(state: SmootherState, input: SmootherInput): number {
  const x = input.angle;
  if (!Number.isFinite(x)) return state.prev;

  if (!state.initialised) {
    state.initialised = true;
    state.prev = x;
    state.dPrev = 0;
    return x;
  }

  const dt = input.dt;
  if (!(dt > 0) || !Number.isFinite(dt)) return state.prev;

  const { fCMin, beta } = smootherParams(input.smoothingStrength);

  const dx = Math.max(-MAX_RATE_DEG_PER_S, Math.min(MAX_RATE_DEG_PER_S, (x - state.prev) / dt));
  const dHat = state.dPrev + alphaOf(FC_DERIV_HZ, dt) * (dx - state.dPrev);
  const fC = fCMin + beta * Math.abs(dHat);
  const a = alphaOf(fC, dt);
  // Written as a convex combination so it stays finite for any finite inputs.
  const out = state.prev * (1 - a) + x * a;

  state.prev = out;
  state.dPrev = dHat;
  return out;
}
