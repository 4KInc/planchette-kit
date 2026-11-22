import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CUSTOM_RANGES } from "../src/custom-ranges.js";
import { PRESET_NAMES } from "../src/presets.js";
import { resolveUser } from "../src/resolve-user.js";
import { expandTask } from "../src/task.js";
import type { Layout } from "../src/types.js";
import {
  customUserArb,
  layoutArb,
  presetArb,
  profileArb,
  resolvedUserArb,
  selectableIds,
  taskArb,
} from "./arbitraries.js";

function counterexample<T>(r: fc.RunDetails<[unknown, ...unknown[]]>): T {
  expect(r.failed).toBe(true);
  return (r.counterexample as unknown as [T])[0];
}

type Rect = { x: number; y: number; width: number; height: number };

function overlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function inside(r: Rect, w: number, h: number): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.width <= w && r.y + r.height <= h && r.width > 0 && r.height > 0;
}

function contains(r: Rect, px: number, py: number): boolean {
  return px >= r.x && px < r.x + r.width && py >= r.y && py < r.y + r.height;
}

/** Does the segment (x0,y0)-(x1,y1) touch the rectangle? Sampled densely; rectangles are at least 1 px. */
function segmentHits(r: Rect, x0: number, y0: number, x1: number, y1: number): boolean {
  const steps = 4000;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) return true;
  }
  return false;
}

function checkLayout(l: Layout): void {
  const { width, height } = l.screen;
  for (const t of l.targets) expect(inside(t.rect, width, height)).toBe(true);
  for (let i = 0; i < l.targets.length; i++) {
    for (let j = i + 1; j < l.targets.length; j++) {
      expect(overlap(l.targets[i].rect, l.targets[j].rect)).toBe(false);
    }
  }
  expect(new Set(l.targets.map((t) => t.id)).size).toBe(l.targets.length);
}

