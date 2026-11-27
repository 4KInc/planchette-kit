import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BOARD_TARGET_IDS } from './board-target-ids';
import { cloneRound, createRound, stepRound, type RoundInput, type RoundState } from '../src/round';
import { WORDS, messageFor } from '../src/spirit-messages';
const TARGETS = [...BOARD_TARGET_IDS];
const messageArb = fc.constantFrom(...WORDS).map(messageFor);
/** An input; `hint` is the index into the Message's steps used to weight toward a correct select. */
const inputArb = (steps: readonly string[]): fc.Arbitrary<RoundInput> =>
  fc.oneof(
    { weight: 5, arbitrary: fc.constantFrom(...TARGETS).map((target): RoundInput => ({ type: 'select', target })) },
    { weight: 5, arbitrary: fc.constantFrom(...steps).map((target): RoundInput => ({ type: 'select', target })) },
    { weight: 1, arbitrary: fc.constant<RoundInput>({ type: 'undo' }) },
    { weight: 1, arbitrary: fc.constant<RoundInput>({ type: 'stop' }) },
  );
/** Timestamps: increasing in half the runs, arbitrary (repeats, going backwards) in the rest. */
const sequenceArb = fc.record({
  message: messageArb,
  start: fc.integer({ min: 0, max: 10_000 }),
  mono: fc.boolean(),
  len: fc.integer({ min: 0, max: 60 }),
}).chain(({ message, start, mono, len }) =>
  fc.record({
    message: fc.constant(message),
    start: fc.constant(start),
    items: fc.array(
      fc.record({ input: inputArb(message.steps), dt: mono ? fc.integer({ min: 1, max: 900 }) : fc.integer({ min: -300, max: 900 }) }),
      { minLength: len, maxLength: len },
    ),
  }),
);
function run(state: RoundState, items: ReadonlyArray<{ input: RoundInput; dt: number }>, start: number, each?: (s: RoundState) => void): void {
  let t = start;
  for (const { input, dt } of items) {
    t += dt;
    stepRound(state, input, t);
    each?.(state);
  }
}
describe('Feature: seance, Property 1: A Round always ends', () => {
  it('stop ends it from any state, and an ended Round is absorbing', () => {
    fc.assert(
      fc.property(sequenceArb, ({ message, start, items }) => {
        const r = createRound(message, start);
        run(r, items, start);
        const probe = cloneRound(r);
        stepRound(probe, { type: 'stop' }, 1e9);
        expect(probe.status === 'stopped' || probe.status === 'complete').toBe(true);
        const ended = cloneRound(probe);
        for (const input of [{ type: 'select', target: 'letter-a' }, { type: 'undo' }, { type: 'stop' }] as RoundInput[]) {
          expect(stepRound(probe, input, 2e9)).toEqual([]);
        }
        expect(probe).toEqual(ended);
      }),
      { numRuns: 200 },
    );
  });
  it('selecting each remaining Step in turn completes it', () => {
    fc.assert(
      fc.property(sequenceArb, ({ message, start, items }) => {
        const r = createRound(message, start);
        run(r, items.filter((i) => i.input.type !== 'stop'), start);
        if (r.status !== 'playing') return;
        let t = 1e6;
        for (let i = r.index; i < message.steps.length; i++) {
          t += 10;
          stepRound(r, { type: 'select', target: message.steps[i]! }, t);
        }
        expect(r.status).toBe('complete');
      }),
      { numRuns: 200 },
    );
  });
});
describe('Feature: seance, Property 2: No double counting', () => {
  it('hits + misses equals the accepted selects; control inputs change no count; a replay adds nothing', () => {
    fc.assert(
      fc.property(sequenceArb, ({ message, start, items }) => {
        const r = createRound(message, start);
        let accepted = 0;
        let t = start;
        for (const { input, dt } of items) {
          t += dt;
          const before = { hits: r.hits, misses: r.misses, takenBack: r.takenBack, status: r.status, lastAt: r.lastAt };
          const ev = stepRound(r, input, t);
          if (input.type === 'select') {
            const counted = ev.some((e) => e.type === 'hit' || e.type === 'miss');
            if (before.status === 'playing' && t > before.lastAt) {
              expect(counted).toBe(true);
              accepted++;
            } else expect(counted).toBe(false);
          } else {
            expect({ hits: r.hits, misses: r.misses }).toEqual({ hits: before.hits, misses: before.misses });
          }
        }
        expect(r.hits + r.misses).toBe(accepted);
        // Replaying the same sequence with the same timestamps adds nothing (they are all stale now).
        const snapshot = cloneRound(r);
        run(r, items, start);
        expect(r).toEqual(snapshot);
      }),
      { numRuns: 200 },
    );
  });
});
describe('Feature: seance, Property 3: Progress is a prefix', () => {
  it('0 <= index <= steps, index <= hits, and the standing steps are a prefix of the Message', () => {
    fc.assert(
      fc.property(sequenceArb, ({ message, start, items }) => {
        const r = createRound(message, start);
        const chosen: string[] = [];
        let t = start;
        for (const { input, dt } of items) {
          t += dt;
          const ev = stepRound(r, input, t);
          for (const e of ev) {
            if (e.type === 'hit') chosen.push(e.target);
            if (e.type === 'undone') chosen.pop();
          }
          expect(r.index).toBeGreaterThanOrEqual(0);
          expect(r.index).toBeLessThanOrEqual(message.steps.length);
          expect(r.index).toBeLessThanOrEqual(r.hits);
          expect(chosen).toEqual(message.steps.slice(0, r.index));
        }
      }),
      { numRuns: 200 },
    );
  });
});
describe('Feature: seance, Property 7: Undo', () => {
  it('a Hit then Undo restores the index, leaves misses alone and adds one to Taken back', () => {
    fc.assert(
      fc.property(messageArb, fc.integer({ min: 0, max: 5 }), (message, k) => {
        const r = createRound(message, 0);
        let t = 0;
        // Not the final Step: the last Hit completes the Round at once, and an ended Round ignores Undo.
        const upto = Math.min(k, message.steps.length - 2);
        for (let i = 0; i < upto; i++) stepRound(r, { type: 'select', target: message.steps[i]! }, (t += 10));
        const before = cloneRound(r);
        stepRound(r, { type: 'select', target: message.steps[r.index]! }, (t += 10));
        stepRound(r, { type: 'undo' }, (t += 10));
        expect(r.index).toBe(before.index);
        expect(r.misses).toBe(before.misses);
        expect(r.takenBack).toBe(before.takenBack + 1);
        expect(r.status).toBe('playing');
      }),
      { numRuns: 100 },
    );
  });
  it('Undo at index 0 is a no-op, and no sequence makes index negative or changes misses', () => {
    fc.assert(
      fc.property(messageArb, fc.array(fc.integer({ min: 1, max: 50 }), { maxLength: 20 }), (message, dts) => {
        const r = createRound(message, 0);
        let t = 0;
        for (const dt of dts) {
          const before = cloneRound(r);
          const ev = stepRound(r, { type: 'undo' }, (t += dt));
          expect(ev).toEqual([]);
          expect(r.takenBack).toBe(before.takenBack);
          expect(r.index).toBe(0);
        }
      }),
    );
    fc.assert(
      fc.property(sequenceArb, ({ message, start, items }) => {
        const r = createRound(message, start);
        let t = start;
        for (const { input, dt } of items) {
          const m = r.misses;
          t += dt;
          stepRound(r, input, t);
          expect(r.index).toBeGreaterThanOrEqual(0);
          if (input.type === 'undo') expect(r.misses).toBe(m);
        }
      }),
      { numRuns: 200 },
    );
  });
});
describe('Feature: seance, Property 8: Time', () => {
  it('step times are -1 or non-negative and the Round time is non-negative', () => {
    fc.assert(
      fc.property(sequenceArb, ({ message, start, items }) => {
        const r = createRound(message, start);
        run(r, items, start);
        for (const ms of r.stepMs) expect(ms === -1 || ms >= 0).toBe(true);
        if (r.endedAt !== -1) expect(r.endedAt - r.startedAt).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 200 },
    );
  });
  it('shifting every timestamp by a constant changes nothing but the stamps', () => {
    fc.assert(
      fc.property(sequenceArb, fc.integer({ min: -5_000, max: 50_000 }), ({ message, start, items }, shift) => {
        const a = createRound(message, start);
        const b = createRound(message, start + shift);
        run(a, items, start);
        run(b, items, start + shift);
        expect({ ...a, startedAt: 0, endedAt: 0, lastAt: 0, stepShownAt: 0 }).toEqual({ ...b, startedAt: 0, endedAt: 0, lastAt: 0, stepShownAt: 0 });
      }),
      { numRuns: 200 },
    );
  });
  it('extra stale inputs interleaved change nothing (frame rate does not matter)', () => {
    fc.assert(
      fc.property(sequenceArb, ({ message, start, items }) => {
        const clean = items.filter((i) => i.dt > 0);
        const a = createRound(message, start);
        const b = createRound(message, start);
        run(a, clean, start);
        let t = start;
        for (const { input, dt } of clean) {
          t += dt;
          stepRound(b, input, t);
          // a repeated frame: the same timestamp again, for any input except stop
          if (input.type !== 'stop') stepRound(b, input, t);
        }
        expect(b).toEqual(a);
      }),
      { numRuns: 200 },
    );
  });
});
