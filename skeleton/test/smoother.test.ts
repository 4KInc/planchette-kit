/**
 * Tuning test for the One Euro smoother (Req 2 AC 4, design §2).
 *
 * Reference calibration: ±15° per axis, gain 1.0, 1920 × 1080. 1° = 1920 / 30 = 64 px.
 * Synthetic timestamped samples go straight into the filter. Camera and face-model
 * latency are outside the engine and not included.
 *
 * Targets, as written in the requirements:
 *  - Default preset (s = 0.5): a deliberate 20° head turn reaches 90 % of its target
 *    distance within 150 ms of the head arriving.
 *  - High-tremor preset (s = 0.9): tremor up to 1° at 4–12 Hz moves the pointer by
 *    less than 8 px.
 * Both apply at 30 fps or more with frame spacing varying by up to ±20 %. They are
 * asserted at 30, 60 and 120 fps, with even spacing and with ±20 % jitter over several
 * seeds. At 15 and 24 fps the values are measured and logged, not asserted.
 */

import { describe, it, expect } from 'vitest';
import {
  FC_DERIV_HZ,
  createSmootherState,
  cloneSmootherState,
  resetSmoother,
  smootherParams,
  stepSmoother,
} from '../src/engine/smoother';

const PX_PER_DEG = 1920 / 30; // 64 px
const DEFAULT_S = 0.5;
const HIGH_TREMOR_S = 0.9;
const LAG_LIMIT_MS = 150;
const TREMOR_LIMIT_PX = 8;
/** Frame rates where the targets are asserted. */
const ASSERTED_FPS = [30, 60, 120];
/** Frame rates below 30 fps: measured and logged only. */
const LOGGED_FPS = [15, 24];
const FPS = [...LOGGED_FPS, ...ASSERTED_FPS];
const JITTER = 0.2;
/** Even spacing (jitter 0) plus several jitter seeds. */
const TIMINGS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [JITTER, 3],
  [JITTER, 7],
  [JITTER, 17],
  [JITTER, 99],
  [JITTER, 2024],
  [JITTER, 4242],
];

/** Sample times in seconds, starting at 0. `jitter` is the fraction of dt each gap may vary by. */
function sampleTimes(fps: number, durationS: number, jitter: number, seed: number): number[] {
  // Small deterministic LCG so the test is reproducible.
  let x = seed >>> 0;
  const rand = () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
  const dt = 1 / fps;
  const out = [0];
  while (out[out.length - 1] < durationS) {
    out.push(out[out.length - 1] + dt * (1 + jitter * (2 * rand() - 1)));
  }
  return out;
}

/** Run the filter over `times` with angle(t); return the outputs. */
function filter(s: number, times: number[], angle: (t: number) => number): number[] {
  const st = createSmootherState();
  const out: number[] = [];
  for (let i = 0; i < times.length; i++) {
    const dt = i === 0 ? 0 : times[i] - times[i - 1];
    out.push(stepSmoother(st, { angle: angle(times[i]), dt, smoothingStrength: s }));
  }
  return out;
}

/**
 * A 20° turn from −10° to +10° (inside the ±15° reference range). `durationS` 0 is an
 * instant step; otherwise a smooth (cosine) turn. The head arrives at `start + duration`.
 * Returns the time from arrival until the output first reaches 90 % of the distance (18°).
 * Before the turn the head has been still at −10° for 1 s, so the filter has settled.
 */
function lagMs(s: number, fps: number, durationS: number, jitter: number, seed: number): number {
  const start = 1;
  const from = -10;
  const to = 10;
  const arrive = start + durationS;
  const angle = (t: number): number => {
    if (t < start) return from;
    if (t >= arrive) return to;
    const u = (t - start) / durationS;
    return from + (to - from) * (1 - Math.cos(Math.PI * u)) / 2;
  };
  // Samples taken at the camera's frame times. For an instant step the first frame that
  // sees the new position is the arrival.
  const times = sampleTimes(fps, arrive + 2, jitter, seed);
  const out = filter(s, times, angle);
  const goal = from + 0.9 * (to - from);
  let arrivalSample = times.findIndex((t) => t >= arrive);
  if (durationS === 0) arrivalSample = times.findIndex((t) => t >= start);
  const arrivalTime = times[arrivalSample];
  for (let i = 0; i < times.length; i++) {
    if (out[i] >= goal) return Math.max(0, times[i] - arrivalTime) * 1000;
  }
  return Infinity;
}

