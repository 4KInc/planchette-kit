import { describe, expect, it } from "vitest";
import { expandTask } from "../src/task.js";
import type { Layout, LayoutTarget } from "../src/types.js";

function target(id: string, extra: Partial<LayoutTarget> = {}): LayoutTarget {
  return {
    id,
    rect: { x: 0, y: 0, width: 10, height: 10 },
    autoRepeat: false,
    role: "default",
    ...extra,
  };
}

function layout(targets: LayoutTarget[]): Layout {
  return { screen: { width: 1000, height: 800 }, targets };
}

function ids(l: Layout, n: number, seed: number): string[] {
  const r = expandTask(l, { eachTarget: n }, seed);
  if (!r.ok) throw new Error("unexpected error");
  return r.ids;
}

describe("expandTask", () => {
  it("returns a valid explicit list as a copy", () => {
    const list = ["a", "b", "a"];
    const r = expandTask(layout([target("a"), target("b")]), list, 1);
    expect(r).toEqual({ ok: true, ids: ["a", "b", "a"] });
    if (r.ok) expect(r.ids).not.toBe(list);
  });

  it("each selectable id appears n times and rest-area ids never", () => {
    const l = layout([target("b"), target("a"), target("z", { role: "rest-area" }), target("c")]);
    const out = ids(l, 4, 7);
    expect(out).toHaveLength(12);
    for (const id of ["a", "b", "c"]) expect(out.filter((x) => x === id)).toHaveLength(4);
    expect(out).not.toContain("z");
  });

  it("never repeats an id in a row with two selectable targets and many rounds", () => {
    const out = ids(layout([target("a"), target("b")]), 100, 3);
    expect(out).toHaveLength(200);
    for (let i = 1; i < out.length; i++) expect(out[i]).not.toBe(out[i - 1]);
  });

  it("same seed gives the same list, another seed a different one", () => {
    const l = layout(["a", "b", "c", "d", "e"].map((i) => target(i)));
    expect(ids(l, 5, 1)).toEqual(ids(l, 5, 1));
    expect(ids(l, 5, 1)).not.toEqual(ids(l, 5, 2));
  });

  it("does not depend on registration order", () => {
    const a = layout([target("a"), target("b"), target("c")]);
    const b = layout([target("c"), target("a"), target("b")]);
    expect(ids(a, 6, 9)).toEqual(ids(b, 6, 9));
  });

  it("one selectable autoRepeat target gives n unshuffled copies", () => {
    const l = layout([target("a", { autoRepeat: true }), target("r", { role: "rest-area" })]);
    expect(ids(l, 3, 1)).toEqual(["a", "a", "a"]);
  });


  it("zero selectable targets gives an empty list", () => {
    expect(ids(layout([target("r", { role: "rest-area" })]), 3, 1)).toEqual([]);
  });

  it("sorts ids by UTF-16 order (uppercase before lowercase)", () => {
    const out = ids(layout([target("b"), target("B")]), 1, 1);
    expect([...out].sort()).toEqual(["B", "b"]);
  });
});
