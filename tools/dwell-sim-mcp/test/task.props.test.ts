import fc from "fast-check";
import { describe, it } from "vitest";
import { expandTask } from "../src/task.js";
import type { Layout, LayoutTarget } from "../src/types.js";

const idArb = fc.string({ minLength: 1, maxLength: 4 });
const int32 = fc.integer({ min: -2147483648, max: 2147483647 });

const layoutArb = fc
  .uniqueArray(fc.record({ id: idArb, rest: fc.boolean() }), {
    selector: (t) => t.id,
    minLength: 2,
    maxLength: 8,
  })
  .filter((ts) => ts.filter((t) => !t.rest).length >= 2)
  .map(
    (ts): Layout =>
      ({
        screen: { width: 1000, height: 800 },
        targets: ts.map(
          (t): LayoutTarget =>
            ({
              id: t.id,
              rect: { x: 0, y: 0, width: 10, height: 10 },
              autoRepeat: false,
              role: t.rest ? "rest-area" : "default",
            }),
        ),
      }),
  );

function run(l: Layout, n: number, seed: number): string[] {
  const r = expandTask(l, { eachTarget: n }, seed);
  if (!r.ok) throw new Error("unexpected error");
  return r.ids;
}

describe("task expansion properties", () => {
  // **Validates: Requirements 4.1, 4.27**
  it("each selectable id appears n times, rest-area ids never, no adjacent repeat", () => {
    fc.assert(
      fc.property(layoutArb, fc.integer({ min: 1, max: 30 }), int32, (l, n, seed) => {
        const out = run(l, n, seed);
        const sel = l.targets.filter((t) => t.role !== "rest-area").map((t) => t.id);
        const rest = new Set(l.targets.filter((t) => t.role === "rest-area").map((t) => t.id));
        if (out.length !== sel.length * n) return false;
        for (const id of sel) if (out.filter((x) => x === id).length !== n) return false;
        if (out.some((x) => rest.has(x))) return false;
        for (let i = 1; i < out.length; i++) if (out[i] === out[i - 1]) return false;
        return true;
      }),
    );
  });

  // **Validates: Requirements 4.1, 7.1**
  it("is deterministic and independent of registration order", () => {
    fc.assert(
      fc.property(layoutArb, fc.integer({ min: 1, max: 20 }), int32, (l, n, seed) => {
        const reversed: Layout = { ...l, targets: [...l.targets].reverse() };
        const a = run(l, n, seed);
        return (
          JSON.stringify(a) === JSON.stringify(run(l, n, seed)) &&
          JSON.stringify(a) === JSON.stringify(run(reversed, n, seed))
        );
      }),
    );
  });

  // **Validates: Requirements 7.1**
  it("two selectable targets and many rounds never repeat in a row", () => {
    fc.assert(
      fc.property(int32, fc.integer({ min: 20, max: 100 }), (seed, n) => {
        const l = {
          screen: { width: 1000, height: 800 },
          targets: ["a", "b"].map((id) => ({
            id,
            rect: { x: 0, y: 0, width: 10, height: 10 },
            autoRepeat: false,
            role: "default" as const,
          })),
        };
        const out = run(l, n, seed);
        for (let i = 1; i < out.length; i++) if (out[i] === out[i - 1]) return false;
        return out.length === 2 * n;
      }),
    );
  });
});
