import { describe, expect, it } from "vitest";
import { suggest, type SuggestInput } from "../src/suggest.js";
import type { Layout } from "../src/types.js";
import { layoutOf, repeat, target, trial, user } from "./suggest-fixtures.js";

// SCREEN is 1001 x 601, so C = (500, 300).
function run(layout: Layout, withEvents = false, mode: SuggestInput["mode"] = "head + dwell") {
  const trials = withEvents
    ? [trial("u", { accidental: repeat(4, { target: "a", cause: "reading-pause" as const }) })]
    : [];
  return suggest({ mode, users: [user("u", trials)], task: ["a"], layout });
}

const centreHits = (layout: Layout, withEvents = false) =>
  run(layout, withEvents).filter((s) => s.metric === "screen-centre-hit");

describe("centre-hit suggestions", () => {
  it("gives one suggestion for a target containing the centre, with no events and no rest area", () => {
    const s = centreHits(layoutOf(target("a", 450, 280, 100, 50)));
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ targetId: "a", metric: "screen-centre-hit", value: null, users: [] });
    expect(s[0]).not.toHaveProperty("followUp");
    expect(s[0].text).toContain("a");
  });

  it("also gives it with a rest area present", () => {
    const layout = layoutOf(target("a", 450, 280, 100, 50), target("rest", 0, 0, 50, 50, "rest-area"));
    expect(centreHits(layout).map((s) => s.targetId)).toEqual(["a"]);
  });

  it("gives none when only a rest area contains the centre", () => {
    expect(centreHits(layoutOf(target("rest", 450, 280, 100, 50, "rest-area")))).toEqual([]);
  });

  it("gives none when no target contains the centre", () => {
    expect(centreHits(layoutOf(target("a", 0, 0, 100, 50)))).toEqual([]);
  });

  it("decides edge pixels by x <= C.x < x + width and the same for y", () => {
    const has = (x: number, y: number, w: number, h: number) =>
      centreHits(layoutOf(target("a", x, y, w, h))).length === 1;
    expect(has(500, 300, 10, 10)).toBe(true); // left/top edge included
    expect(has(491, 291, 10, 10)).toBe(true); // last pixel inside: 491 + 10 > 500
    expect(has(490, 300, 10, 10)).toBe(false); // right edge x + width == C.x excluded
    expect(has(500, 290, 10, 10)).toBe(false); // bottom edge excluded
    expect(has(501, 300, 10, 10)).toBe(false);
    expect(has(500, 301, 10, 10)).toBe(false);
  });

  it("uses floor for an even screen size", () => {
    const layout: Layout = { screen: { width: 1000, height: 600 }, targets: [target("a", 500, 300, 1, 1)] };
    expect(centreHits(layout)).toHaveLength(1);
    const miss: Layout = { screen: { width: 1000, height: 600 }, targets: [target("a", 499, 299, 1, 1)] };
    expect(centreHits(miss)).toHaveLength(0);
  });

  it("is not limited by the 3-event minimum and works in scan mode", () => {
    const layout = layoutOf(target("a", 450, 280, 100, 50));
    expect(centreHits(layout, true)).toHaveLength(1);
    expect(run(layout, false, "scan").map((s) => s.metric)).toEqual(["screen-centre-hit"]);
  });

  it("puts centre-hit suggestions after all other suggestions", () => {
    // "a" holds the centre and also has a reading-pause suggestion; "z" sorts later and is unreachable by nobody.
    const layout = layoutOf(target("a", 450, 280, 100, 50), target("z", 0, 0, 10, 10));
    const trials = [
      trial("u", {
        accidental: [
          ...repeat(4, { target: "a", cause: "reading-pause" as const }),
          ...repeat(4, { target: "z", cause: "reading-pause" as const }),
        ],
      }),
    ];
    const s = suggest({ mode: "head + dwell", users: [user("u", trials)], task: ["a", "z"], layout });
    expect(s.map((x) => `${x.targetId}:${x.metric}`)).toEqual([
      "a:reading-pause share",
      "z:reading-pause share",
      "a:screen-centre-hit",
    ]);
  });

  it("gives one suggestion per overlapping target containing the centre, in UTF-16 id order", () => {
    const layout = layoutOf(
      target("b", 480, 290, 50, 30),
      target("B", 490, 295, 30, 20),
      target("a", 400, 250, 200, 100),
    );
    expect(centreHits(layout).map((s) => s.targetId)).toEqual(["B", "a", "b"]);
  });
});
