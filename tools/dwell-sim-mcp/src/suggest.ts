/**
 * Suggestion rules (design section 8): reading-pause, tremor-at-edge and unreachable.
 * Pure functions of their inputs: no clock, no random draws.
 *
 * Extension points:
 * - Task 10.2 fills `Suggestion.followUp` for tremor-at-edge suggestions (see `SuggestionFollowUp`).
 * - Task 10.4 appends the centre-hit suggestions; they come last, so they are added after
 *   `suggest` has built the per-target list (see the marked place in `suggest`).
 */
import type { Rect } from "@planchette/skeleton";
import type { GeometryContext } from "./geometry.js";
import type { TrialResult } from "./metrics.js";
import { isTargetReachable } from "./reachable.js";
import { centreHitText, readingPauseText, tremorAtEdgeText, unreachableText } from "./suggestion-text.js";
import type { Layout, LayoutTarget } from "./types.js";

export type SuggestionMetric = "reading-pause share" | "tremor-at-edge share" | "unreachable" | "screen-centre-hit";

/**
 * Follow-up record (design sections 8 and 11): the first tried multiple of the target size with
 * zero accidental selections and zero misses on the target, and the ids it overlaps.
 */
export interface SuggestionFollowUp {
  factor: number;
  overlaps: string[];
}

export interface Suggestion {
  targetId: string;
  metric: SuggestionMetric;
  /** Share rounded to two decimals; null for `unreachable` and `screen-centre-hit`. */
  value: number | null;
  users: string[];
  text: string;
  followUp?: SuggestionFollowUp;
}

/** One simulated user: name (request order is the array order), trials and effective geometry. */
export interface SuggestUser {
  name: string;
  trials: readonly TrialResult[];
  /** Effective profile, screen and head range of this user (for the unreachable rule). */
  geometry: GeometryContext;
}

export interface SuggestInput {
  mode: "head + dwell" | "scan";
  /** Users in request order. */
  users: readonly SuggestUser[];
  /** The expanded task (target ids), the same in every trial. */
  task: readonly string[];
  layout: Layout;
}

/** Minimum events per target for the two event-based rules (AC 7). */
export const MIN_EVENTS = 3;
/** A share must be strictly above this to give a suggestion. */
export const SHARE_THRESHOLD = 0.5;
/** A target is commonly used when it makes up at least this fraction of the task entries. */
export const COMMON_USE_FRACTION = 0.2;