describe("layoutArb", () => {
  it("builds layouts inside the screen with no overlap, one rest area and a clear centre (defaults)", () => {
    fc.assert(
      fc.property(layoutArb(), (l) => {
        checkLayout(l);
        expect(l.screen.width).toBeGreaterThanOrEqual(640);
        expect(l.screen.width).toBeLessThanOrEqual(1920);
        expect(l.screen.height).toBeGreaterThanOrEqual(480);
        expect(l.screen.height).toBeLessThanOrEqual(1080);
        expect(l.targets.filter((t) => t.role === "rest-area")).toHaveLength(1);
        expect(l.targets.filter((t) => t.role === "cancel").length).toBeLessThanOrEqual(1);
        const ordinary = l.targets.filter((t) => t.role === "default");
        expect(ordinary.length).toBeGreaterThanOrEqual(1);
        expect(ordinary.length).toBeLessThanOrEqual(8);
        for (const t of l.targets) {
          expect(t.autoRepeat).toBe(false);
          expect(t.rect.width).toBeGreaterThanOrEqual(40);
          expect(t.rect.height).toBeGreaterThanOrEqual(40);
          expect(contains(t.rect, l.screen.width / 2, l.screen.height / 2)).toBe(false);
        }
      }),
    );
  });

  it("honours the options: fixed screen, no rest area, cancel always or never, target counts, side, autoRepeat", () => {
    fc.assert(
      fc.property(
        layoutArb({ screen: { width: 800, height: 600 }, restArea: false, cancelTarget: true, minTargets: 3, maxTargets: 5, minSide: 60, includeAutoRepeat: true }),
        (l) => {
          checkLayout(l);
          expect(l.screen).toEqual({ width: 800, height: 600 });
          expect(l.targets.some((t) => t.role === "rest-area")).toBe(false);
          expect(l.targets.filter((t) => t.role === "cancel")).toHaveLength(1);
          const ordinary = l.targets.filter((t) => t.role === "default");
          expect(ordinary.length).toBeGreaterThanOrEqual(3);
          expect(ordinary.length).toBeLessThanOrEqual(5);
          for (const t of l.targets) {
            expect(t.rect.width).toBeGreaterThanOrEqual(60);
            expect(t.rect.height).toBeGreaterThanOrEqual(60);
          }
        },
      ),
    );
    fc.assert(
      fc.property(layoutArb({ cancelTarget: false }), (l) => l.targets.every((t) => t.role !== "cancel")),
    );
    const flags = fc.sample(layoutArb({ includeAutoRepeat: true, minTargets: 4 }), 100).flatMap((l) => l.targets.map((t) => t.autoRepeat));
    expect(flags).toContain(true);
    expect(flags).toContain(false);
    const withCancel = fc.sample(layoutArb(), 100).map((l) => l.targets.some((t) => t.role === "cancel"));
    expect(withCancel).toContain(true);
    expect(withCancel).toContain(false);
  });

  it("may let a target contain the centre when centreClear is false", () => {
    const hits = fc
      .sample(layoutArb({ centreClear: false, minTargets: 8, maxTargets: 8 }), 300)
      .some((l) => l.targets.some((t) => contains(t.rect, l.screen.width / 2, l.screen.height / 2)));
    expect(hits).toBe(true);
  });

  it("puts an ordinary target on every straight path from the centre to the rest area", () => {
    fc.assert(
      fc.property(layoutArb({ selectableBetweenCentreAndRest: true }), fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (l, fx, fy) => {
        checkLayout(l);
        const rest = l.targets.find((t) => t.role === "rest-area")!.rect;
        const between = l.targets.find((t) => t.id === "t0")!;
        expect(between.role).toBe("default");
        const cx = l.screen.width / 2;
        const cy = l.screen.height / 2;
        expect(contains(between.rect, cx, cy)).toBe(false);
        const px = rest.x + fx * (rest.width - 1);
        const py = rest.y + fy * (rest.height - 1);
        expect(segmentHits(between.rect, cx, cy, px, py)).toBe(true);
      }),
    );
  });

  it("rejects a between-target layout without a rest area", () => {
    expect(() => layoutArb({ restArea: false, selectableBetweenCentreAndRest: true })).toThrow();
  });

  it("shrinks toward one ordinary target", () => {
    const r = fc.check(fc.property(layoutArb(), () => false));
    const l = counterexample<Layout>(r);
    expect(l.targets.filter((t) => t.role === "default")).toHaveLength(1);
    expect(l.targets.some((t) => t.role === "cancel")).toBe(false);
  });
});

