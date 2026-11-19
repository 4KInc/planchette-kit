import { describe, it, expect } from 'vitest';
import {
  PressState,
  createPressMachineState,
  clonePressMachineState,
  stepPress,
  type PressEvent,
  type PressMachineState,
} from '../src/engine/press-machine';
import { defaultProfile, type Profile } from '../src/engine/profile';

const holdOn: Profile = { ...defaultProfile, cancelByHold: true };
const holdOff: Profile = { ...defaultProfile, cancelByHold: false };

/** Step through [now, signal] pairs and return all events in order. */
function run(
  s: PressMachineState,
  steps: Array<[number, boolean]>,
  p: Profile,
  acceptance?: number,
): PressEvent[] {
  const out: PressEvent[] = [];
  for (const [now, signal] of steps) {
    out.push(...stepPress(s, signal, now, p, acceptance));
  }
  return out;
}

/** Dense samples every `dt` ms from t0 to t1 inclusive, all with `signal`. */
function dense(t0: number, t1: number, signal: boolean, dt = 16): Array<[number, boolean]> {
  const out: Array<[number, boolean]> = [];
  for (let t = t0; t <= t1; t += dt) out.push([t, signal]);
  return out;
}

describe('transition table', () => {
  it('IDLE, signal inactive: stays IDLE', () => {
    const s = createPressMachineState();
    expect(stepPress(s, false, 0, holdOn)).toEqual([]);
    expect(s.state).toBe(PressState.IDLE);
  });

  it('IDLE, signal active, acceptance > 0: goes to PENDING_ACCEPT and records t_down', () => {
    const s = createPressMachineState();
    stepPress(s, true, 100, holdOn, 300);
    expect(s.state).toBe(PressState.PENDING_ACCEPT);
    expect(s.t_down).toBe(100);
  });

  it('PENDING_ACCEPT, active before acceptance time: stays pending', () => {
    const s = createPressMachineState();
    run(s, [[0, true], [100, true], [299, true]], holdOn, 300);
    expect(s.state).toBe(PressState.PENDING_ACCEPT);
  });

  it('PENDING_ACCEPT, released before acceptance time: IDLE, no event', () => {
    const s = createPressMachineState();
    const ev = run(s, [[0, true], [100, true], [200, false]], holdOn, 300);
    expect(ev).toEqual([]);
    expect(s.state).toBe(PressState.IDLE);
  });

  it('acceptance reached, cancel-by-hold OFF: press at the acceptance time, then ARMED', () => {
    const s = createPressMachineState();
    expect(run(s, [[0, true], [299, true]], holdOff, 300)).toEqual([]);
    expect(stepPress(s, true, 300, holdOff, 300)).toEqual([{ type: 'press' }]);
    expect(s.state).toBe(PressState.ARMED);
  });

  it('ARMED: more active samples give no second press; release goes to IDLE', () => {
    const s = createPressMachineState();
    const ev = run(s, dense(0, 3000, true), holdOff, 0);
    expect(ev).toEqual([{ type: 'press' }]);
    expect(s.state).toBe(PressState.ARMED);
    expect(stepPress(s, false, 3016, holdOff, 0)).toEqual([]);
    expect(s.state).toBe(PressState.IDLE);
  });

  it('acceptance reached, cancel-by-hold ON: no event yet, ARMED_HOLD_WAIT', () => {
    const s = createPressMachineState();
    const ev = run(s, [[0, true], [300, true]], holdOn, 300);
    expect(ev).toEqual([]);
    expect(s.state).toBe(PressState.ARMED_HOLD_WAIT);
  });

  it('ARMED_HOLD_WAIT, released before cancel hold time: one press on release', () => {
    const s = createPressMachineState();
    const ev = run(s, [...dense(0, 1000, true), [1016, false]], holdOn, 300);
    expect(ev).toEqual([{ type: 'press' }]);
    expect(s.state).toBe(PressState.IDLE);
  });

  it('ARMED_HOLD_WAIT, held to the cancel hold time: cancel, no press, COOLDOWN', () => {
    const s = createPressMachineState();
    const ev = run(s, dense(0, 2000, true), holdOn, 300);
    expect(ev).toEqual([{ type: 'cancel' }]);
    expect(s.state).toBe(PressState.COOLDOWN);
  });

  it('COOLDOWN: still held gives nothing; release goes to IDLE with no press', () => {
    const s = createPressMachineState();
    const ev = run(s, [...dense(0, 4000, true), [4016, false]], holdOn, 300);
    expect(ev).toEqual([{ type: 'cancel' }]);
    expect(s.state).toBe(PressState.IDLE);
  });

  it('a release in the same sample that reaches the cancel hold time cancels, not presses', () => {
    const s = createPressMachineState();
    const ev = run(s, [...dense(0, 1984, true), [2000, false]], holdOn, 300);
    expect(ev).toEqual([{ type: 'cancel' }]);
    expect(s.state).toBe(PressState.IDLE);
  });

  it('a new press works after COOLDOWN returns to IDLE', () => {
    const s = createPressMachineState();
    const ev = run(
      s,
      [...dense(0, 2000, true), [2016, false], [2032, true], [2400, true], [2416, false]],
      holdOn,
      300,
    );
    expect(ev).toEqual([{ type: 'cancel' }, { type: 'press' }]);
  });
});