function byUtf16(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

// ---------- geometry of the path rule ----------

interface Pt {
  x: number;
  y: number;
}

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function segmentsIntersect(p1: Pt, p2: Pt, q1: Pt, q2: Pt): boolean {
  const d1 = cross(q1, q2, p1);
  const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1);
  const d4 = cross(p1, p2, q2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const within = (a: Pt, b: Pt, c: Pt): boolean =>
    Math.min(a.x, b.x) <= c.x && c.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= c.y && c.y <= Math.max(a.y, b.y);
  if (d1 === 0 && within(q1, q2, p1)) return true;
  if (d2 === 0 && within(q1, q2, p2)) return true;
  if (d3 === 0 && within(p1, p2, q1)) return true;
  if (d4 === 0 && within(p1, p2, q2)) return true;
  return false;
}

/** Squared distance from point `p` to the segment `a`-`b`. */
function pointSegmentDist2(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.min(1, Math.max(0, t));
  const ex = a.x + t * dx - p.x;
  const ey = a.y + t * dy - p.y;
  return ex * ex + ey * ey;
}

function insideClosed(p: Pt, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/**
 * Squared distance between the segment `a`-`b` and the rectangle: 0 when they intersect (an end
 * point inside counts), else the least squared distance between the segment and the four edges.
 */
export function segmentRectDist2(a: Pt, b: Pt, r: Rect): number {
  if (insideClosed(a, r) || insideClosed(b, r)) return 0;
  const c1: Pt = { x: r.x, y: r.y };
  const c2: Pt = { x: r.x + r.width, y: r.y };
  const c3: Pt = { x: r.x + r.width, y: r.y + r.height };
  const c4: Pt = { x: r.x, y: r.y + r.height };
  const edges: ReadonlyArray<readonly [Pt, Pt]> = [
    [c1, c2],
    [c2, c3],
    [c3, c4],
    [c4, c1],
  ];
  let best = Infinity;
  for (const [e1, e2] of edges) {
    if (segmentsIntersect(a, b, e1, e2)) return 0;
    best = Math.min(
      best,
      pointSegmentDist2(a, e1, e2),
      pointSegmentDist2(b, e1, e2),
      pointSegmentDist2(e1, a, b),
      pointSegmentDist2(e2, a, b),
    );
  }
  return best;
}

function centre(t: LayoutTarget): Pt {
  return { x: t.rect.x + t.rect.width / 2, y: t.rect.y + t.rect.height / 2 };
}

/**
 * Commonly used targets (ids, UTF-16 order): those making up at least 20 % of the task entries.
 */
export function commonlyUsed(task: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const id of task) counts.set(id, (counts.get(id) ?? 0) + 1);
  const out: string[] = [];
  for (const [id, n] of counts) if (n >= COMMON_USE_FRACTION * task.length) out.push(id);
  return out.sort(byUtf16);
}

/**
 * Commonly used targets whose path passes within one target width of `t`: for some consecutive
 * pair `(i -> j)` of the task with `j` commonly used, `i !== j` and `t` neither, the segment between
 * the two target centres is at most `t.rect.width` from `t.rect`. UTF-16 order, no duplicates.
 */
export function pathTargets(t: LayoutTarget, task: readonly string[], layout: Layout, common: readonly string[]): string[] {
  const byId = new Map<string, LayoutTarget>();
  for (const x of layout.targets) byId.set(x.id, x);
  const commonSet = new Set(common);
  const found = new Set<string>();
  const w2 = t.rect.width * t.rect.width;
  for (let k = 1; k < task.length; k++) {
    const i = task[k - 1];
    const j = task[k];
    if (i === j || !commonSet.has(j) || found.has(j) || t.id === i || t.id === j) continue;
    const ti = byId.get(i);
    const tj = byId.get(j);
    if (ti === undefined || tj === undefined) continue;
    if (segmentRectDist2(centre(ti), centre(tj), t.rect) <= w2) found.add(j);
  }
  return [...found].sort(byUtf16);
}

// ---------- the rules ----------

interface EventCounts {
  /** Accidental records on the target, all users. */
  accidental: number;
  accidentalReading: number;
  /** Accidental records plus misses with the tremor-at-edge cause. */
  edge: number;
  misses: number;
  readingUsers: Set<string>;
  edgeUsers: Set<string>;
}

function countEvents(targetId: string, users: readonly SuggestUser[]): EventCounts {
  const c: EventCounts = {
    accidental: 0,
    accidentalReading: 0,
    edge: 0,
    misses: 0,
    readingUsers: new Set(),
    edgeUsers: new Set(),
  };
  for (const u of users) {
    for (const trial of u.trials) {
      for (const a of trial.accidental) {
        if (a.targetId !== targetId) continue;
        c.accidental++;
        if (a.cause === "reading-pause") {
          c.accidentalReading++;
          c.readingUsers.add(u.name);
        } else if (a.cause === "tremor-at-edge") {
          c.edge++;
          c.edgeUsers.add(u.name);
        }
      }
      for (const e of trial.entries) {
        if (e.outcome !== "miss" || e.targetId !== targetId) continue;
        c.misses++;
        if (e.missCause === "tremor-at-edge") {
          c.edge++;
          c.edgeUsers.add(u.name);
        }
      }
    }
  }
  return c;
}

/** Suggestions in the fixed order of design section 8 (without the centre-hit rule, task 10.4). */
export function suggest(input: SuggestInput): Suggestion[] {
  const { mode, users, task, layout } = input;
  const targets = layout.targets.filter((t) => t.role !== "rest-area").sort((a, b) => byUtf16(a.id, b.id));
  const common = commonlyUsed(task);
  const out: Suggestion[] = [];

  for (const t of targets) {
    if (mode === "head + dwell") {
      const c = countEvents(t.id, users);
      const events = c.accidental + c.misses;
      if (events >= MIN_EVENTS) {
        const reading = c.accidental === 0 ? 0 : c.accidentalReading / c.accidental;
        const edge = c.edge / events;
        if (reading > SHARE_THRESHOLD) {
          out.push({
            targetId: t.id,
            metric: "reading-pause share",
            value: round2(reading),
            users: users.filter((u) => c.readingUsers.has(u.name)).map((u) => u.name),
            text: readingPauseText(t.id, reading, pathTargets(t, task, layout, common)),
          });
        }
        if (edge > SHARE_THRESHOLD) {
          // Task 10.2 adds `followUp` to this suggestion.
          out.push({
            targetId: t.id,
            metric: "tremor-at-edge share",
            value: round2(edge),
            users: users.filter((u) => c.edgeUsers.has(u.name)).map((u) => u.name),
            text: tremorAtEdgeText(t.id, edge),
          });
        }
      }
    }
    // Only in head + dwell: in scan a switch highlights targets in turn, so head range does not
    // decide whether a target can be reached (design section 8, Req 6 AC 3).
    const cannotReach =
      mode === "head + dwell"
        ? users.filter((u) => !isTargetReachable(u.geometry, t.rect)).map((u) => u.name)
        : [];
    if (cannotReach.length > 0) {
      out.push({
        targetId: t.id,
        metric: "unreachable",
        value: null,
        users: cannotReach,
        text: unreachableText(t.id),
      });
    }
  }

  // Centre-hit rule (design section 8): C = (floor(width / 2), floor(height / 2)); a selectable
  // target with x <= C.x < x + width and y <= C.y < y + height gets one suggestion. Last in order.
  const cx = Math.floor(layout.screen.width / 2);
  const cy = Math.floor(layout.screen.height / 2);
  for (const t of targets) {
    const r = t.rect;
    if (r.x <= cx && cx < r.x + r.width && r.y <= cy && cy < r.y + r.height) {
      out.push({ targetId: t.id, metric: "screen-centre-hit", value: null, users: [], text: centreHitText(t.id) });
    }
  }
  return out;
}