describe("users", () => {
  it("presetArb draws only known presets", () => {
    fc.assert(fc.property(presetArb, (p) => (PRESET_NAMES as readonly string[]).includes(p)));
  });

  it("custom users stay inside CUSTOM_RANGES and resolve", () => {
    const within = (v: number | undefined, name: keyof typeof CUSTOM_RANGES): boolean =>
      v === undefined || (v >= CUSTOM_RANGES[name].min && v <= CUSTOM_RANGES[name].max);
    fc.assert(
      fc.property(customUserArb(), (u) => {
        const o = u.overrides!;
        for (const k of [
          "throughputBitsPerS",
          "tremorFrequencyHz",
          "tremorPeakToPeakDeg",
          "reactionTimeMs",
          "readingPauseChancePct",
          "scatterCapDeg",
          "trackingNoiseDeg",
        ] as const) {
          expect(within(o[k], k)).toBe(true);
        }
        for (const d of ["left", "right", "up", "down"] as const) expect(within(o.headRangeDeg?.[d], "headRangeDeg")).toBe(true);
        if (o.readingPauseLengthMs) {
          expect(within(o.readingPauseLengthMs.min, "readingPauseLengthMs")).toBe(true);
          expect(within(o.readingPauseLengthMs.max, "readingPauseLengthMs")).toBe(true);
          expect(o.readingPauseLengthMs.min).toBeLessThanOrEqual(o.readingPauseLengthMs.max);
        }
        expect(resolveUser(u).ok).toBe(true);
      }),
    );
  });

  it("reaches the boundaries of the ranges", () => {
    const users = fc.sample(customUserArb(), 600);
    const seen = (f: (u: (typeof users)[number]) => number | undefined, v: number): boolean => users.some((u) => f(u) === v);
    expect(seen((u) => u.overrides?.scatterCapDeg, CUSTOM_RANGES.scatterCapDeg.min)).toBe(true);
    expect(seen((u) => u.overrides?.scatterCapDeg, CUSTOM_RANGES.scatterCapDeg.max)).toBe(true);
    expect(seen((u) => u.overrides?.headRangeDeg?.left, 3)).toBe(true);
    expect(seen((u) => u.overrides?.headRangeDeg?.left, 60)).toBe(true);
  });

  it("pins fixed values and narrows ranges", () => {
    fc.assert(
      fc.property(
        customUserArb({
          fixed: { tremorFrequencyHz: 0, tremorPeakToPeakDeg: 0, trackingNoiseDeg: 0, readingPauseChancePct: 0 },
          ranges: { headRangeDeg: { min: 3, max: 10 } },
          base: "steady",
        }),
        (u) => {
          const o = u.overrides!;
          expect(u.base).toBe("steady");
          expect(o.tremorFrequencyHz).toBe(0);
          expect(o.tremorPeakToPeakDeg).toBe(0);
          expect(o.trackingNoiseDeg).toBe(0);
          expect(o.readingPauseChancePct).toBe(0);
          for (const d of ["left", "right", "up", "down"] as const) {
            const v = o.headRangeDeg?.[d];
            if (v !== undefined) {
              expect(v).toBeGreaterThanOrEqual(3);
              expect(v).toBeLessThanOrEqual(10);
            }
          }
          const user = resolveUser(u);
          expect(user.ok).toBe(true);
        },
      ),
    );
  });

  it("always applies a narrowed range (reactionTimeMs 400..600) on the resolved user", () => {
    fc.assert(
      fc.property(customUserArb({ ranges: { reactionTimeMs: { min: 400, max: 600 } } }), (u) => {
        expect(u.overrides?.reactionTimeMs).toBeDefined();
        const r = resolveUser(u);
        if (!r.ok) throw new Error(r.error.message);
        expect(r.user.params.reactionTimeMs).toBeGreaterThanOrEqual(400);
        expect(r.user.params.reactionTimeMs).toBeLessThanOrEqual(600);
      }),
    );
  });

  it("rejects an empty narrowed range", () => {
    expect(() => customUserArb({ ranges: { scatterCapDeg: { min: 5, max: 6 } } })).toThrow();
  });

  it("resolvedUserArb gives resolved users and shrinks toward steady", () => {
    fc.assert(fc.property(resolvedUserArb(), (u) => u.params.headRangeDeg.left >= 3 && Number.isInteger(u.key)));
    const r = fc.check(fc.property(resolvedUserArb(), () => false));
    expect(counterexample<{ name: string }>(r).name).toBe("steady");
  });
});

describe("profileArb", () => {
  it("draws values inside the profile ranges", () => {
    fc.assert(
      fc.property(profileArb(), (p) => {
        expect(p.headGain!).toBeGreaterThanOrEqual(1);
        expect(p.headGain!).toBeLessThanOrEqual(2);
        expect(p.headDeadZone!).toBeGreaterThanOrEqual(0);
        expect(p.headDeadZone!).toBeLessThanOrEqual(1.5);
        expect(p.dwellTime!).toBeGreaterThanOrEqual(400);
        expect(p.dwellTime!).toBeLessThanOrEqual(3000);
        expect(p.graceTime!).toBeLessThanOrEqual(500);
        expect(p.postSelectionPause!).toBeGreaterThanOrEqual(200);
        expect(p.postSelectionPause!).toBeLessThanOrEqual(3000);
        expect(p.calibrationRangeLeft).toBeUndefined();
      }),
    );
  });

  it("keeps the dead zone at most half the smallest range when ranges are included, and honours narrowed ranges", () => {
    fc.assert(
      fc.property(profileArb({ calibrationRanges: true, dwellTime: { min: 500, max: 800 }, postSelectionPause: { min: 200, max: 400 } }), (p) => {
        const ranges = [p.calibrationRangeLeft!, p.calibrationRangeRight!, p.calibrationRangeUp!, p.calibrationRangeDown!];
        for (const r of ranges) {
          expect(r).toBeGreaterThanOrEqual(3);
          expect(r).toBeLessThanOrEqual(90);
        }
        expect(p.headDeadZone!).toBeLessThanOrEqual(0.5 * Math.min(...ranges));
        expect(p.dwellTime!).toBeGreaterThanOrEqual(500);
        expect(p.dwellTime!).toBeLessThanOrEqual(800);
        expect(p.postSelectionPause!).toBeLessThanOrEqual(400);
      }),
    );
  });
});

