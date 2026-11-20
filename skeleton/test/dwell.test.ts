import { describe, it, expect } from 'vitest';
import {
  MAX_SAMPLE_GAP_MS,
  createDwellState,
  cloneDwellState,
  stepDwell,
  type DwellEvent,
  type DwellState,
} from '../src/engine/dwell';
import type { DwellTarget } from '../src/engine/targets';
import { defaultProfile, type Profile } from '../src/engine/profile';

const A: DwellTarget = {
  id: 'A',
  rect: { x: 0, y: 0, width: 100, height: 100 },
  autoRepeat: false,
  role: 'default',
};
const B: DwellTarget = {
  id: 'B',
  rect: { x: 200, y: 0, width: 100, height: 100 },
  autoRepeat: false,
  role: 'default',
};
const ON_A = { x: 50, y: 50 };
const ON_B = { x: 250, y: 50 };
const OFF = { x: 500, y: 500 };

// dwell 1000, grace 150, pause 500, repeat 1000, input timeout 2000
const P: Profile = { ...defaultProfile };

type Pt = { x: number; y: number } | null;
type Timed = DwellEvent & { at: number };
type TimedSelect = Extract<DwellEvent, { type: 'select' }> & { at: number };

/** Step a list of [now, pointer] samples and return every event with its sample time. */
function feed(
  s: DwellState,
  samples: Array<[number, Pt]>,
  targets: DwellTarget[] = [A],
  p: Profile = P,
): Timed[] {
  const out: Timed[] = [];
  for (const [t, pointer] of samples) {
    for (const e of stepDwell(s, { pointer, targets }, t, p)) out.push({ ...e, at: t });
  }
  return out;
}

/** Samples every `dt` ms from t0 to t1 inclusive at one position. */
function span(t0: number, t1: number, pos: Pt, dt = 10): Array<[number, Pt]> {
  const out: Array<[number, Pt]> = [];
  for (let t = t0; t <= t1; t += dt) out.push([t, pos]);
  return out;
}

const selects = (ev: Timed[]): TimedSelect[] =>
  ev.filter((e): e is TimedSelect => e.type === 'select');
const progressOf = (ev: Timed[]): number[] =>
  ev.filter((e) => e.type === 'dwell-progress').map((e) => (e as { progress: number }).progress);

describe('basic dwell', () => {
  it('selects once, at the dwell time', () => {
    const s = createDwellState();
    const sel = selects(feed(s, span(0, 1500, ON_A)));
    expect(sel).toHaveLength(1);
    expect(sel[0].at).toBe(1000);
    expect(sel[0].targetId).toBe('A');
    expect(sel[0].source).toBe('dwell');
    expect(sel[0].role).toBe('default');
  });

  it('does not select just before the dwell time', () => {
    const s = createDwellState();
    expect(selects(feed(s, span(0, 990, ON_A)))).toHaveLength(0);
  });

  it('emits dwell-progress from 0 to 1 while on the target', () => {
    const s = createDwellState();
    const prog = progressOf(feed(s, span(0, 1000, ON_A, 100)));
    expect(prog).toHaveLength(11);
    prog.forEach((v, i) => expect(v).toBeCloseTo(i / 10, 10));
  });

  it('emits the progress event before the select event at the select sample', () => {
    const s = createDwellState();
    const ev = feed(s, span(0, 1000, ON_A, 100));
    expect(ev.slice(-2).map((e) => e.type)).toEqual(['dwell-progress', 'select']);
    expect(progressOf(ev).at(-1)).toBe(1);
  });

  it('shows 0 for the rest of a completed stay without auto-repeat, and selects once', () => {
    const s = createDwellState();
    const ev = feed(s, span(0, 3000, ON_A, 100));
    expect(selects(ev)).toHaveLength(1);
    const after = progressOf(ev.filter((e) => e.at > 1000));
    expect(after.every((v) => v === 0)).toBe(true);
  });

  it('carries the target role in the select event', () => {
    const undo: DwellTarget = { ...A, role: 'undo' };
    const s = createDwellState();
    const sel = selects(feed(s, span(0, 1000, ON_A, 100), [undo]));
    expect(sel[0].role).toBe('undo');
  });
});