/**
 * Worst pointer movement (px) caused by tremor of `ampDeg` at `hz` around a still head
 * pose, after the filter has settled for 4 s, over the next 6 s. Movement is the largest
 * distance from the pose. The dead zone is not applied, so this is the off-centre worst case.
 */
function tremorPx(s: number, fps: number, hz: number, ampDeg: number, phase: number, jitter: number, seed: number): number {
  const pose = 5; // off centre
  const times = sampleTimes(fps, 10, jitter, seed);
  const out = filter(s, times, (t) => pose + ampDeg * Math.sin(2 * Math.PI * hz * t + phase));
  let worst = 0;
  for (let i = 0; i < times.length; i++) {
    if (times[i] >= 4) worst = Math.max(worst, Math.abs(out[i] - pose) * PX_PER_DEG);
  }
  return worst;
}

const HZ: number[] = [];
for (let f = 4; f <= 12 + 1e-9; f += 0.1) HZ.push(Math.round(f * 10) / 10);
const PHASES = [0, Math.PI / 3, (2 * Math.PI) / 3, Math.PI, (4 * Math.PI) / 3, (5 * Math.PI) / 3];

/** Worst lag (ms) over the given timings, for an instant step and smooth turns of 100 to 500 ms. */
function worstLag(s: number, fps: number, timings: ReadonlyArray<readonly [number, number]>): number {
  let worst = 0;
  for (const d of [0, 0.1, 0.2, 0.3, 0.5]) {
    for (const [jitter, seed] of timings) worst = Math.max(worst, lagMs(s, fps, d, jitter, seed));
  }
  return worst;
}

/** Worst tremor movement (px) over 4–12 Hz, amplitudes up to 1°, phases and the given timings. */
function worstTremor(
  s: number,
  fps: number,
  timings: ReadonlyArray<readonly [number, number]>,
): { px: number; hz: number } {
  let px = 0;
  let worstHz = 0;
  for (const [jitter, seed] of timings) {
    // Even spacing: fine frequency and phase grid. Jittered: a coarser grid per seed.
    const hzList = jitter === 0 ? HZ : HZ.filter((_, i) => i % 5 === 0);
    const phases = jitter === 0 ? PHASES : [0, Math.PI / 2];
    const amps = jitter === 0 ? [1] : [1, 0.5, 0.25];
    for (const hz of hzList) {
      for (const phase of phases) {
        for (const amp of amps) {
          const v = tremorPx(s, fps, hz, amp, phase, jitter, seed);
          if (v > px) {
            px = v;
            worstHz = hz;
          }
        }
      }
    }
  }
  return { px, hz: worstHz };
}

const EVEN = TIMINGS.filter(([j]) => j === 0);
const UNEVEN = TIMINGS.filter(([j]) => j > 0);

describe('tuning: default preset (s = 0.5) meets the lag target at 30 fps and above', () => {
  for (const fps of ASSERTED_FPS) {
    it(`a 20° turn reaches 90 % within 150 ms at ${fps} fps, even and ±20 % jittered spacing`, () => {
      const even = worstLag(DEFAULT_S, fps, EVEN);
      const uneven = worstLag(DEFAULT_S, fps, UNEVEN);
      console.log(
        `[tuning] s=${DEFAULT_S} lag to 90 % at ${fps} fps: even ${even.toFixed(1)} ms, ±20 % ${uneven.toFixed(1)} ms (limit ${LAG_LIMIT_MS} ms)`,
      );
      expect(even).toBeLessThanOrEqual(LAG_LIMIT_MS);
      expect(uneven).toBeLessThanOrEqual(LAG_LIMIT_MS);
    });
  }
});