describe('acceptance time', () => {
  it('acceptance 0 with cancel-by-hold OFF presses on the same step as the activation', () => {
    const s = createPressMachineState();
    expect(stepPress(s, true, 0, holdOff, 0)).toEqual([{ type: 'press' }]);
    expect(s.state).toBe(PressState.ARMED);
  });

  it('acceptance 0 with cancel-by-hold ON goes straight to ARMED_HOLD_WAIT', () => {
    const s = createPressMachineState();
    expect(stepPress(s, true, 0, holdOn, 0)).toEqual([]);
    expect(s.state).toBe(PressState.ARMED_HOLD_WAIT);
  });

  it('defaults to profile.switchAcceptanceTime when no acceptance time is passed', () => {
    const p: Profile = { ...holdOff, switchAcceptanceTime: 200 };
    const s = createPressMachineState();
    expect(run(s, [[0, true], [199, true]], p)).toEqual([]);
    expect(stepPress(s, true, 200, p)).toEqual([{ type: 'press' }]);
  });
});

describe('input timeout', () => {
  it('silence for inputTimeout resets mid-press silently, with no cancel or press', () => {
    const s = createPressMachineState();
    run(s, [[0, true], [300, true]], holdOn, 300);
    expect(s.state).toBe(PressState.ARMED_HOLD_WAIT);
    const ev = stepPress(s, false, 300 + holdOn.inputTimeout, holdOn, 300);
    expect(ev).toEqual([]);
    expect(s.state).toBe(PressState.IDLE);
  });

  it('a gap just under inputTimeout does not reset', () => {
    // cancel hold (5000) is far away, so only the input timeout (1500) matters
    const p: Profile = { ...holdOn, cancelHoldTime: 5000, inputTimeout: 1500 };
    const s = createPressMachineState();
    run(s, [[0, true], [300, true]], p, 300);
    stepPress(s, true, 300 + p.inputTimeout - 1, p, 300);
    expect(s.state).toBe(PressState.ARMED_HOLD_WAIT);
  });

  it('a sample after the timeout with signal active starts a fresh activation', () => {
    const s = createPressMachineState();
    run(s, [[0, true], [300, true]], holdOn, 300);
    const t = 300 + holdOn.inputTimeout;
    stepPress(s, true, t, holdOn, 300);
    expect(s.state).toBe(PressState.PENDING_ACCEPT);
    expect(s.t_down).toBe(t);
  });

  it('timeout from COOLDOWN returns to IDLE without events', () => {
    const s = createPressMachineState();
    run(s, dense(0, 2000, true), holdOn, 300);
    expect(s.state).toBe(PressState.COOLDOWN);
    expect(stepPress(s, false, 2000 + holdOn.inputTimeout, holdOn, 300)).toEqual([]);
    expect(s.state).toBe(PressState.IDLE);
  });
});

describe('design example: 2000 ms hold, 2000 ms input timeout', () => {
  const p: Profile = { ...defaultProfile, cancelByHold: true, cancelHoldTime: 2000, inputTimeout: 2000 };

  it('held with a sample every frame: exactly one cancel, no press, no timeout reset', () => {
    const s = createPressMachineState();
    const ev: PressEvent[] = [];
    for (let t = 0; t <= 2000; t += 16) ev.push(...stepPress(s, true, t, p, 0));
    // the last 16 ms step lands on 1984 + 16 = 2000
    expect(ev).toEqual([{ type: 'cancel' }]);
    expect(s.state).toBe(PressState.COOLDOWN);
  });

  it('released at 1500 ms: one press, no cancel', () => {
    const s = createPressMachineState();
    const ev: PressEvent[] = [];
    for (let t = 0; t < 1500; t += 16) ev.push(...stepPress(s, true, t, p, 0));
    ev.push(...stepPress(s, false, 1500, p, 0));
    expect(ev).toEqual([{ type: 'press' }]);
    expect(s.state).toBe(PressState.IDLE);
  });

  it('adapter stops after one active sample: resets silently at the timeout', () => {
    const s = createPressMachineState();
    stepPress(s, true, 0, p, 0);
    expect(s.state).toBe(PressState.ARMED_HOLD_WAIT);
    expect(stepPress(s, false, 2000, p, 0)).toEqual([]);
    expect(s.state).toBe(PressState.IDLE);
  });
});

describe('timestamps (Req 9 AC 4)', () => {
  it('duplicate and backwards timestamps change nothing', () => {
    const s = createPressMachineState();
    stepPress(s, true, 100, holdOn, 300);
    const before = clonePressMachineState(s);
    expect(stepPress(s, false, 100, holdOn, 300)).toEqual([]);
    expect(stepPress(s, false, 50, holdOn, 300)).toEqual([]);
    expect(stepPress(s, true, NaN, holdOn, 300)).toEqual([]);
    expect(stepPress(s, true, Infinity, holdOn, 300)).toEqual([]);
    expect(s).toEqual(before);
  });
});

describe('clonePressMachineState', () => {
  it('copies the state so the branches evolve independently and identically', () => {
    const s = createPressMachineState();
    run(s, [[0, true], [300, true]], holdOn, 300);
    const c = clonePressMachineState(s);
    expect(c).toEqual(s);
    expect(c).not.toBe(s);
    const evA = stepPress(s, false, 400, holdOn, 300);
    const evB = stepPress(c, false, 400, holdOn, 300);
    expect(evA).toEqual(evB);
    expect(evA).toEqual([{ type: 'press' }]);
    // mutate one branch; the other is unaffected
    stepPress(s, true, 500, holdOn, 300);
    expect(c.state).toBe(PressState.IDLE);
    expect(s.state).not.toBe(PressState.IDLE);
  });
});