describe('cancel-role target (Req 6 AC 1)', () => {
  const cancel: DwellTarget = { ...A, role: 'cancel' };

  it('emits cancel instead of select when the dwell time is reached', () => {
    const s = createDwellState();
    const ev = feed(s, span(0, 1100, ON_A, 100), [cancel]);
    expect(ev.filter((e) => e.type === 'cancel')).toHaveLength(1);
    expect(selects(ev)).toEqual([]);
  });

  it('cancels once per stay: resting on it does not repeat', () => {
    const s = createDwellState();
    const ev = feed(s, span(0, 10000, ON_A, 100), [cancel]);
    expect(ev.filter((e) => e.type === 'cancel')).toHaveLength(1);
  });

  it('ignores autoRepeat on a cancel target', () => {
    const s = createDwellState();
    const ev = feed(s, span(0, 10000, ON_A, 100), [{ ...cancel, autoRepeat: true }]);
    expect(ev.filter((e) => e.type === 'cancel')).toHaveLength(1);
  });

  it('autoRepeat still repeats a selection on an ordinary target', () => {
    const s = createDwellState();
    const ev = feed(s, span(0, 10000, ON_A, 100), [{ ...A, autoRepeat: true }]);
    expect(selects(ev).length).toBeGreaterThan(2);
  });

  it('cancels again after the pointer leaves and returns', () => {
    const s = createDwellState();
    const ev = feed(s, [...span(0, 1200, ON_A, 100), ...span(1300, 2500, OFF, 100), ...span(2600, 4000, ON_A, 100)], [cancel]);
    expect(ev.filter((e) => e.type === 'cancel')).toHaveLength(2);
  });

  it('does not count the post-selection pause toward another target', () => {
    const s = createDwellState();
    const ev = feed(s, [...span(0, 1100, ON_A, 100), ...span(1200, 1500, ON_B, 100)], [cancel, B]);
    expect(selects(ev)).toEqual([]);
  });
});

describe('sample gaps (MAX_SAMPLE_GAP_MS)', () => {
  it('is 100 ms', () => {
    expect(MAX_SAMPLE_GAP_MS).toBe(100);
  });

  it('a 1.9 s stall between two on-target samples adds only the cap, and does not select', () => {
    const s = createDwellState();
    const ev = feed(s, [[0, ON_A], [1900, ON_A]]);
    expect(selects(ev)).toHaveLength(0);
    expect(s.accumulated).toBe(MAX_SAMPLE_GAP_MS);
  });

  it('normal frame gaps from 16 to 100 ms count in full', () => {
    for (const dt of [16, 33, 50, 99, 100]) {
      const s = createDwellState();
      const samples: Array<[number, Pt]> = [];
      for (let i = 0; i <= 10; i++) samples.push([i * dt, ON_A]);
      feed(s, samples);
      expect(s.accumulated).toBe(10 * dt);
    }
  });

  it('a 10 fps camera selects at the dwell time', () => {
    const s = createDwellState();
    const sel = selects(feed(s, span(0, 1500, ON_A, 100)));
    expect(sel.map((e) => e.at)).toEqual([1000]);
  });

  it('a gap above the cap counts only the cap: samples every 150 ms need 10 gaps', () => {
    const s = createDwellState();
    const sel = selects(feed(s, span(0, 3000, ON_A, 150)));
    expect(sel.map((e) => e.at)).toEqual([1500]);
  });

  it('a stall in the middle of a stay costs nothing extra', () => {
    const s = createDwellState();
    // 0..500 at 10 ms (500 counted), stall to 1500 (+100), then 10 ms samples
    const ev = feed(s, [...span(0, 500, ON_A), ...span(1500, 2000, ON_A)]);
    // 600 counted at 1500, so 400 more are needed: select at 1900
    expect(selects(ev).map((e) => e.at)).toEqual([1900]);
  });
});

