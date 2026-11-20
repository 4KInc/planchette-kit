import { describe, it, expect } from 'vitest';
import {
  SCAN_BACK_ID,
  SCAN_CANCEL_ID,
  createScanState,
  cloneScanState,
  stepScan,
  type ScanEvent,
  type ScanState,
} from '../src/engine/scan';
import type { DwellTarget } from '../src/engine/targets';
import { defaultProfile, type Profile } from '../src/engine/profile';

// interval 1000, 2 loops before pause, post-selection pause 500, input timeout 2000
const P: Profile = { ...defaultProfile, scanInterval: 1000, scanLoopsBeforePause: 2, postSelectionPause: 500 };

function target(id: string, x: number, y: number, role: DwellTarget['role'] = 'default'): DwellTarget {
  return { id, rect: { x, y, width: 100, height: 100 }, autoRepeat: false, role };
}

/** A vertical list: one item per row, so linear scanning. */
const COLUMN = [target('a', 0, 0), target('b', 0, 120), target('c', 0, 240)];
/** A 2 x 3 grid: row-then-item scanning. */
const GRID = [
  target('r0c0', 0, 0), target('r0c1', 120, 0), target('r0c2', 240, 0),
  target('r1c0', 0, 120), target('r1c1', 120, 120), target('r1c2', 240, 120),
];

type Timed = ScanEvent & { at: number };

interface Opts {
  targets?: DwellTarget[];
  order?: string[];
  profile?: Profile;
  presses?: number[]; // times at which a counted press arrives
  dt?: number;
}

/** Step from `from` to `to` inclusive every dt ms. Presses arrive on the step at their time. */
function run(s: ScanState, from: number, to: number, o: Opts = {}): Timed[] {
  const out: Timed[] = [];
  const dt = o.dt ?? 100;
  const presses = new Set(o.presses ?? []);
  for (let t = from; t <= to; t += dt) {
    const ev = stepScan(
      s,
      { press: presses.has(t), targets: o.targets ?? COLUMN, order: o.order },
      t,
      o.profile ?? P,
    );
    for (const e of ev) out.push({ ...e, at: t });
  }
  return out;
}

const highlights = (ev: Timed[]) =>
  ev.filter((e): e is Timed & { type: 'highlight' } => e.type === 'highlight');
const labels = (ev: Timed[]) => highlights(ev).map((e) => (e.kind === 'item' ? e.targetId : e.kind === 'row' ? `row:${e.targetIds.join('+')}` : e.kind));
const types = (ev: Timed[]) => ev.map((e) => e.type);

describe('advance order', () => {
  it('highlights items in reading order, one per scan interval, then the cancel item', () => {
    const s = createScanState();
    const ev = highlights(run(s, 0, 3500));
    expect(ev.map((e) => [e.at, e.kind === 'cancel' ? 'cancel' : e.targetId])).toEqual([
      [0, 'a'],
      [1000, 'b'],
      [2000, 'c'],
      [3000, 'cancel'],
    ]);
  });

  it('every cycle includes the cancel item, last', () => {
    const s = createScanState();
    const l = labels(run(s, 0, 7500));
    expect(l).toEqual(['a', 'b', 'c', 'cancel', 'a', 'b', 'c', 'cancel']);
  });

  it('uses reading order whatever the registration order', () => {
    const shuffled = [target('c', 0, 240), target('a', 0, 0), target('b', 0, 120)];
    const s = createScanState();
    expect(labels(run(s, 0, 2500, { targets: shuffled }))).toEqual(['a', 'b', 'c']);
  });

  it('puts items on the same visual row left to right, then the next row', () => {
    const shuffled = [target('d', 120, 120), target('b', 120, 0), target('c', 0, 120), target('a', 0, 0)];
    // two rows of two: row mode, so rows are highlighted. Check the row contents and order.
    const s = createScanState();
    const l = labels(run(s, 0, 1500, { targets: shuffled }));
    expect(l).toEqual(['row:a+b', 'row:c+d']);
  });

  it('follows a custom order, then the unlisted targets in reading order', () => {
    const s = createScanState();
    const l = labels(run(s, 0, 3500, { order: ['c', 'zzz', 'a'] }));
    expect(l).toEqual(['c', 'a', 'b', 'cancel']);
  });

  it('skips rest-area targets', () => {
    const withRest = [target('rest', 0, 360, 'rest-area'), ...COLUMN];
    const s = createScanState();
    expect(labels(run(s, 0, 3500, { targets: withRest }))).toEqual(['a', 'b', 'c', 'cancel']);
  });

  it('with no targets only the cancel item is highlighted', () => {
    const s = createScanState();
    const ev = run(s, 0, 100, { targets: [] });
    expect(labels(ev)).toEqual(['cancel']);
    const ev2 = run(s, 200, 300, { targets: [], presses: [200] });
    expect(types(ev2)).toEqual(['cancel', 'highlight']);
  });

  it('advances at the same times whatever the frame rate, without drift', () => {
    for (const dt of [16, 33, 100]) {
      const s = createScanState();
      const hs = highlights(run(s, 0, 7000, { dt }));
      hs.forEach((e, i) => {
        expect(e.at).toBeGreaterThanOrEqual(i * 1000);
        expect(e.at).toBeLessThan(i * 1000 + dt);
      });
    }
  });
});

