import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { suggest } from "../src/suggest.js";
import type { Layout, LayoutTarget } from "../src/types.js";
import { repeat, trial, user } from "./suggest-fixtures.js";

const ROLES: ReadonlyArray<LayoutTarget["role"]> = ["default", "rest-area"];

const screenArb = fc.record({ width: fc.integer({ min: 1, max: 400 }), height: fc.integer({ min: 1, max: 300 }) });

const targetsArb = fc.array(
  fc.record({
    x: fc.integer({ min: -20, max: 420 }),
    y: fc.integer({ min: -20, max: 320 }),
    width: fc.integer({ min: 1, max: 200 }),
    height: fc.integer({ min: 1, max: 150 }),
    role: fc.constantFrom(...ROLES),
  }),
  { maxLength: 6 },
);

const caseArb = fc.record({ screen: screenArb, raw: targetsArb, withEvents: fc.boolean() });

function build(c: { screen: Layout["screen"]; raw: ReadonlyArray<{ x: number; y: number; width: number; height: number; role: LayoutTarget["role"] }> }): Layout {
  return {
    screen: c.screen,
    targets: c.raw.map((r, i) => ({
      id: `t${i}`,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      autoRepeat: false,
      role: r.role,
    })),
  };
}

describe("centre-hit property", () => {
  /** **Validates: Requirements 6.10** */
  it("a centre-hit suggestion exists exactly for the selectable targets containing C, last, in id order", () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const layout = build(c);
        const trials = c.withEvents
          ? [trial("u", { accidental: repeat(5, { target: "t0", cause: "reading-pause" as const }) })]
          : [];
        const s = suggest({ mode: "head + dwell", users: [user("u", trials)], task: ["t0"], layout });
        const cx = Math.floor(c.screen.width / 2);
        const cy = Math.floor(c.screen.height / 2);
        const expected = layout.targets
          .filter(
            (t) =>
              t.role !== "rest-area" &&
              t.rect.x <= cx &&
              cx < t.rect.x + t.rect.width &&
              t.rect.y <= cy &&
              cy < t.rect.y + t.rect.height,
          )
          .map((t) => t.id)
          .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        const hits = s.filter((x) => x.metric === "screen-centre-hit");
        expect(hits.map((x) => x.targetId)).toEqual(expected);
        for (const h of hits) {
          expect(h.value).toBeNull();
          expect(h.users).toEqual([]);
          expect(h.followUp).toBeUndefined();
        }
        // Centre-hit suggestions are a suffix of the list.
        expect(s.slice(s.length - hits.length)).toEqual(hits);
      }),
      { numRuns: 200 },
    );
  });
});