describe('grace time', () => {
  it('a gap within the grace time pauses the timer without resetting it', () => {
    const s = createDwellState();
    // 500 ms on, 100 ms gap (<= grace 150), then back on
    const ev = feed(s, [...span(0, 500, ON_A), [510, OFF], [550, OFF], [600, OFF], ...span(610, 2000, ON_A)]);
    // 500 accumulated; resume at 610 adds nothing; 500 more needed: select at 1110
    const sel = selects(ev);
    expect(sel).toHaveLength(1);
    expect(sel[0].at).toBe(1110);
  });

  it('a gap of exactly the grace time still resumes', () => {
    const s = createDwellState();
    const ev = feed(s, [...span(0, 500, ON_A), [575, OFF], ...span(650, 1500, ON_A)]);
    expect(selects(ev)[0].at).toBe(1150);
  });

  it('a gap longer than the grace time resets the timer to zero', () => {
    const s = createDwellState();
    const ev = feed(s, [...span(0, 900, ON_A), [910, OFF], [1000, OFF], ...span(1100, 2000, ON_A)]);
    expect(selects(ev)).toHaveLength(0);
    const ev2 = feed(s, span(2010, 2100, ON_A));
    expect(selects(ev2)).toHaveLength(1);
  });

  it('time off the target is never counted toward the dwell time', () => {
    const s = createDwellState();
    const ev = feed(s, [...span(0, 450, ON_A), [500, OFF], ...span(550, 1000, ON_A)]);
    expect(selects(ev)).toHaveLength(0);
    expect(selects(feed(s, span(1010, 1100, ON_A)))).toHaveLength(1);
  });

  it('with grace 0 any gap resets', () => {
    const p: Profile = { ...P, graceTime: 0 };
    const s = createDwellState();
    const ev = feed(s, [...span(0, 900, ON_A), [905, OFF], ...span(910, 1500, ON_A)], [A], p);
    expect(selects(ev)).toHaveLength(0);
  });

  it('a gap within grace after a select does not allow a second select', () => {
    const s = createDwellState();
    const ev = feed(s, [...span(0, 1000, ON_A), [1010, OFF], ...span(1020, 2500, ON_A)]);
    expect(selects(ev)).toHaveLength(1);
  });

  it('a new stay after leaving for longer than the grace time can select again', () => {
    const s = createDwellState();
    const ev = feed(s, [...span(0, 1000, ON_A), ...span(1010, 1400, OFF), ...span(1410, 2500, ON_A)]);
    // new stay from 1410; the pause ended at 1500, so counting starts at 1500: select at 2500
    expect(selects(ev).map((e) => e.at)).toEqual([1000, 2500]);
  });
});