describe('press selects the highlighted item', () => {
  it('selects the item highlighted at the time of the press, then restarts at the top', () => {
    const s = createScanState();
    const ev = run(s, 0, 1500, { presses: [1500] });
    const last = ev.slice(-2);
    expect(last.map((e) => e.type)).toEqual(['select', 'highlight']);
    expect(last[0]).toMatchObject({ type: 'select', targetId: 'b', source: 'scan', role: 'default', now: 1500 });
    expect(last[1]).toMatchObject({ type: 'highlight', kind: 'item', targetId: 'a' });
  });

  it('carries the role of the selected target', () => {
    const t = [target('u', 0, 0, 'undo')];
    const s = createScanState();
    const ev = run(s, 0, 500, { targets: t, presses: [500] });
    expect(ev.find((e) => e.type === 'select')).toMatchObject({ targetId: 'u', role: 'undo' });
  });

  it('the cancel item emits cancel and returns to the top of the cycle', () => {
    const s = createScanState();
    // the cancel item is highlighted from 3000; a press at 3100 acts on it
    const ev = run(s, 0, 3100, { presses: [3100] });
    const last = ev.slice(-2);
    expect(last.map((e) => e.type)).toEqual(['cancel', 'highlight']);
    expect(last[1]).toMatchObject({ kind: 'item', targetId: 'a' });
    expect(types(ev)).not.toContain('select');
  });

  it('ignores a press on the very first sample, when nothing was highlighted yet', () => {
    const s = createScanState();
    const ev = run(s, 0, 0, { presses: [0] });
    expect(types(ev)).toEqual(['highlight']);
  });
});

describe('post-selection pause', () => {
  it('ignores presses during the pause and acts again after it', () => {
    const s = createScanState();
    // select at 1500 (item b); pause ends at 2000
    const ev = run(s, 0, 4000, { presses: [1500, 1600, 1900, 2000] });
    const sel = ev.filter((e) => e.type === 'select');
    // 1600 and 1900 are ignored; the press at 2000 acts on the restarted cycle (a)
    expect(sel.map((e) => [e.at, (e as { targetId: string }).targetId])).toEqual([
      [1500, 'b'],
      [2000, 'a'],
    ]);
  });

  it('the first highlight after a select lasts a full interval after the pause ends', () => {
    const s = createScanState();
    const ev = highlights(run(s, 0, 3500, { presses: [1500] }));
    // restart highlight at 1500; pause ends 2000; next advance at 3000
    expect(ev.map((e) => [e.at, e.kind === 'cancel' ? 'cancel' : e.targetId])).toEqual([
      [0, 'a'],
      [1000, 'b'],
      [1500, 'a'],
      [3000, 'b'],
    ]);
  });
});

