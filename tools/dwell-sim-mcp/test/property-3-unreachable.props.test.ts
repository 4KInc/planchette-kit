/**
 * Property 3: Unreachable means miss.
 *
 * Head-pointing trials where the profile's calibration ranges are 1.5 to 3 times the user's head
 * range (3 to 10 degrees), so the head cannot reach the whole screen. One target is moved fully
 * outside the reachable rectangle (the case is built by moving the target, never by discarding a
 * draw). The skeleton must emit no `select` or `cancel` for it, and every entry for it is a miss.
 * A partly reachable target is not generated.
 *
 * **Validates: Requirements 11.1, 11.2, 11.11, 11.12**
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Rect } from "@planchette/skeleton";
import { isTargetReachable, reachableRect } from "../src/reachable.js";
import { resolveUser } from "../src/resolve-user.js";
import { openTrial, runTrial, runWarmup, type TrialConfig } from "../src/run-trial.js";
import type { Layout, RawEvent, ResolvedUser } from "../src/types.js";
import { customUserArb, layoutArb, profileArb, selectableIds, taskArb } from "./arbitraries.js";

type Side = "left" | "right" | "above" | "below";

interface Case {
  cfg: TrialConfig;
  movedId: string;
}

const userArb: fc.Arbitrary<ResolvedUser> = customUserArb({ ranges: { headRangeDeg: { min: 3, max: 10 } } }).map((input) => {
  const r = resolveUser(input);
  if (!r.ok) throw new Error(`invalid user: ${r.error.message}`);
  return r.user;
});

const factor = fc.double({ min: 1.5, max: 3, noNaN: true });

/** The rectangle moved fully beyond `side` of the reachable rectangle, kept on screen where it fits. */
function moveBeyond(rect: Rect, side: Side, reach: ReturnType<typeof reachableRect>, screen: Layout["screen"], gap: number): Rect {
  switch (side) {
    case "right": {
      const x = reach.xMax + 1 + gap;
      const room = screen.width - x;
      return { ...rect, x, width: room >= 1 ? Math.min(rect.width, room) : rect.width };
    }
    case "left": {
      const room = reach.xMin - gap;
      const width = room >= 1 ? Math.min(rect.width, room) : rect.width;
      return { ...rect, x: reach.xMin - gap - width, width };
    }
    case "below": {
      const y = reach.yMax + 1 + gap;
      const room = screen.height - y;
      return { ...rect, y, height: room >= 1 ? Math.min(rect.height, room) : rect.height };
    }
    case "above": {
      const room = reach.yMin - gap;
      const height = room >= 1 ? Math.min(rect.height, room) : rect.height;
      return { ...rect, y: reach.yMin - gap - height, height };
    }
  }
}

const caseArb: fc.Arbitrary<Case> = fc
  .tuple(
    layoutArb({ maxScreen: { width: 1280, height: 720 } }),
    userArb,
    profileArb(),
    fc.tuple(factor, factor, factor, factor),
    fc.constantFrom<Side>("left", "right", "above", "below"),
    fc.integer({ min: 0, max: 40 }),
    fc.nat(),
    fc.integer({ min: 0, max: 0x7fffffff }),
    fc.integer({ min: 0, max: 3 }),
    fc.constantFrom<15 | 30 | 60>(15, 30, 60),
  )
  .chain(([layout, user, baseProfile, f, side, gap, pick, requestSeed, trialIndex, fps]) => {
    const ids = selectableIds(layout);
    const movedId = ids[pick % ids.length];
    const range = user.params.headRangeDeg;
    const profile = {
      ...baseProfile,
      calibrationRangeLeft: range.left * f[0],
      calibrationRangeRight: range.right * f[1],
      calibrationRangeUp: range.up * f[2],
      calibrationRangeDown: range.down * f[3],
    };
    // The effective profile (as the skeleton clamps it) and the captured centre fix the reachable rectangle.
    const probe = openTrial({ layout, profile, user, mode: "head + dwell", task: [], fps, analysisWindowMs: 1000, requestSeed, trialIndex });
    // The warm-up is independent of the layout; it fixes the centre the engine captures (D2).
    runWarmup(probe);
    const geometry = probe.geometry;
    probe.pl.destroy();
    const reach = reachableRect(geometry);
    const moved: Layout = {
      screen: layout.screen,
      targets: layout.targets.map((t) =>
        t.id === movedId ? { ...t, rect: moveBeyond(t.rect, side, reach, layout.screen, gap) } : t,
      ),
    };
    const movedRect = moved.targets.find((t) => t.id === movedId)!.rect;
    // Construction check: the target is fully outside, not partly reachable.
    if (isTargetReachable(geometry, movedRect)) throw new Error(`construction error: ${movedId} is reachable`);
    return taskArb(moved, { form: "list", maxLength: 4 }).map((raw): Case => {
      // form "list" always yields an id array.
      const task = [movedId, ...(raw as readonly string[])].filter((id, i, a) => i === 0 || id !== a[i - 1]);
      return {
        movedId,
        cfg: { layout: moved, profile, user, mode: "head + dwell", task, fps, analysisWindowMs: 2500, requestSeed, trialIndex },
      };
    });
  });

describe("Property 3: unreachable means miss", () => {
  it("an unreachable target gets no select or cancel event and every entry for it is a miss", () => {
    fc.assert(
      fc.property(caseArb, ({ cfg, movedId }) => {
        const seen: RawEvent[] = [];
        const result = runTrial({ ...cfg, observers: { onEvent: (e) => seen.push({ ...e }) } });
        expect(seen.filter((e) => e.targetId === movedId)).toEqual([]);
        const mine = result.entries.filter((e) => e.targetId === movedId);
        expect(mine.length).toBeGreaterThan(0);
        for (const e of mine) {
          expect(e.outcome).toBe("miss");
          expect(e.timeToSelectMs).toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });
});