describe('post-selection pause', () => {
  it('no dwell time counts during the pause: a target entered during it starts counting when it ends', () => {
    const s = createDwellState();
    // select A at 1000; pause until 1500. B entered at 1010, counting starts at 1500.
    const ev = feed(s, [...span(0, 1000, ON_A), ...span(1010, 3000, ON_B)], [A, B]);
    expect(selects(ev).map((e) => e.at)).toEqual([1000, 2500]);
  });

  it('with a long pause the next select waits for pause end plus the full dwell time', () => {
    const p: Profile = { ...P, dwellTime: 400, postSelectionPause: 3000 };
    const s = createDwellState();
    const ev = feed(s, [...span(0, 400, ON_A), ...span(410, 4000, ON_B)], [A, B], p);
    // A selected at 400, pause until 3400, B counts 400 ms from 3400: select at 3800
    expect(selects(ev).map((e) => e.at)).toEqual([400, 3800]);
  });

  it('progress is 0 during the pause on every target', () => {
    const s = createDwellState();
    const ev = feed(s, [...span(0, 1000, ON_A), ...span(1010, 1490, ON_B)], [A, B]);
    const during = ev.filter((e) => e.at > 1000 && e.type === 'dwell-progress');
    expect(during.length).toBeGreaterThan(0);
    expect(during.every((e) => (e as { progress: number }).progress === 0)).toBe(true);
  });

  it('only the part of an interval after the pause end counts', () => {
    const s2 = createDwellState();
    feed(s2, span(0, 1000, ON_A), [A, B]); // select at 1000, pause ends at 1500
    feed(s2, [[1100, ON_B], [1450, ON_B], [1550, ON_B]], [A, B]);
    // 1450 -> 1550 crosses the pause end at 1500: 50 ms count
    expect(s2.accumulated).toBe(50);
  });

  it('drops the pending stay if the pointer leaves for longer than grace during the pause', () => {
    const p: Profile = { ...P, dwellTime: 400, postSelectionPause: 3000 };
    const s = createDwellState();
    const ev = feed(
      s,
      [...span(0, 400, ON_A), ...span(410, 900, ON_B), ...span(910, 1200, OFF), ...span(1210, 3300, OFF)],
      [A, B],
      p,
    );
    expect(selects(ev).map((e) => e.at)).toEqual([400]);
  });

  it('the gap between any two selects is at least the pause', () => {
    const s = createDwellState();
    const ev = feed(s, [...span(0, 1000, ON_A), ...span(1010, 4000, ON_B)], [A, B]);
    const times = selects(ev).map((e) => e.at);
    expect(times.length).toBeGreaterThan(1);
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(P.postSelectionPause);
    }
  });
});

describe('auto-repeat', () => {
  const R: DwellTarget = { ...A, autoRepeat: true };

  it('is off by default: one select per stay', () => {
    const s = createDwellState();
    expect(selects(feed(s, span(0, 5000, ON_A)))).toHaveLength(1);
  });

  it('selects again once per repeat interval while the stay continues', () => {
    const s = createDwellState();
    const ev = feed(s, span(0, 4000, ON_A), [R]);
    expect(selects(ev).map((e) => e.at)).toEqual([1000, 2000, 3000, 4000]);
  });

  it('uses the larger of the repeat interval and the pause', () => {
    const p: Profile = { ...P, autoRepeatInterval: 500, postSelectionPause: 1500 };
    const s = createDwellState();
    const ev = feed(s, span(0, 5000, ON_A), [R], p);
    expect(selects(ev).map((e) => e.at)).toEqual([1000, 2500, 4000]);
  });

  it('uses the repeat interval when it is larger than the pause', () => {
    const p: Profile = { ...P, autoRepeatInterval: 2000, postSelectionPause: 500 };
    const s = createDwellState();
    const ev = feed(s, span(0, 5200, ON_A), [R], p);
    expect(selects(ev).map((e) => e.at)).toEqual([1000, 3000, 5000]);
  });

  it('progress is 0 in the pause, then runs 0 to 1 until the next select', () => {
    const s = createDwellState();
    const ev = feed(s, span(0, 2000, ON_A, 100), [R]);
    const prog = progressOf(ev);
    // dwell phase: 0, .1 ... 1 (the select sample); pause 1100..1400: 0; then 1500..2000
    const expected = [
      0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, // 0..1000
      0, 0, 0, 0, // 1100..1400, in the pause
      0, 0.2, 0.4, 0.6, 0.8, 1, // 1500..2000, then select
    ];
    expect(prog).toHaveLength(expected.length);
    expected.forEach((v, i) => expect(prog[i]).toBeCloseTo(v, 10));
    expect(selects(ev).map((e) => e.at)).toEqual([1000, 2000]);
  });
});