describe('loops without a press', () => {
  it('pauses after the profile number of loops and then highlights nothing', () => {
    const s = createScanState();
    const ev = run(s, 0, 12000);
    // 2 loops of 4 slots = 8 highlights (0..7000), then none at 8000
    expect(labels(ev)).toEqual(['a', 'b', 'c', 'cancel', 'a', 'b', 'c', 'cancel', 'none']);
    expect(ev.at(-1)).toMatchObject({ kind: 'none', at: 8000, targetIds: [] });
    expect(s.paused).toBe(true);
  });

  it('one loop when the profile says 1', () => {
    const p: Profile = { ...P, scanLoopsBeforePause: 1 };
    const s = createScanState();
    expect(labels(run(s, 0, 6000, { profile: p }))).toEqual(['a', 'b', 'c', 'cancel', 'none']);
  });

  it('the press that ends a pause highlights the first item and selects nothing', () => {
    const s = createScanState();
    run(s, 0, 9000);
    expect(s.paused).toBe(true);
    const ev = run(s, 9100, 9100, { presses: [9100] });
    expect(ev).toEqual([
      { type: 'highlight', kind: 'item', targetId: 'a', targetIds: ['a'], at: 9100 },
    ]);
    expect(s.paused).toBe(false);
  });

  it('after resuming, the next press selects and a new run of loops starts', () => {
    const s = createScanState();
    run(s, 0, 9000);
    run(s, 9100, 9100, { presses: [9100] });
    const ev = run(s, 9200, 9400, { presses: [9300] });
    expect(ev.find((e) => e.type === 'select')).toMatchObject({ targetId: 'a', at: 9300 });
    expect(s.paused).toBe(false);
  });

  it('a press resets the loop count', () => {
    const s = createScanState();
    // one full loop (0..3000), cancel press at 3000 resets loops; two more loops are needed
    const ev = run(s, 0, 14000, { presses: [3000] });
    const none = ev.filter((e) => e.type === 'highlight' && e.kind === 'none');
    expect(none).toHaveLength(1);
    // restart at 3000, pause ends 3500, first advance at 4500; 8 highlights, then none
    expect(none[0].at).toBeGreaterThan(11000);
  });

  it('a paused scan stays paused through silence', () => {
    const s = createScanState();
    run(s, 0, 9000);
    const ev = run(s, 20000, 20000);
    expect(ev).toEqual([]);
    expect(s.paused).toBe(true);
  });
});

describe('row-then-item scanning', () => {
  it('scans rows first, then the cancel item', () => {
    const s = createScanState();
    const l = labels(run(s, 0, 2500, { targets: GRID }));
    expect(l).toEqual(['row:r0c0+r0c1+r0c2', 'row:r1c0+r1c1+r1c2', 'cancel']);
  });

  it('the first press picks the row, the second picks an item in it', () => {
    const s = createScanState();
    // press at 1100 while row 1 is highlighted (1000..): enter row 1; pause ends 1600;
    // first item highlighted at 1100, next at 2600, then 3600
    const ev = run(s, 0, 3700, { targets: GRID, presses: [1100, 3100] });
    expect(types(ev.filter((e) => e.at === 1100))).toEqual(['highlight']);
    expect(ev.find((e) => e.at === 1100)).toMatchObject({ kind: 'item', targetId: 'r1c0' });
    const sel = ev.find((e) => e.type === 'select');
    expect(sel).toMatchObject({ targetId: 'r1c1', at: 3100 });
  });

  it('includes a back item and the cancel item while scanning inside a row', () => {
    const s = createScanState();
    const ev = run(s, 0, 9000, { targets: GRID, presses: [100], profile: { ...P, scanLoopsBeforePause: 5 } });
    // enter row 0 at 100; items r0c0 (100), r0c1 (2100), r0c2 (3100), back (4100), cancel (5100)
    const inRow = labels(ev.filter((e) => e.at >= 100)).slice(0, 5);
    expect(inRow).toEqual(['r0c0', 'r0c1', 'r0c2', 'back', 'cancel']);
  });

  it('the back item returns to row scanning on the row just left', () => {
    const s = createScanState();
    const p: Profile = { ...P, scanLoopsBeforePause: 5 };
    // enter row 1 at 1100; items at 1100, 2600, 3600; back at 4600
    const ev = run(s, 0, 4700, { targets: GRID, profile: p, presses: [1100, 4700] });
    const last = ev.slice(-1)[0];
    expect(last).toMatchObject({ type: 'highlight', kind: 'row', targetIds: ['r1c0', 'r1c1', 'r1c2'] });
    expect(types(ev)).not.toContain('select');
    expect(types(ev)).not.toContain('cancel');
    expect(s.level).toBe('top');
  });

  it('the cancel item inside a row emits cancel and returns to the top of the cycle', () => {
    const s = createScanState();
    const p: Profile = { ...P, scanLoopsBeforePause: 5 };
    // row 0 entered at 100; items 100, 2100, 3100; back 4100; cancel 5100
    const ev = run(s, 0, 5300, { targets: GRID, profile: p, presses: [100, 5200] });
    const tail = ev.slice(-2);
    expect(tail.map((e) => e.type)).toEqual(['cancel', 'highlight']);
    expect(tail[1]).toMatchObject({ kind: 'row', targetId: 'r0c0' });
  });

  it('returns to row scanning on its own after the profile number of loops, without pausing', () => {
    const s = createScanState();
    // enter row 0 at 100. Row cycle: 3 items + back + cancel = 5 slots; 2 loops = 10 highlights.
    const ev = run(s, 0, 12000, { targets: GRID, presses: [100] });
    const afterEnter = highlights(ev).filter((e) => e.at > 100);
    const firstRow = afterEnter.find((e) => e.kind === 'row');
    expect(firstRow).toBeDefined();
    // 10 slots after the entry highlight: entry at 100, advances at 2100.. -> 9 more in the row, then back to rows
    const rowHighlightsBefore = afterEnter.filter((e) => e.at < (firstRow as { at: number }).at);
    expect(rowHighlightsBefore).toHaveLength(9);
    expect((firstRow as { at: number }).at).toBe(10600);
    expect(s.paused).toBe(false);
  });

  it('a row with one item selects it directly', () => {
    const uneven = [target('a', 0, 0), target('b', 120, 0), target('c', 0, 120)];
    const s = createScanState();
    // rows: [a b], [c], cancel. At 1000 the single-item row is highlighted as an item.
    const ev = run(s, 0, 1100, { targets: uneven, presses: [1100] });
    const hs = labels(ev);
    expect(hs.slice(0, 2)).toEqual(['row:a+b', 'c']);
    expect(ev.find((e) => e.type === 'select')).toMatchObject({ targetId: 'c' });
  });

  it('a list with one item per row is scanned item by item', () => {
    const s = createScanState();
    const ev = highlights(run(s, 0, 100));
    expect(ev[0].kind).toBe('item');
  });

  it('a single row of several items is scanned item by item', () => {
    const strip = [target('a', 0, 0), target('b', 120, 0), target('c', 240, 0)];
    const s = createScanState();
    expect(labels(run(s, 0, 3500, { targets: strip }))).toEqual(['a', 'b', 'c', 'cancel']);
  });
});