describe('tuning: high-tremor preset (s = 0.9) meets the tremor target at 30 fps and above', () => {
  for (const fps of ASSERTED_FPS) {
    it(`tremor up to 1° at 4–12 Hz moves the pointer by less than 8 px at ${fps} fps, even and ±20 % jittered spacing`, () => {
      const even = worstTremor(HIGH_TREMOR_S, fps, EVEN);
      const uneven = worstTremor(HIGH_TREMOR_S, fps, UNEVEN);
      console.log(
        `[tuning] s=${HIGH_TREMOR_S} tremor at ${fps} fps: even ${even.px.toFixed(2)} px (${even.hz} Hz), ` +
          `±20 % ${uneven.px.toFixed(2)} px (${uneven.hz} Hz) (limit < ${TREMOR_LIMIT_PX} px)`,
      );
      expect(even.px).toBeLessThan(TREMOR_LIMIT_PX);
      expect(uneven.px).toBeLessThan(TREMOR_LIMIT_PX);
    });
  }
});

describe('tuning: below 30 fps (measured and reported, not asserted)', () => {
  it('logs lag and tremor at 15 and 24 fps, even and uneven spacing', () => {
    for (const fps of LOGGED_FPS) {
      const lagEven = worstLag(DEFAULT_S, fps, EVEN);
      const lagUneven = worstLag(DEFAULT_S, fps, UNEVEN);
      const trEven = worstTremor(HIGH_TREMOR_S, fps, EVEN);
      const trUneven = worstTremor(HIGH_TREMOR_S, fps, UNEVEN);
      console.log(
        `[tuning] ${fps} fps (not asserted): s=${DEFAULT_S} lag even ${lagEven.toFixed(1)} ms, ±20 % ${lagUneven.toFixed(1)} ms; ` +
          `s=${HIGH_TREMOR_S} tremor even ${trEven.px.toFixed(2)} px (${trEven.hz} Hz), ±20 % ${trUneven.px.toFixed(2)} px (${trUneven.hz} Hz)`,
      );
      // Only check that the measurement ran.
      expect(Number.isFinite(lagEven)).toBe(true);
      expect(Number.isFinite(trEven.px)).toBe(true);
    }
  });
});

describe('tuning: the other side of each preset (reported, not a target)', () => {
  it('logs default-preset tremor and high-tremor-preset lag', () => {
    const rows = FPS.map((fps) => {
      const tr = worstTremor(DEFAULT_S, fps, EVEN).px;
      const lag = worstLag(HIGH_TREMOR_S, fps, EVEN);
      return `${fps} fps: s=${DEFAULT_S} tremor ${tr.toFixed(2)} px, s=${HIGH_TREMOR_S} lag ${lag.toFixed(1)} ms`;
    });
    console.log(`[tuning] ${rows.join('; ')}`);
  });
});

describe('parameters', () => {
  it('logs the final parameters', () => {
    const d = smootherParams(DEFAULT_S);
    const h = smootherParams(HIGH_TREMOR_S);
    console.log(
      `[tuning] fC_deriv=${FC_DERIV_HZ} Hz; s=0.5: fC_min=${d.fCMin.toFixed(3)} Hz, beta=${d.beta.toFixed(4)}/deg; ` +
        `s=0.9: fC_min=${h.fCMin.toFixed(3)} Hz, beta=${h.beta.toFixed(4)}/deg`,
    );
    expect(FC_DERIV_HZ).toBe(1);
  });

  it('follows the formula: fC_min linear in s, beta log-linear in s', () => {
    expect(smootherParams(0)).toEqual({ fCMin: 1.5, beta: 0.4 });
    const one = smootherParams(1);
    expect(one.fCMin).toBeCloseTo(0.2, 12);
    expect(one.beta).toBeCloseTo(0.004, 12);
    expect(smootherParams(0.5).fCMin).toBeCloseTo(0.85, 12);
    expect(smootherParams(0.5).beta).toBeCloseTo(0.04, 12);
  });

  it('clamps s to [0, 1] and uses 0.5 for a non-finite s', () => {
    expect(smootherParams(-1)).toEqual(smootherParams(0));
    expect(smootherParams(2)).toEqual(smootherParams(1));
    expect(smootherParams(NaN)).toEqual(smootherParams(0.5));
  });

  it('more smoothing means less tremor and more lag', () => {
    const lag = [0, 0.25, 0.5, 0.75, 1].map((s) => lagMs(s, 60, 0, 0, 1));
    const trem = [0, 0.25, 0.5, 0.75, 1].map((s) => tremorPx(s, 60, 4, 1, 0, 0, 1));
    for (let i = 1; i < lag.length; i++) {
      expect(lag[i]).toBeGreaterThanOrEqual(lag[i - 1]);
      expect(trem[i]).toBeLessThan(trem[i - 1]);
    }
  });
});

