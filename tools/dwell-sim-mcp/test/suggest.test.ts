import { describe, expect, it } from "vitest";
import { segmentRectDist2, suggest, type SuggestInput } from "../src/suggest.js";
import { FULL, SMALL, layoutOf, repeat, target, trial, user, type TrialSpec } from "./suggest-fixtures.js";

const T1 = target("t1", 400, 300);
const LAYOUT = layoutOf(T1);

function run(specs: Record<string, TrialSpec>, extra: Partial<SuggestInput> = {}) {
  const users = Object.entries(specs).map(([name, spec]) => user(name, [trial(name, spec)]));
  return suggest({ mode: "head + dwell", users, task: ["t1", "t1"], layout: LAYOUT, ...extra });
}

const reading = (n: number) => repeat(n, { target: "t1", cause: "reading-pause" as const });
const other = (n: number) => repeat(n, { target: "t1", cause: "pass-over" as const });

describe("reading-pause rule", () => {
  it("suggests when the share is above 50 % with at least 3 events", () => {
    const s = run({ u: { accidental: [...reading(3), ...other(1)] } });
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ targetId: "t1", metric: "reading-pause share", value: 0.75, users: ["u"] });
  });

  it("gives none at exactly 50 %", () => {
    expect(run({ u: { accidental: [...reading(2), ...other(2)] } })).toEqual([]);
  });

  it("gives none with 2 events even at 100 %", () => {
    expect(run({ u: { accidental: reading(2) } })).toEqual([]);
  });

  it("counts misses as events but not as accidental selections", () => {
    // 2 accidental reading + 1 miss: 3 events, reading share 2/2 = 1.
    const s = run({ u: { accidental: reading(2), misses: [{ target: "t1", cause: "other" }] } });
    expect(s.map((x) => x.metric)).toEqual(["reading-pause share"]);
    expect(s[0].value).toBe(1);
  });

  it("gives no reading-pause suggestion for an all-miss target", () => {
    const s = run({ u: { misses: repeat(4, { target: "t1", cause: "other" as const }) } });
    expect(s).toEqual([]);
  });

  it("rounds the value to 2 decimals but thresholds the unrounded share", () => {
    // 2 of 3 = 0.666...
    const s = run({ u: { accidental: [...reading(2), ...other(1)] } });
    expect(s[0].value).toBe(0.67);
  });

  it("ignores start-of-session events", () => {
    expect(run({ u: { accidental: reading(2), starts: ["t1", "t1", "t1"] } })).toEqual([]);
  });
});

describe("tremor-at-edge rule", () => {
  it("counts accidental records and misses with the cause", () => {
    const s = run({
      u: {
        accidental: [{ target: "t1", cause: "tremor-at-edge" }],
        misses: [
          { target: "t1", cause: "tremor-at-edge" },
          { target: "t1", cause: "other" },
        ],
      },
    });
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ metric: "tremor-at-edge share", value: 0.67, users: ["u"] });
  });

  it("gives none at exactly 50 % and with 2 events", () => {
    expect(
      run({
        u: {
          misses: [
            { target: "t1", cause: "tremor-at-edge" },
            { target: "t1", cause: "tremor-at-edge" },
            { target: "t1", cause: "other" },
            { target: "t1", cause: "other" },
          ],
        },
      }),
    ).toEqual([]);
    expect(run({ u: { misses: repeat(2, { target: "t1", cause: "tremor-at-edge" as const }) } })).toEqual([]);
  });

  it("names only users with an event of that cause, in request order", () => {
    const edge = { misses: repeat(2, { target: "t1", cause: "tremor-at-edge" as const }) };
    const s = run({ zed: edge, mid: { misses: [{ target: "t1", cause: "other" }] }, alpha: edge });
    expect(s).toHaveLength(1);
    expect(s[0].users).toEqual(["zed", "alpha"]);
  });

  it("gives two suggestions when both rules fire on one target", () => {
    const s = run({
      u: {
        accidental: [
          ...reading(3),
          { target: "t1", cause: "tremor-at-edge" },
        ],
        misses: repeat(4, { target: "t1", cause: "tremor-at-edge" as const }),
      },
    });
    expect(s.map((x) => x.metric)).toEqual(["reading-pause share", "tremor-at-edge share"]);
  });
});

describe("scan mode", () => {
  it("skips the reading-pause and tremor-at-edge rules", () => {
    const s = run(
      {
        u: {
          accidental: reading(5),
          misses: repeat(5, { target: "t1", cause: "tremor-at-edge" as const }),
        },
      },
      { mode: "scan" },
    );
    expect(s).toEqual([]);
  });

  it("still gives the unreachable rule", () => {
    const users = [user("u", [trial("u", {})], SMALL)];
    const s = suggest({ mode: "scan", users, task: ["far"], layout: layoutOf(target("far", 0, 0)) });
    expect(s.map((x) => x.metric)).toEqual(["unreachable"]);
  });
});

describe("unreachable rule", () => {
  const far = target("far", 0, 0, 100, 50); // outside SMALL (x 250..750, y 150..450)

  it("needs no events and gives one suggestion per target listing users in request order", () => {
    const users = [user("c", [], SMALL), user("a", [], FULL), user("b", [], SMALL)];
    const s = suggest({ mode: "head + dwell", users, task: ["far"], layout: layoutOf(far) });
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ targetId: "far", metric: "unreachable", value: null, users: ["c", "b"] });
  });

  it("is absent when every user reaches the target", () => {
    const users = [user("a", [], FULL)];
    expect(suggest({ mode: "head + dwell", users, task: ["far"], layout: layoutOf(far) })).toEqual([]);
  });
});

