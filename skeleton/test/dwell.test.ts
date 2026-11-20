import { describe, it, expect } from 'vitest';
import {
  createDwellState,
  cloneDwellState,
  stepDwell,
  type DwellEvent,
  type DwellState,
  type DwellTarget,
} from '../src/engine/dwell';
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

type Timed = DwellEvent & { at: number };
type TimedSelect = Extract<DwellEvent, { type: 'select' }> & { at: number };
const selects = (ev: Timed[]): TimedSelect[] =>
  ev.filter((e): e is TimedSelect => e.type === 'select');

describe('basic dwell', () => {
  it('selects once, at the dwell time', () => {
    const s = createDwellState();
    const ev = feed(s, span(0, 1500, ON_A));
    const sel = selects(ev);
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
    const ev = feed(s, span(0, 1000, ON_A, 250));
    const prog = ev.filter((e) => e.type === 'dwell-progress') as Array<{ progress: number }>;
    expect(prog.map((e) => e.progress)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('emits the progress event before the select event at the select sample', () => {
    const s = createDwellState();
    const ev = feed(s, span(0, 1000, ON_A, 500));
    expect(ev.slice(-2).map((e) => e.type)).toEqual(['dwell-progress', 'select']);
  });

  it('keeps progress at 1 for the rest of the stay without selecting again', () => {
    const s = createDwellState();
    const ev = feed(s, span(0, 3000, ON_A, 100));
    expect(selects(ev)).toHaveLength(1);
    const last = ev[ev.length - 1] as { type: string; progress: number };
    expect(last).toMatchObject({ type: 'dwell-progress', progress: 1 });
  });

  it('carries the target role in the select event', () => {
    const cancel: DwellTarget = { ...A, role: 'cancel' };
    const s = createDwellState();
    const sel = selects(feed(s, span(0, 1000, ON_A, 500), [cancel]));
    expect(sel[0].role).toBe('cancel');
  });
});

describe('grace time', () => {
  it('a gap within the grace time pauses the timer without resetting it', () => {
    const s = createDwellState();
    // 500 ms on, 100 ms gap (<= grace 150), then back on
    const ev = feed(s, [...span(0, 500, ON_A), [510, OFF], [550, OFF], [600, OFF], ...span(600 + 10, 2000, ON_A)]);
    // last on-sample before the gap was 500, first after is 610: gap 110 ms.
    // Time on target: 500 before + (2000 - 610) after. Gap adds nothing.
    const sel = selects(ev);
    expect(sel).toHaveLength(1);
    // 500 accumulated; need 500 more after resuming at 610 (resume adds nothing): select at 1110
    expect(sel[0].at).toBe(1110);
  });

  it('a gap of exactly the grace time still resumes', () => {
    const s = createDwellState();
    const ev = feed(s, [...span(0, 500, ON_A), [575, OFF], ...span(650, 1500, ON_A)]);
    // gap 500 -> 650 = 150 ms = grace: resumes; 500 accumulated, 500 more needed after 650
    expect(selects(ev)[0].at).toBe(1150);
  });

  it('a gap longer than the grace time resets the timer to zero', () => {
    const s = createDwellState();
    const ev = feed(s, [...span(0, 900, ON_A), [910, OFF], [1000, OFF], ...span(1100, 2000, ON_A)]);
    // gap 900 -> 1100 = 200 ms > grace: new stay from 1100, select needs until 2100
    expect(selects(ev)).toHaveLength(0);
    const ev2 = feed(s, span(2010, 2100, ON_A));
    expect(selects(ev2)).toHaveLength(1);
  });

  it('time off the target is never counted toward the dwell time', () => {
    const s = createDwellState();
    // On for 900 ms total (450 + 450) with a 100 ms gap: must not select until 1000 ms on-target
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
    expect(selects(ev).map((e) => e.at)).toEqual([1000, 2410]);
  });
});

describe('post-selection pause', () => {
  it('suppresses a select on another target until the pause ends', () => {
    const s = createDwellState();
    // select A at 1000; pause until 1500. Move to B at 1010 and stay: B accumulated 1000 at 2010.
    const ev = feed(s, [...span(0, 1000, ON_A), ...span(1010, 3000, ON_B)], [A, B]);
    const sel = selects(ev);
    expect(sel.map((e) => e.at)).toEqual([1000, 2010]);
  });

  it('holds a ready select until the pause ends, when dwell was reached during the pause', () => {
    const p: Profile = { ...P, dwellTime: 400, postSelectionPause: 3000 };
    const s = createDwellState();
    const ev = feed(s, [...span(0, 400, ON_A), ...span(410, 4000, ON_B)], [A, B], p);
    // A selected at 400, pause until 3400. B is ready from 810 but waits.
    expect(selects(ev).map((e) => e.at)).toEqual([400, 3400]);
  });

  it('drops the pending select if the pointer leaves for longer than grace during the pause', () => {
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
    const ev = feed(s, [...span(0, 1000, ON_A), ...span(1010, 1500, ON_B), ...span(1510, 4000, ON_B)], [A, B]);
    const times = selects(ev).map((e) => e.at);
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

  it('uses the larger of the repeat interval and the post-selection pause', () => {
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

  it('progress runs 0 to 1 across each repeat interval', () => {
    const s2 = createDwellState();
    const out = feed(s2, span(0, 1500, ON_A, 250), [R]);
    const prog = out.filter((e) => e.type === 'dwell-progress') as Array<{ progress: number }>;
    // dwell phase 0..1 at t=1000, then repeat phase: t=1250 -> 0.25, t=1500 -> 0.5
    expect(prog.map((e) => e.progress)).toEqual([0, 0.25, 0.5, 0.75, 1, 0.25, 0.5]);
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
    const rest: DwellTarget = { id: 'rest', rect: { x: 0, y: 0, width: 1000, height: 1000 }, autoRepeat: false, role: 'rest-area' };
    const s = createDwellState();
    const sel = selects(feed(s, span(0, 1200, ON_A), [rest, A]));
    expect(sel).toHaveLength(1);
  });

  it('ignores a non-finite pointer', () => {
    const s = createDwellState();
    expect(feed(s, span(0, 2000, { x: NaN, y: 50 }))).toEqual([]);
    expect(feed(s, span(2010, 4000, { x: Infinity, y: 50 }))).toEqual([]);
  });
});

describe('moving targets (updateTarget keeps progress)', () => {
  it('a new rectangle that still contains the pointer keeps the dwell progress', () => {
    const s = createDwellState();
    const before = feed(s, span(0, 500, ON_A));
    const moved: DwellTarget = { ...A, rect: { x: 30, y: 30, width: 200, height: 200 } };
    const after = feed(s, span(510, 1000, ON_A), [moved]);
    const prog = [...before, ...after]
      .filter((e) => e.type === 'dwell-progress')
      .map((e) => (e as { progress: number }).progress);
    for (let i = 1; i < prog.length; i++) expect(prog[i]).toBeGreaterThanOrEqual(prog[i - 1]);
    expect(selects(after).map((e) => e.at)).toEqual([1000]);
  });

  it('a new rectangle that no longer contains the pointer counts as leaving the target', () => {
    const s = createDwellState();
    feed(s, span(0, 500, ON_A));
    const moved: DwellTarget = { ...A, rect: { x: 400, y: 400, width: 50, height: 50 } };
    const ev = feed(s, span(510, 1200, ON_A), [moved]);
    expect(ev).toEqual([]);
  });
});

describe('switching targets', () => {
  it('moving straight from one target to another starts a fresh stay', () => {
    const s = createDwellState();
    const ev = feed(s, [...span(0, 800, ON_A), ...span(810, 1700, ON_B)], [A, B]);
    // B has only 890 ms by 1700, A had 800: nothing selected
    expect(selects(ev)).toHaveLength(0);
  });

  it('returning to the first target within grace starts a fresh stay, since another target was entered', () => {
    const s = createDwellState();
    const ev = feed(s, [...span(0, 600, ON_A), [610, ON_B], ...span(620, 1500, ON_A)], [A, B]);
    expect(selects(ev)).toHaveLength(0);
  });
});

describe('input timeout and timestamps', () => {
  it('silence for the input timeout ends the stay without events', () => {
    const s = createDwellState();
    feed(s, span(0, 900, ON_A));
    // next sample 2000 ms later, on target: a fresh stay, so progress 0 and no select
    const ev = feed(s, [[2900, ON_A]]);
    expect(ev).toEqual([{ type: 'dwell-progress', targetId: 'A', progress: 0, at: 2900 }]);
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
    // the clone did not see the original's later changes
    const d = cloneDwellState(c);
    feed(c, span(1210, 1300, OFF));
    expect(d.targetId).toBe('A');
  });
});
