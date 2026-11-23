/** Shared by the Property 7 test and its regression test (not a test file itself). */
import type { Profile, ScreenSize } from "@planchette/skeleton";
import { toPx } from "../src/geometry.js";
import { insideRect, type EntryPlan } from "../src/plan-entry.js";
import { openTrial, type TrialConfig } from "../src/run-trial.js";
import type { ResolvedUser } from "../src/types.js";

export const ANALYSIS_WINDOW_MS = 60_000;

/**
 * B2 (D4): the scatter cap in px, the largest over the four directions (+yaw, -yaw, +pitch, -pitch).
 * Each direction is measured twice: from the head-centre pose, and from the dead-zone edge
 * (`+-headDeadZone`) outward by the cap. The dead zone eats the first `headDeadZone` degrees, so a
 * shift of the cap that starts outside it moves the pointer by `slope * cap`, more than the same
 * shift from the centre pose (`slope * (cap - D)`); the edge measurement is the larger one.
 *
 * Centre: (0, 0), the placeholder `openTrial` starts with. It is safe here because tremor and noise
 * are pinned to 0, so the warm-up holds the head still at the centre pose and the engine captures
 * (0, 0). `traced` asserts `d.centre` is (0, 0) on every run, so a violation fails loudly instead
 * of silently under-sizing the targets. (Reading the real captured centre needs a whole warm-up
 * per generated case, which is not cheap.)
 */
export function sdCapPx(screen: ScreenSize, profile: Partial<Profile>, user: ResolvedUser): number {
  const d = openTrial({
    layout: { screen, targets: [] },
    profile,
    user,
    mode: "head + dwell",
    task: [],
    fps: 60,
    analysisWindowMs: ANALYSIS_WINDOW_MS,
    requestSeed: 0,
    trialIndex: 0,
  });
  try {
    const cap = user.params.scatterCapDeg;
    const dz = d.geometry.profile.headDeadZone;
    let best = 0;
    for (const start of [0, dz]) {
      for (const [sy, sp] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const a = toPx(d.geometry, { yaw: sy * start, pitch: sp * start });
        const b = toPx(d.geometry, { yaw: sy * (start + cap), pitch: sp * (start + cap) });
        best = Math.max(best, Math.hypot(b.x - a.x, b.y - a.y));
      }
    }
    return best;
  } finally {
    d.pl.destroy();
  }
}

/** D4: the planned aim of every entry lies inside its intended target (half-open rectangle). */
export function aimsInside(cfg: Pick<TrialConfig, "layout">, plans: readonly EntryPlan[]): boolean {
  return plans.every((p) => {
    const rect = cfg.layout.targets.find((t) => t.id === p.targetId)!.rect;
    return insideRect(rect, p.aimPx);
  });
}

