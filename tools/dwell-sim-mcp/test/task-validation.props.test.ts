import fc from "fast-check";
import { describe, it } from "vitest";
import { expandTask } from "../src/task.js";
import type { Layout, LayoutTarget } from "../src/types.js";
const ID_POOL = ["a", "b", "c", "d"];
const layoutArb = fc
  .array(fc.boolean(), { minLength: ID_POOL.length, maxLength: ID_POOL.length })
  .map(
    (flags): Layout => ({
      screen: { width: 1000, height: 800 },
      targets: ID_POOL.map(
        (id, i): LayoutTarget => ({
          id,
          rect: { x: 0, y: 0, width: 10, height: 10 },
          autoRepeat: flags[i],
          role: "default",
        }),
      ),
    }),
  );
// Small id pool and a few duplicates make adjacent pairs common.
const listArb = fc.array(fc.constantFrom(...ID_POOL), { maxLength: 12 });
describe("task validation properties", () => {
  // **Validates: Requirements 4.26**
  it("error exactly when a non-autoRepeat adjacent pair exists, naming the first such second index", () => {
    fc.assert(
      fc.property(layoutArb, listArb, (l, list) => {
        let expected = -1;
        for (let i = 1; i < list.length && expected < 0; i++) {
          if (list[i] === list[i - 1] && !l.targets.find((t) => t.id === list[i])?.autoRepeat) expected = i;
        }
        const r = expandTask(l, list, 0);
        if (expected < 0) return r.ok && r.ids.length === list.length && r.ids.every((x, i) => x === list[i]);
        return (
          !r.ok &&
          r.error.code === "ADJACENT_REPEAT" &&
          r.error.index === expected &&
          r.error.targetId === list[expected]
        );
      }),
      { numRuns: 500 },
    );
  });
});