describe('targets that change', () => {
  it('survives targets disappearing while one is highlighted', () => {
    const s = createScanState();
    run(s, 0, 2000); // highlight is on c (index 2)
    const ev = run(s, 2100, 3100, { targets: [target('a', 0, 0)] });
    // the stale slot index wraps to the first slot, so the next advance is the cancel item
    expect(labels(ev)).toEqual(['cancel']);
  });

  it('leaves a row if the layout is no longer a grid', () => {
    const s = createScanState();
    run(s, 0, 100, { targets: GRID, presses: [100] });
    expect(s.level).toBe('row');
    const ev = run(s, 200, 3100, { targets: COLUMN });
    expect(s.level).toBe('top');
    expect(types(ev)).not.toContain('select');
  });
});

describe('input timeout and timestamps', () => {
  it('silence for the input timeout restarts the cycle from the top', () => {
    const s = createScanState();
    run(s, 0, 1500); // highlight on b
    const ev = run(s, 4000, 4000);
    expect(labels(ev)).toEqual(['a']);
  });

  it('does not select on the step that follows a timeout, even with a press', () => {
    const s = createScanState();
    run(s, 0, 1500);
    const ev = run(s, 4000, 4000, { presses: [4000] });
    expect(types(ev)).toEqual(['highlight']);
  });

  it('ignores duplicate, backwards and non-finite timestamps', () => {
    const s = createScanState();
    run(s, 0, 500);
    const snapshot = cloneScanState(s);
    const input = { press: true, targets: COLUMN };
    expect(stepScan(s, input, 500, P)).toEqual([]);
    expect(stepScan(s, input, 100, P)).toEqual([]);
    expect(stepScan(s, input, NaN, P)).toEqual([]);
    expect(stepScan(s, input, Infinity, P)).toEqual([]);
    expect(s).toEqual(snapshot);
  });
});

describe('cloneScanState', () => {
  it('branches evolve identically and independently', () => {
    const s = createScanState();
    run(s, 0, 1500);
    const c = cloneScanState(s);
    const a = run(s, 1600, 4000, { presses: [2500] });
    const b = run(c, 1600, 4000, { presses: [2500] });
    expect(a).toEqual(b);
    const d = cloneScanState(c);
    run(c, 4100, 6000);
    expect(d.t_last).toBe(4000);
  });
});

describe('virtual item ids', () => {
  it('reports $back and $cancel as target ids', () => {
    expect(SCAN_BACK_ID).toBe('$back');
    expect(SCAN_CANCEL_ID).toBe('$cancel');
    const s = createScanState();
    const ev = highlights(run(s, 0, 3500));
    expect(ev.at(-1)).toMatchObject({ kind: 'cancel', targetId: '$cancel', targetIds: [] });
  });
});