describe("taskArb", () => {
  const withLayout = (opts: Parameters<typeof layoutArb>[0], taskOpts: Parameters<typeof taskArb>[1], check: (l: Layout, ids: string[]) => void) =>
    fc.assert(
      fc.property(
        layoutArb(opts).chain((l) => fc.tuple(fc.constant(l), taskArb(l, taskOpts))),
        fc.integer({ min: -1000, max: 1000 }),
        ([l, spec], seed) => {
          const result = expandTask(l, spec, seed);
          expect(result.ok).toBe(true);
          if (result.ok) check(l, result.ids);
        },
      ),
    );

  it("names only ids of the layout, never the rest area, and expands without ADJACENT_REPEAT", () => {
    withLayout({}, {}, (l, ids) => {
      const allowed = new Set(selectableIds(l));
      expect(ids.length).toBeGreaterThanOrEqual(1);
      for (const id of ids) expect(allowed.has(id)).toBe(true);
      expect(ids).not.toContain("rest");
    });
  });

  it("is valid on layouts with autoRepeat targets and with a single target", () => {
    withLayout({ includeAutoRepeat: true }, { maxLength: 12 }, () => undefined);
    withLayout({ minTargets: 1, maxTargets: 1, restArea: false, cancelTarget: false, includeAutoRepeat: true }, { maxLength: 6 }, (_l, ids) => {
      expect(ids.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("can leave out the cancel target, and respects maxLength", () => {
    fc.assert(
      fc.property(
        layoutArb({ cancelTarget: true, minTargets: 2 }).chain((l) => fc.tuple(fc.constant(l), taskArb(l, { includeCancel: false, form: "list", maxLength: 4 }))),
        ([l, spec]) => {
          const ids = spec as readonly string[];
          expect(ids.length).toBeGreaterThanOrEqual(1);
          expect(ids.length).toBeLessThanOrEqual(4);
          expect(ids).not.toContain("cancel");
          expect(expandTask(l, spec, 1).ok).toBe(true);
        },
      ),
    );
  });

  it("draws both forms", () => {
    const layout = fc.sample(layoutArb({ minTargets: 3 }), 1)[0];
    const specs = fc.sample(taskArb(layout), 100);
    expect(specs.some((s) => Array.isArray(s))).toBe(true);
    expect(specs.some((s) => !Array.isArray(s))).toBe(true);
  });

  it("shrinks toward a one-entry list", () => {
    const layout = fc.sample(layoutArb({ minTargets: 3 }), 1)[0];
    const r = fc.check(fc.property(taskArb(layout), () => false));
    const spec = counterexample<readonly string[]>(r);
    expect(Array.isArray(spec)).toBe(true);
    expect(spec).toHaveLength(1);
  });

  it("rejects eachTarget together with includeCancel false on a layout with a cancel target", () => {
    const layout = fc.sample(layoutArb({ cancelTarget: true }), 1)[0];
    expect(() => taskArb(layout, { form: "eachTarget", includeCancel: false })).toThrow();
  });
});
