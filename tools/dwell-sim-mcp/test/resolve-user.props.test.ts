import fc from "fast-check";
import { describe, it, expect } from "vitest";
import { PRESET_NAMES } from "../src/presets.js";
import { resolveUser, type UserInput } from "../src/resolve-user.js";
import { Purpose, stream, u01 } from "../src/rng.js";

const userInput: fc.Arbitrary<UserInput> = fc.oneof(
  fc.constantFrom(...PRESET_NAMES),
  fc.record({
    name: fc.string({ minLength: 1, maxLength: 8 }),
    base: fc.constantFrom(...PRESET_NAMES),
    overrides: fc.record(
      {
        reactionTimeMs: fc.double({ min: 150, max: 1500, noNaN: true }),
        scatterCapDeg: fc.double({ min: 0.1, max: 3, noNaN: true }),
        throughputBitsPerS: fc.double({ min: 0.3, max: 4, noNaN: true }),
      },
      { requiredKeys: [] },
    ),
  }),
);

const int32 = fc.integer({ min: -2147483648, max: 2147483647 });
const purpose = fc.constantFrom(Purpose.Aim, Purpose.Reaction, Purpose.TrackingNoise, Purpose.Start);

function keyOf(input: UserInput): number {
  const r = resolveUser(input);
  if (!r.ok) throw new Error(r.error.message);
  return r.user.key;
}

describe("resolve-user stream independence", () => {
  // **Validates: Requirements 3.2, 3.3, 3.6, 7.1**
  it("other users in the list never change a user's key or draws", () => {
    fc.assert(
      fc.property(
        userInput,
        fc.array(userInput, { maxLength: 6 }),
        fc.array(userInput, { maxLength: 6 }),
        fc.integer({ min: 0, max: 6 }),
        int32,
        fc.integer({ min: 0, max: 20 }),
        purpose,
        int32,
        int32,
        (target, before, after, rot, seed, trial, p, k, j) => {
          const alone = keyOf(target);
          const list: UserInput[] = [...before, target, ...after];
          const reordered = [...list.slice(rot % list.length), ...list.slice(0, rot % list.length)].reverse();
          const idx = list.indexOf(target);
          const idx2 = reordered.indexOf(target);
          // Keys are computed per user, independent of list position.
          const keysA = list.map(keyOf);
          const keysB = reordered.map(keyOf);
          expect(keysA[idx]).toBe(alone);
          expect(keysB[idx2]).toBe(alone);
          const draw = (key: number) => u01(stream(seed, key, trial, p), k, j);
          expect(draw(keysA[idx])).toBe(draw(alone));
          expect(draw(keysB[idx2])).toBe(draw(alone));
        },
      ),
    );
  });
});
