/**
 * Task 12.3 — the edge cases that P15 (frame-rate.props.test.ts) leaves out, as examples.
 * These record what the engine actually does at 15 fps and at 60 fps. They are not
 * targets: if one of them changes, the change in behaviour is deliberate or it is a bug.
 *
 * Why the frame rate shows at these edges: a dwell stay counts the time between its
 * first and its last sample on the target (design §5, "Samples are levels"). A sample
 * that lands just after the pointer arrives, or just before it leaves, decides how much
 * of the stay is seen. At 15 fps that is up to 66.7 ms at each end, at 60 fps 16.7 ms.
 *
 * Every path below moves through a face loss, so the smoother restarts at the new
 * position and the pointer path is the same at both frame rates (P15 condition B3),
 * except the tremor examples, which keep the face.
 */
import { describe, expect, it } from 'vitest';
import { createPlanchette } from '../src/index';
import { createDwellState, stepDwell } from '../src/engine/dwell';
import { defaultProfile } from '../src/engine/profile';
import { CENTRE, SCREEN, cameraSamples, type PointerPath } from './pointer-path';

const A_RECT = { x: 100, y: 100, width: 200, height: 200 };
const B_RECT = { x: 600, y: 100, width: 200, height: 200 };
const ON_A = { x: 200, y: 200 };
const ON_B = { x: 700, y: 200 };
const PX_PER_DEG = 999 / 29; // default mapping: 29° of usable head turn across 999 px

/** Selects at one frame rate, as "id@time" with the time to 0.1 ms; '-' for none. */
function selectsAt(path: PointerPath, fps: number, end: number, dwellTime = 1000): string {
  const p = createPlanchette({ screen: SCREEN, profile: { mode: 'head + dwell', dwellTime } });
  p.registerTarget('a', A_RECT);
  p.registerTarget('b', B_RECT);
  const out: string[] = [];
  p.addEventListener('select', (e) => out.push(`${e.detail.targetId}@${e.detail.now.toFixed(1)}`));
  p.feedSamples(cameraSamples(path, fps, end));
  return out.join(',') || '-';
}

/** Centre step until 2000 ms, no face until `from`, on target A for `ms`, then no face. */
function stayOnA(from: number, ms: number): PointerPath {
  return (t) => (t < 2000 ? CENTRE : t >= from && t < from + ms ? ON_A : null);
}

describe('a stay within 67 ms of the dwell time (dwell 1000 ms)', () => {
  it('a stay starting on a 15 fps frame: the outcome is the same at both rates', () => {
    const A = (31 * 1000) / 15; // 2066.7 ms, a 15 fps frame time
    for (const [ms, expected] of [
      [990, '-'],
      [1000, '-'], // the last sample on the target is 1000 ms after the first, minus a frame
      [1010, 'a@3066.7'],
      [1060, 'a@3066.7'],
    ] as const) {
      expect(selectsAt(stayOnA(A, ms), 15, 5000), `${ms} ms at 15 fps`).toBe(expected);
      expect(selectsAt(stayOnA(A, ms), 60, 5000), `${ms} ms at 60 fps`).toBe(expected);
    }
  });

  it('a stay starting between 15 fps frames: 10 ms over the dwell time selects at 60 fps only', () => {
    // On the target from 2030 ms. The first 15 fps sample on it is at 2066.7 ms, so 15 fps
    // sees 36.7 ms less of the stay than 60 fps (first sample 2033.3 ms).
    expect(selectsAt(stayOnA(2030, 1000), 15, 5000)).toBe('-');
    expect(selectsAt(stayOnA(2030, 1000), 60, 5000)).toBe('-');
    expect(selectsAt(stayOnA(2030, 1010), 15, 5000)).toBe('-');
    expect(selectsAt(stayOnA(2030, 1010), 60, 5000)).toBe('a@3033.3');
    // 40 ms over: both select, 33.3 ms apart.
    expect(selectsAt(stayOnA(2030, 1040), 15, 5000)).toBe('a@3066.7');
    expect(selectsAt(stayOnA(2030, 1040), 60, 5000)).toBe('a@3033.3');
  });

  it('a stay that begins inside the post-selection pause can differ by more than one 15 fps frame', () => {
    // Dwell 1174 ms. A is selected 66.7 ms apart (3266.7 and 3200), so the pause ends
    // 66.7 ms apart, and B, entered during the pause, counts from the pause end and adds
    // its own frame rounding: 116.7 ms apart. This is why P15 leaves it out (B4).
    const path: PointerPath = (t) =>
      t < 2000 ? CENTRE : t >= 2001 && t < 3300 ? ON_A : t < 3467 ? null : t < 6141 ? ON_B : null;
    expect(selectsAt(path, 15, 6500, 1174)).toBe('a@3266.7,b@5000.0');
    expect(selectsAt(path, 60, 6500, 1174)).toBe('a@3200.0,b@4883.3');
  });

  it('known quirk: 15 frame intervals of 66.7 ms add up to 999.9999999999995 ms, one frame short of 1000', () => {
    // The dwell timer adds each sample interval, and the float sum of 15 intervals of
    // 1000/15 ms is just below 1000, so a stay that is exactly the dwell time long, counted
    // in 15 fps frames, selects one frame late. Real camera timestamps rarely land on exact
    // multiples, and the effect is one frame at most. Recorded, not changed here.
    const s = createDwellState();
    const targets = [{ id: 'a', rect: { x: 0, y: 0, width: 10, height: 10 }, autoRepeat: false, role: 'default' as const }];
    const fired: number[] = [];
    for (let k = 56; k <= 72; k++) {
      const now = (k * 1000) / 15;
      for (const e of stepDwell(s, { pointer: { x: 5, y: 5 }, targets }, now, defaultProfile)) {
        if (e.type === 'select') fired.push(k - 56);
      }
      if (k === 71) expect(s.accumulated).toBe(999.9999999999995);
    }
    expect(fired).toEqual([16]); // after 16 intervals, not 15
  });
});

