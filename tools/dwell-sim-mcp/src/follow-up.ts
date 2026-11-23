/**
 * Follow-up runs for a tremor-at-edge suggestion (design section 8, AC 5, 8, 9).
 *
 * For `s` in 1.25, 1.5, 2 (in order): scale the target rectangle about its centre by `s`,
 * intersect it with the screen, rerun only the users that had events on the target (accidental
 * records or misses on it, any cause, any trial; start-of-session events are not events) with
 * the same seed, task and trial indices, and stop at the first run with zero accidental
 * selections and zero misses on the target. At most 3 extra runs. The runner is injected so
 * tests can stub it; the real one is `runUser`. No clock, no random draws.
 */
import type { Rect } from "@planchette/skeleton";
import type { TrialResult } from "./metrics.js";
import type { RunUserConfig, RunUserResult } from "./run-user.js";
import type { SuggestionFollowUp } from "./suggest.js";
import { followUpText } from "./suggestion-text.js";
import type { Layout, LayoutTarget } from "./types.js";

/** The multiples of the target size, in the order they are tried. */
export const FOLLOW_UP_FACTORS: readonly number[] = [1.25, 1.5, 2];

/** The runner: `runUser` in production, a stub in tests. Only `trials` of the result is read. */
export type FollowUpRunner = (cfg: RunUserConfig) => Pick<RunUserResult, "trials">;

/** One simulated user as the follow-up needs it. */
export interface FollowUpUser {
  name: string;
  /** The trials of the original run (to find out whether the user had events on the target). */
  trials: readonly TrialResult[];
  /** The configuration of the original run for this user; the layout is replaced per follow-up run. */
  config: RunUserConfig;
}

export interface FollowUpInput {
  /** The original layout. */
  layout: Layout;
  /** Id of the suggested target. */
  targetId: string;
  /** Users in request order. */
  users: readonly FollowUpUser[];
  runner: FollowUpRunner;
}

export interface FollowUpResult {
  /** Set only when some multiple reached zero (AC 9: otherwise the suggestion has no follow-up size). */
  followUp?: SuggestionFollowUp;
  /** Wording to append to the suggestion text; empty when there is no follow-up. */
  text: string;
  /** Number of extra runs made (0 to 3). */
  runs: number;
}

/** Number of events (accidental records plus misses) on the target in the given trials. */
export function eventsOnTarget(trials: readonly TrialResult[], targetId: string): number {
  let n = 0;
  for (const trial of trials) {
    for (const a of trial.accidental) if (a.targetId === targetId) n++;
    for (const e of trial.entries) if (e.outcome === "miss" && e.targetId === targetId) n++;
  }
  return n;
}

/** `rect` scaled about its centre by `s`, intersected with the screen; null when nothing is left. */
export function scaleAndClip(rect: Rect, s: number, screen: { width: number; height: number }): Rect | null {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const w = rect.width * s;
  const h = rect.height * s;
  const x0 = Math.max(0, cx - w / 2);
  const y0 = Math.max(0, cy - h / 2);
  const x1 = Math.min(screen.width, cx + w / 2);
  const y1 = Math.min(screen.height, cy + h / 2);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Ids (UTF-16 order) of the other targets that the rectangle overlaps. */
function overlapsOf(layout: Layout, targetId: string, rect: Rect): string[] {
  const ids: string[] = [];
  for (const t of layout.targets) if (t.id !== targetId && intersects(rect, t.rect)) ids.push(t.id);
  return ids.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function withRect(layout: Layout, targetId: string, rect: Rect): Layout {
  const targets: LayoutTarget[] = layout.targets.map((t) => (t.id === targetId ? { ...t, rect } : t));
  return { screen: layout.screen, targets };
}

export function followUp(input: FollowUpInput): FollowUpResult {
  const { layout, targetId, runner } = input;
  const target = layout.targets.find((t) => t.id === targetId);
  const rerun = input.users.filter((u) => eventsOnTarget(u.trials, targetId) > 0);
  let runs = 0;
  if (target === undefined || rerun.length === 0) return { text: "", runs };

  for (const factor of FOLLOW_UP_FACTORS) {
    const rect = scaleAndClip(target.rect, factor, layout.screen);
    if (rect === null) continue;
    const scaled = withRect(layout, targetId, rect);
    runs++;
    let events = 0;
    for (const u of rerun) {
      events += eventsOnTarget(runner({ ...u.config, layout: scaled }).trials, targetId);
    }
    if (events === 0) {
      const overlaps = overlapsOf(layout, targetId, rect);
      return { followUp: { factor, overlaps }, text: followUpText(factor, overlaps), runs };
    }
  }
  return { text: "", runs };
}