describe('rest area and empty space', () => {
  it('emits nothing when the pointer is over no target', () => {
    const s = createDwellState();
    expect(feed(s, span(0, 5000, OFF))).toEqual([]);
  });

  it('emits nothing for a null pointer', () => {
    const s = createDwellState();
    expect(feed(s, span(0, 5000, null))).toEqual([]);
  });

  it('never selects or reports progress on a rest-area target', () => {
    const rest: DwellTarget = { ...A, id: 'rest', role: 'rest-area' };
    const s = createDwellState();
    expect(feed(s, span(0, 5000, ON_A), [rest])).toEqual([]);
  });

  it('a rest area over a real target does not hide it', () => {
    const rest: DwellTarget = {
      id: 'rest',
      rect: { x: 0, y: 0, width: 1000, height: 1000 },
      autoRepeat: false,
      role: 'rest-area',
    };
    const s = createDwellState();
    expect(selects(feed(s, span(0, 1200, ON_A), [rest, A]))).toHaveLength(1);
  });

  it('ignores a non-finite pointer', () => {
    const s = createDwellState();
    expect(feed(s, span(0, 2000, { x: NaN, y: 50 }))).toEqual([]);
    expect(feed(s, span(2010, 4000, { x: Infinity, y: 50 }))).toEqual([]);
  });
});

describe('clearing event when a stay ends', () => {
  const cleared = (id: string, at: number): Timed => ({ type: 'dwell-progress', targetId: id, progress: 0, at });

  it('moving to a different target clears the old one, then reports the new one', () => {
    const s = createDwellState();
    feed(s, span(0, 500, ON_A), [A, B]);
    const ev = feed(s, [[510, ON_B]], [A, B]);
    expect(ev).toEqual([cleared('A', 510), cleared('B', 510)]);
  });

  it('exceeding the grace time clears the target once, at the first sample past it', () => {
    const s = createDwellState();
    feed(s, span(0, 500, ON_A));
    const ev = feed(s, span(510, 800, OFF));
    // last on-target sample 500; gap > 150 first true at 660
    expect(ev).toEqual([cleared('A', 660)]);
  });

  it('a gap within the grace time clears nothing', () => {
    const s = createDwellState();
    feed(s, span(0, 500, ON_A));
    expect(feed(s, span(510, 650, OFF))).toEqual([]);
  });

  it('a long gap with no off sample in between clears the old stay and starts a new one', () => {
    // off at 510, then back on at 700 (gap 200 > grace), no sample in between past grace
    const s = createDwellState();
    feed(s, span(0, 500, ON_A));
    feed(s, [[510, OFF]]);
    const ev = feed(s, [[700, ON_A]]);
    // the clearing event for the old stay, then the new stay's own progress 0
    expect(ev).toEqual([cleared('A', 700), cleared('A', 700)]);
  });

  it('the input timeout clears the old stay', () => {
    const s = createDwellState();
    feed(s, span(0, 900, ON_A));
    const ev = feed(s, [[2900, ON_A]]);
    expect(ev).toEqual([cleared('A', 2900), cleared('A', 2900)]);
    expect(selects(ev)).toHaveLength(0);
  });

  it('the input timeout clears the old stay when the next sample is off target', () => {
    const s = createDwellState();
    feed(s, span(0, 900, ON_A));
    expect(feed(s, [[2900, OFF]])).toEqual([cleared('A', 2900)]);
  });

  it('a lost pointer (null) ends the stay at once, even within the grace time', () => {
    const s = createDwellState();
    feed(s, span(0, 500, ON_A));
    expect(feed(s, [[510, null]])).toEqual([cleared('A', 510)]);
    // nothing more is emitted while the pointer stays lost
    expect(feed(s, span(520, 800, null))).toEqual([]);
    // coming back starts a fresh stay
    const ev = feed(s, [[810, ON_A]]);
    expect(ev).toEqual([cleared('A', 810)]);
    expect(s.accumulated).toBe(0);
  });

  it('a non-finite pointer ends the stay like a lost one', () => {
    const s = createDwellState();
    feed(s, span(0, 500, ON_A));
    expect(feed(s, [[510, { x: NaN, y: 0 }]])).toEqual([cleared('A', 510)]);
  });

  it('a stay that selected is cleared too', () => {
    const s = createDwellState();
    feed(s, span(0, 1000, ON_A));
    expect(feed(s, [[1010, null]])).toEqual([cleared('A', 1010)]);
  });

  it('emits no clearing event when there is no stay', () => {
    const s = createDwellState();
    expect(feed(s, [[0, null], [10, OFF], [20, null]])).toEqual([]);
  });
});