describe("rest areas", () => {
  it("get no suggestion from any rule", () => {
    const rest = target("rest", 0, 0, 100, 50, "rest-area");
    const users = [
      user("u", [trial("u", { accidental: repeat(5, { target: "rest", cause: "reading-pause" as const }) })], SMALL),
    ];
    expect(suggest({ mode: "head + dwell", users, task: ["rest"], layout: layoutOf(rest) })).toEqual([]);
  });
});

describe("order", () => {
  it("sorts targets by UTF-16 id, then reading-pause, tremor-at-edge, unreachable", () => {
    const layout = layoutOf(target("b", 0, 0), target("B", 0, 100), target("a", 400, 300));
    const spec: TrialSpec = {
      accidental: ["a", "b", "B"].flatMap((id) => [
        ...repeat(3, { target: id, cause: "reading-pause" as const }),
        ...repeat(5, { target: id, cause: "tremor-at-edge" as const }),
      ]),
    };
    const users = [user("u", [trial("u", spec)], SMALL)];
    const s = suggest({ mode: "head + dwell", users, task: ["a"], layout });
    // reading = 3/8 (none); edge = 5/8
    expect(s.map((x) => `${x.targetId}:${x.metric}`)).toEqual([
      "B:tremor-at-edge share",
      "B:unreachable",
      "a:tremor-at-edge share",
      "b:tremor-at-edge share",
      "b:unreachable",
    ]);
  });

  it("puts reading-pause before tremor-at-edge before unreachable on one target", () => {
    const layout = layoutOf(target("x", 0, 0));
    const spec: TrialSpec = {
      accidental: reading(4),
      misses: repeat(20, { target: "x", cause: "tremor-at-edge" as const }),
    };
    const s = suggest({
      mode: "head + dwell",
      users: [user("u", [trial("u", { ...spec, accidental: repeat(4, { target: "x", cause: "reading-pause" as const }) })], SMALL)],
      task: ["x"],
      layout,
    });
    expect(s.map((x) => x.metric)).toEqual(["reading-pause share", "tremor-at-edge share", "unreachable"]);
  });
});

describe("path rule", () => {
  // home centre (50, 25), next centre (550, 25): the segment runs along y = 25.
  const home = target("home", 0, 0, 100, 50);
  const next = target("next", 500, 0, 100, 50);
  function withT(y: number) {
    return layoutOf(home, next, target("t", 250, y, 100, 50));
  }
  const readingTrial = [trial("u", { accidental: repeat(3, { target: "t", cause: "reading-pause" as const }) })];
  const task = ["home", "next", "home", "next"];

  function runPath(y: number, t = task) {
    return suggest({ mode: "head + dwell", users: [user("u", readingTrial)], task: t, layout: withT(y) });
  }

  it("adds the path text to the same reading-pause suggestion when the distance equals the width", () => {
    // rect top at y = 125: distance 100 = width of t.
    const s = runPath(125);
    expect(s).toHaveLength(1);
    expect(s[0].metric).toBe("reading-pause share");
    expect(s[0].text).toContain("home");
    expect(s[0].text).toContain("next");
  });

  it("does not add it just beyond the width", () => {
    const s = runPath(126);
    expect(s).toHaveLength(1);
    expect(s[0].text).not.toContain("home");
    expect(s[0].text).not.toContain("next");
  });

  it("adds it when the segment crosses the rectangle", () => {
    const s = suggest({
      mode: "head + dwell",
      users: [user("u", readingTrial)],
      task,
      layout: layoutOf(home, next, target("t", 250, 0, 100, 50)),
    });
    expect(s[0].text).toContain("next");
  });

  it("uses only consecutive entries: a split pair does not count", () => {
    // home and next are each commonly used, but never consecutive.
    const s = runPath(125, ["home", "t", "next", "t", "home", "t", "next", "t"]);
    expect(s[0].text).not.toContain("home");
  });

  it("does not count a self-pair", () => {
    // Only pairs (home -> home): a self-pair gives no path.
    const s = runPath(125, ["home", "home", "home", "home", "next"]);
    // pair (home -> next) exists once and next is 1/5 = 20 %: commonly used, so path to next is found.
    expect(s[0].text).toContain("next");
    const s2 = runPath(125, ["home", "home", "home", "home", "home"]);
    expect(s2[0].text).not.toContain("home");
  });

  it("ignores a destination used in fewer than 20 % of the entries", () => {
    // next is 1 of 10 entries; home is commonly used, so only the path to home is named.
    const s = runPath(125, ["home", "next", ...repeat(8, "home")]);
    expect(s[0].text).toContain("home");
    expect(s[0].text).not.toContain("next");
  });
});

describe("segmentRectDist2", () => {
  const r = { x: 250, y: 125, width: 100, height: 50 };
  it("is the squared distance to the nearest edge", () => {
    expect(segmentRectDist2({ x: 50, y: 25 }, { x: 550, y: 25 }, r)).toBe(10000);
  });
  it("is 0 when an end point is inside", () => {
    expect(segmentRectDist2({ x: 300, y: 150 }, { x: 900, y: 25 }, r)).toBe(0);
  });
});