describe('the pointer within 20 px of a target edge', () => {
  it('a still pointer: the rectangle includes its left and top edge and excludes its right and bottom edge, at both rates', () => {
    for (const [x, expected] of [
      [99, '-'],
      [100, 'a@3066.7'],
      [101, 'a@3066.7'],
      [299, 'a@3066.7'],
      [300, '-'],
    ] as const) {
      const path: PointerPath = (t) => (t < 2000 ? CENTRE : t >= 2066.6666666666665 && t < 4000 ? { x, y: 200 } : null);
      expect(selectsAt(path, 15, 4500), `x = ${x} at 15 fps`).toBe(expected);
      expect(selectsAt(path, 60, 4500), `x = ${x} at 60 fps`).toBe(expected);
    }
  });

  /** Resting `d` px inside target A's left edge (x = 100) with a 6 Hz head tremor of `amp` degrees. */
  function tremorNearEdge(d: number, amp: number): PointerPath {
    return (t) =>
      t < 2000 ? CENTRE : t < 6000 ? { x: 100 + d + amp * PX_PER_DEG * Math.sin((2 * Math.PI * 6 * t) / 1000), y: 200 } : null;
  }

  it('with tremor across the edge, one frame rate can select while the other does not', () => {
    // On the edge with 0.6° of tremor the smoothed pointer crosses the edge many times a
    // second. The 15 fps samples fall on other phases of the 6 Hz tremor than the 60 fps
    // ones, so they see the pointer outside at different moments, and the grace time and
    // stay rules give a different result.
    expect(selectsAt(tremorNearEdge(0, 0.6), 15, 6500)).toBe('-');
    expect(selectsAt(tremorNearEdge(0, 0.6), 60, 6500)).toBe('a@4116.7');
    // 2 px outside the edge: the same.
    expect(selectsAt(tremorNearEdge(-2, 0.6), 15, 6500)).toBe('-');
    expect(selectsAt(tremorNearEdge(-2, 0.6), 60, 6500)).toBe('a@5416.7');
    // On the edge with 0.3°: both select, 466.7 ms apart.
    expect(selectsAt(tremorNearEdge(0, 0.3), 15, 6500)).toBe('a@4400.0');
    expect(selectsAt(tremorNearEdge(0, 0.3), 60, 6500)).toBe('a@3933.3');
  });

  it('with tremor, 5 px inside the edge both select, up to one 15 fps frame apart', () => {
    expect(selectsAt(tremorNearEdge(5, 0.6), 15, 6500)).toBe('a@3066.7');
    expect(selectsAt(tremorNearEdge(5, 0.6), 60, 6500)).toBe('a@3133.3');
  });

  it('20 px or more inside the edge, the tremor no longer reaches it and the rates agree within a frame', () => {
    for (const amp of [0.3, 0.6]) {
      expect(selectsAt(tremorNearEdge(20, amp), 15, 6500)).toBe('a@3066.7');
      expect(selectsAt(tremorNearEdge(20, amp), 60, 6500)).toBe('a@3033.3');
    }
  });
});