describe('filter behaviour', () => {
  it('passes the first sample through unchanged', () => {
    const st = createSmootherState();
    expect(stepSmoother(st, { angle: 7.5, dt: 0, smoothingStrength: 0.5 })).toBe(7.5);
    expect(st).toEqual({ initialised: true, prev: 7.5, dPrev: 0 });
  });

  it('holds a constant input exactly', () => {
    const st = createSmootherState();
    for (let i = 0; i < 100; i++) {
      expect(stepSmoother(st, { angle: 3, dt: 1 / 60, smoothingStrength: 0.9 })).toBe(3);
    }
  });

  it('matches the design §2 equations for one step', () => {
    const st = createSmootherState();
    stepSmoother(st, { angle: 0, dt: 0, smoothingStrength: 0.5 });
    const dt = 1 / 60;
    const out = stepSmoother(st, { angle: 2, dt, smoothingStrength: 0.5 });
    const { fCMin, beta } = smootherParams(0.5);
    const aD = (2 * Math.PI * 1 * dt) / (1 + 2 * Math.PI * 1 * dt);
    const dHat = 0 + aD * (2 / dt - 0);
    const fC = fCMin + beta * Math.abs(dHat);
    const a = (2 * Math.PI * fC * dt) / (1 + 2 * Math.PI * fC * dt);
    expect(out).toBeCloseTo(0 + a * 2, 12);
    expect(st.dPrev).toBeCloseTo(dHat, 12);
  });

  it('reset makes the next sample pass through, so there is no jump after tracking loss', () => {
    const st = createSmootherState();
    for (let i = 0; i < 30; i++) stepSmoother(st, { angle: -10, dt: 1 / 30, smoothingStrength: 0.9 });
    resetSmoother(st);
    expect(stepSmoother(st, { angle: 12, dt: 1 / 30, smoothingStrength: 0.9 })).toBe(12);
  });

  it('ignores a non-finite angle and a dt that is not positive and finite', () => {
    const st = createSmootherState();
    stepSmoother(st, { angle: 1, dt: 0, smoothingStrength: 0.5 });
    stepSmoother(st, { angle: 2, dt: 1 / 60, smoothingStrength: 0.5 });
    const snap = cloneSmootherState(st);
    for (const bad of [
      { angle: NaN, dt: 1 / 60 },
      { angle: Infinity, dt: 1 / 60 },
      { angle: 5, dt: 0 },
      { angle: 5, dt: -1 },
      { angle: 5, dt: NaN },
      { angle: 5, dt: Infinity },
    ]) {
      expect(stepSmoother(st, { ...bad, smoothingStrength: 0.5 })).toBe(snap.prev);
      expect(st).toEqual(snap);
    }
  });

  it('reaches the same output at different frame rates for the same motion (within one frame)', () => {
    const at60 = lagMs(0.5, 60, 0.3, 0, 1);
    const at30 = lagMs(0.5, 30, 0.3, 0, 1);
    expect(Math.abs(at60 - at30)).toBeLessThanOrEqual(1000 / 30);
  });
});
