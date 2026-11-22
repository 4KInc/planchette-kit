import { describe, expect, it } from "vitest";
import type { Rect, ScreenSize } from "@planchette/skeleton";
import { runStays, type Stay } from "./p6-stream.js";

/**
 * The known counterexample to Property 6 without the restriction in part (b), pinned as an example.
 *
 * d1 = 1000 ms, d2 = 1200 ms, postSelectionPause = 500 ms, no autoRepeat.
 * - S1 is on target 0 from 0 to 1000 ms. S2 is on target 1 from 1100 to 2400 ms: a 900 ms reading
 *   pause inside a 1300 ms stay.
 * - Under d1, S1 selects at 1000 ms and starts a pause to 1500 ms. S2 dwells from 1100, but the pause
 *   hides 1100..1500, so only 900 ms count by 2400 and S2 does not select.
 * - Under d2, S1 (1000 ms) is too short, so no pause starts, and S2 reaches 1200 ms at 2300 ms.
 * So raising the dwell time added an accident (S2). The property excludes such streams: part (b)
 * requires the gap between stays to be at least d_new + postSelectionPause = 1700 ms; here it is 100 ms.
 *
 * The sample step is 100 ms so that 2300 ms (= 1100 + 1200) is a sample time (a 33 ms step has no
 * sample at 2300).
 */

const SCREEN: ScreenSize = { width: 1280, height: 720 };
const RECT_1: Rect = { x: 50, y: 50, width: 300, height: 250 };
const RECT_2: Rect = { x: 450, y: 50, width: 300, height: 250 };

const D1 = 1000;
const D2 = 1200;
const PAUSE = 500;
const STEP = 100;

const STAYS: Stay[] = [
  { rect: RECT_1, start: 0, end: 1000 },
  { rect: RECT_2, start: 1100, end: 2400 },
];

describe("Property 6: the known counterexample (named example)", () => {
  // **Validates: Requirements 6.1**
  const profile = (dwellTime: number) => ({ dwellTime, postSelectionPause: PAUSE, graceTime: 0 });

  it("under d1, S1 selects at 1000 ms (pause to 1500 ms) and S2 does not select", () => {
    const run = runStays({ screen: SCREEN, profile: profile(D1), stays: STAYS, stepMs: STEP });
    expect(run.effectiveProfile.dwellTime).toBe(D1);
    expect(run.effectiveProfile.postSelectionPause).toBe(PAUSE);
    expect(run.cancels).toEqual([]);
    expect(run.selects).toEqual([{ targetId: "t0", now: 1000 }]);
    expect(run.selectedStays).toEqual([0]);
    // The pause started by S1 lasts until 1000 + 500 = 1500 ms.
    expect(STAYS[0].end + PAUSE).toBe(1500);
  });

  it("under d2, S1 does not select and S2 selects at 2300 ms", () => {
    const run = runStays({ screen: SCREEN, profile: profile(D2), stays: STAYS, stepMs: STEP });
    expect(run.effectiveProfile.dwellTime).toBe(D2);
    expect(run.cancels).toEqual([]);
    expect(run.selects).toEqual([{ targetId: "t1", now: 2300 }]);
    expect(run.selectedStays).toEqual([1]);
  });

  it("raising the dwell time adds an accident, and the stream breaks the restriction of part (b)", () => {
    const old = runStays({ screen: SCREEN, profile: profile(D1), stays: STAYS, stepMs: STEP });
    const next = runStays({ screen: SCREEN, profile: profile(D2), stays: STAYS, stepMs: STEP });
    // S2 is an accident under d2 only: not a subset, and not fewer.
    expect(old.selectedStays).not.toContain(1);
    expect(next.selectedStays).toContain(1);
    // Part (b) needs every gap >= d_new + postSelectionPause; here the gap is far below.
    const gap = STAYS[1].start - STAYS[0].end;
    expect(gap).toBe(100);
    expect(gap).toBeLessThan(D2 + PAUSE);
    expect(D2 + PAUSE).toBe(1700);
  });
});
