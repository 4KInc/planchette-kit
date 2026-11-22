import { describe, expect, it } from "vitest";
import { expandTask } from "../src/task.js";
import type { Layout, LayoutTarget } from "../src/types.js";
function target(id: string, extra: Partial<LayoutTarget> = {}): LayoutTarget {
  return { id, rect: { x: 0, y: 0, width: 10, height: 10 }, autoRepeat: false, role: "default", ...extra };
}
function layout(targets: LayoutTarget[]): Layout {
  return { screen: { width: 1000, height: 800 }, targets };
}
describe("expandTask validation", () => {
  it("explicit list: adjacent pair on a non-autoRepeat target names the second index and id", () => {
    const r = expandTask(layout([target("a"), target("b")]), ["a", "b", "b"], 1);
    expect(r).toEqual({ ok: false, error: { code: "ADJACENT_REPEAT", index: 2, targetId: "b" } });
  });
  it("explicit list: the first offending pair in list order is reported", () => {
    const r = expandTask(layout([target("a"), target("b")]), ["a", "b", "b", "a", "a"], 1);
    expect(r).toEqual({ ok: false, error: { code: "ADJACENT_REPEAT", index: 2, targetId: "b" } });
  });
  it("explicit list: the same pair on an autoRepeat target is allowed", () => {
    const l = layout([target("a", { autoRepeat: true }), target("b")]);
    expect(expandTask(l, ["a", "a", "a", "b"], 1)).toEqual({ ok: true, ids: ["a", "a", "a", "b"] });
  });
  it("explicit list: an autoRepeat pair is skipped and a later non-autoRepeat pair is reported", () => {
    const l = layout([target("a", { autoRepeat: true }), target("b")]);
    const r = expandTask(l, ["a", "a", "b", "b"], 1);
    expect(r).toEqual({ ok: false, error: { code: "ADJACENT_REPEAT", index: 3, targetId: "b" } });
  });
  it("explicit list: an id unknown to the layout counts as no autoRepeat", () => {
    const r = expandTask(layout([target("a")]), ["x", "x"], 1);
    expect(r).toEqual({ ok: false, error: { code: "ADJACENT_REPEAT", index: 1, targetId: "x" } });
  });
  it("eachTarget n > 1 with one selectable target without autoRepeat is an error at position 1", () => {
    const l = layout([target("a"), target("r", { role: "rest-area" })]);
    expect(expandTask(l, { eachTarget: 3 }, 1)).toEqual({
      ok: false,
      error: { code: "ADJACENT_REPEAT", index: 1, targetId: "a" },
    });
  });
  it("eachTarget n = 1 with one selectable target gives that one id", () => {
    expect(expandTask(layout([target("a")]), { eachTarget: 1 }, 1)).toEqual({ ok: true, ids: ["a"] });
  });
  it("eachTarget with one autoRepeat target gives n copies", () => {
    expect(expandTask(layout([target("a", { autoRepeat: true })]), { eachTarget: 3 }, 1)).toEqual({
      ok: true,
      ids: ["a", "a", "a"],
    });
  });
});