describe('moving targets (updateTarget keeps progress)', () => {
  it('a new rectangle that still contains the pointer keeps the dwell progress', () => {
    const s = createDwellState();
    const before = feed(s, span(0, 500, ON_A));
    const moved: DwellTarget = { ...A, rect: { x: 30, y: 30, width: 200, height: 200 } };
    const after = feed(s, span(510, 1000, ON_A), [moved]);
    const prog = progressOf([...before, ...after].filter((e) => e.at < 1000));
    for (let i = 1; i < prog.length; i++) expect(prog[i]).toBeGreaterThanOrEqual(prog[i - 1]);
    expect(selects(after).map((e) => e.at)).toEqual([1000]);
  });

  it('a new rectangle that no longer contains the pointer counts as leaving the target', () => {
    const s = createDwellState();
    feed(s, span(0, 500, ON_A));
    const moved: DwellTarget = { ...A, rect: { x: 400, y: 400, width: 50, height: 50 } };
    const ev = feed(s, span(510, 1200, ON_A), [moved]);
    expect(ev).toEqual([{ type: 'dwell-progress', targetId: 'A', progress: 0, at: 660 }]);
  });
});

describe('switching targets', () => {
  it('moving straight from one target to another starts a fresh stay', () => {
    const s = createDwellState();
    const ev = feed(s, [...span(0, 800, ON_A), ...span(810, 1700, ON_B)], [A, B]);
    expect(selects(ev)).toHaveLength(0);
  });

  it('returning to the first target within grace starts a fresh stay, since another target was entered', () => {
    const s = createDwellState();
    const ev = feed(s, [...span(0, 600, ON_A), [610, ON_B], ...span(620, 1500, ON_A)], [A, B]);
    expect(selects(ev)).toHaveLength(0);
  });
});

describe('input timeout and timestamps', () => {
  it('silence for the input timeout starts a fresh stay: progress 0, no select', () => {
    const s = createDwellState();
    feed(s, span(0, 900, ON_A));
    const ev = feed(s, [[2900, ON_A]]);
    expect(selects(ev)).toHaveLength(0);
    expect(progressOf(ev)).toEqual([0, 0]);
    expect(s.accumulated).toBe(0);
  });

  it('ignores duplicate, backwards and non-finite timestamps', () => {
    const s = createDwellState();
    feed(s, span(0, 500, ON_A));
    const snapshot = cloneDwellState(s);
    expect(feed(s, [[500, ON_A], [100, ON_A], [NaN, ON_A], [Infinity, ON_A]])).toEqual([]);
    expect(s).toEqual(snapshot);
  });
});

describe('cloneDwellState', () => {
  it('branches evolve identically and independently', () => {
    const s = createDwellState();
    feed(s, span(0, 500, ON_A));
    const c = cloneDwellState(s);
    const a = feed(s, span(510, 1200, ON_A));
    const b = feed(c, span(510, 1200, ON_A));
    expect(a).toEqual(b);
    expect(selects(a)).toHaveLength(1);
    const d = cloneDwellState(c);
    feed(c, span(1210, 1300, null));
    expect(d.targetId).toBe('A');
    expect(c.targetId).toBeNull();
  });
});
