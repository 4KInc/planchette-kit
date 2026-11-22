/**
 * Shared fast-check arbitraries for the dwell-sim-mcp property tests (design, "Testing Strategy").
 *
 * Every arbitrary takes an options object so the property tests can reuse it with their own
 * constraints. Only public skeleton types and this package's own modules are used. All
 * randomness comes from fast-check.
 *
 * Shrinking: layouts toward fewer targets and the smallest grid, users toward the `steady`
 * preset with no overrides, tasks toward one entry, profiles toward their lower bounds.
 *
 * Layout construction (overlap is built out, never filtered out): the screen is cut into a grid;
 * every target lives in its own cell, inside a margin of `CELL_MARGIN` px, at a jittered position
 * and size. Rectangles have integer coordinates.
 */
import fc from "fast-check";
import type { Profile, ScreenSize } from "@planchette/skeleton";
import { CUSTOM_RANGES, type CustomParamName } from "../src/custom-ranges.js";
import { PRESET_NAMES, type PresetName } from "../src/presets.js";
import { resolveUser, type CustomOverrides, type CustomUserInput } from "../src/resolve-user.js";
import type { Layout, LayoutTarget, ResolvedUser, TaskSpec } from "../src/types.js";

/** Gap in px between a target and the edge of its grid cell. */
export const CELL_MARGIN = 2;

export interface NumberRange {
  min: number;
  max: number;
}

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

export interface LayoutOptions {
  /** Number of ordinary (selectable, role "default") targets, not counting rest area or cancel. Default 1..8. */
  minTargets?: number;
  maxTargets?: number;
  /** Smallest side of a target in px (width and height). Default 40. */
  minSide?: number;
  /** Smallest width / height in px, each overriding `minSide` for its axis (a side is cut only when its grid cell is smaller). */
  minWidth?: number;
  minHeight?: number;
  /** Fixed screen size. When absent the size is drawn between `minScreen` and `maxScreen`. */
  screen?: ScreenSize;
  /** Default 640 x 480. */
  minScreen?: ScreenSize;
  /** Default 1920 x 1080. */
  maxScreen?: ScreenSize;
  /** Include one rest-area target (id "rest"). Default true. */
  restArea?: boolean;
  /** Cancel target (id "cancel", role "cancel"): `true` always, `false` never, `"optional"` drawn. Default "optional". */
  cancelTarget?: boolean | "optional";
  /** Let ordinary targets have `autoRepeat`. Default false (every target has autoRepeat false). */
  includeAutoRepeat?: boolean;
  /**
   * Keep the grid cell that contains the screen centre empty, so no target contains the centre
   * pixel (W/2, H/2). Default true.
   */
  centreClear?: boolean;
  /**
   * Put one ordinary target (id "t0") between the screen centre and the rest area: the rest area
   * is in the centre row, at least two columns from the centre, and "t0" sits in a column
   * strictly between, spanning the full height of that row. Any straight path from the centre
   * pixel to a point inside the rest area therefore crosses "t0". Requires `restArea: true`.
   * Default false.
   */
  selectableBetweenCentreAndRest?: boolean;
}

const DEFAULT_MIN_SCREEN: ScreenSize = { width: 640, height: 480 };
const DEFAULT_MAX_SCREEN: ScreenSize = { width: 1920, height: 1080 };

function gridEdges(total: number, n: number): number[] {
  return Array.from({ length: n + 1 }, (_, i) => Math.round((i * total) / n));
}

function cellOf(edges: number[], c: number): number {
  let idx = 0;
  for (let i = 0; i + 1 < edges.length; i++) if (edges[i] <= c) idx = i;
  return idx;
}

interface Cell {
  col: number;
  row: number;
}

type Jitter = [number, number, number, number];
const JITTER_SCALE = 1000;

function jitterArb(): fc.Arbitrary<Jitter> {
  const f = fc.integer({ min: 0, max: JITTER_SCALE });
  return fc.tuple(f, f, f, f);
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A rectangle inside `box` (already margin-reduced) with sides at least `minSide` when the box allows it. */
function rectIn(
  box: Box,
  minSide: number | { width: number; height: number },
  j: Jitter,
): { x: number; y: number; width: number; height: number } {
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  const minW = Math.min(typeof minSide === "number" ? minSide : minSide.width, bw);
  const minH = Math.min(typeof minSide === "number" ? minSide : minSide.height, bh);
  const width = minW + Math.floor((j[0] / JITTER_SCALE) * (bw - minW));
  const height = minH + Math.floor((j[1] / JITTER_SCALE) * (bh - minH));
  const x = box.x0 + Math.floor((j[2] / JITTER_SCALE) * (bw - width));
  const y = box.y0 + Math.floor((j[3] / JITTER_SCALE) * (bh - height));
  return { x, y, width, height };
}

export function layoutArb(options: LayoutOptions = {}): fc.Arbitrary<Layout> {
  const restArea = options.restArea ?? true;
  const between = options.selectableBetweenCentreAndRest ?? false;
  if (between && !restArea) throw new Error("selectableBetweenCentreAndRest requires restArea: true");
  const minSide =
    options.minWidth !== undefined || options.minHeight !== undefined
      ? { width: options.minWidth ?? options.minSide ?? 40, height: options.minHeight ?? options.minSide ?? 40 }
      : (options.minSide ?? 40);
  const centreClear = options.centreClear ?? true;
  const cancelOpt = options.cancelTarget ?? "optional";
  const minTargets = Math.max(options.minTargets ?? 1, between ? 1 : 0);
  const maxTargets = Math.max(options.maxTargets ?? 8, minTargets);
  const lo = options.minScreen ?? DEFAULT_MIN_SCREEN;
  const hi = options.maxScreen ?? DEFAULT_MAX_SCREEN;

  const screenArb: fc.Arbitrary<ScreenSize> = options.screen
    ? fc.constant(options.screen)
    : fc.record({
        width: fc.integer({ min: lo.width, max: hi.width }),
        height: fc.integer({ min: lo.height, max: hi.height }),
      });
  const cancelArb: fc.Arbitrary<boolean> =
    cancelOpt === "optional" ? fc.boolean() : fc.constant(cancelOpt);

  return fc
    .tuple(
      screenArb,
      fc.integer({ min: minTargets, max: maxTargets }),
      cancelArb,
      fc.integer({ min: 0, max: 1 }),
      fc.integer({ min: 0, max: 1 }),
      fc.boolean(),
    )
    .chain(([screen, nSel, hasCancel, extraCols, extraRows, restOnLeft]) => {
      const needed = nSel + (restArea ? 1 : 0) + (hasCancel ? 1 : 0) + (centreClear ? 1 : 0);
      let cols = Math.max(3, Math.ceil(Math.sqrt((needed * screen.width) / screen.height))) + extraCols;
      if (between) cols = Math.max(cols, 4);
      const rows = Math.max(1, Math.ceil(needed / cols)) + extraRows;
      const xs = gridEdges(screen.width, cols);
      const ys = gridEdges(screen.height, rows);
      const centreCell: Cell = { col: cellOf(xs, screen.width / 2), row: cellOf(ys, screen.height / 2) };

      // Cells with a fixed role.
      let restCell: Cell | undefined;
      let betweenCell: Cell | undefined;
      const taken = new Set<string>();
      const key = (c: Cell): string => `${c.col},${c.row}`;
      if (centreClear) taken.add(key(centreCell));
      let betweenChoices: fc.Arbitrary<number> = fc.constant(0);
      if (between) {
        const candidates = [0, cols - 1].filter((c) => Math.abs(c - centreCell.col) >= 2);
        const restCol = candidates.length === 1 || restOnLeft ? candidates[0] : candidates[1];
        restCell = { col: restCol, row: centreCell.row };
        const lowCol = Math.min(restCol, centreCell.col) + 1;
        const highCol = Math.max(restCol, centreCell.col) - 1;
        betweenChoices = fc.integer({ min: lowCol, max: highCol });
        taken.add(key(restCell));
      }

      const pool: Cell[] = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) pool.push({ col: c, row: r });

      return betweenChoices.chain((betweenCol) => {
        const taken2 = new Set(taken);
        if (between) {
          betweenCell = { col: betweenCol, row: centreCell.row };
          taken2.add(key(betweenCell));
        }
        const free = pool.filter((c) => !taken2.has(key(c)));
        const freeNeeded = (restArea && !between ? 1 : 0) + (hasCancel ? 1 : 0) + (between ? nSel - 1 : nSel);
        const rectCount = freeNeeded + (between ? 2 : 0);
        return fc
          .tuple(
            fc.shuffledSubarray(free, { minLength: freeNeeded, maxLength: freeNeeded }),
            fc.array(jitterArb(), { minLength: rectCount, maxLength: rectCount }),
            options.includeAutoRepeat
              ? fc.array(fc.boolean(), { minLength: nSel, maxLength: nSel })
              : fc.constant(new Array<boolean>(nSel).fill(false)),
          )
          .map(([cells, jitters, autoRepeats]): Layout => {
            const box = (c: Cell): Box => ({
              x0: xs[c.col] + CELL_MARGIN,
              y0: ys[c.row] + CELL_MARGIN,
              x1: xs[c.col + 1] - CELL_MARGIN,
              y1: ys[c.row + 1] - CELL_MARGIN,
            });
            const targets: LayoutTarget[] = [];
            let ci = 0;
            let ji = 0;
            const selectableCells: Cell[] = [];
            const restFree = restArea && !between ? cells[ci++] : undefined;
            const cancelCell = hasCancel ? cells[ci++] : undefined;
            if (betweenCell) selectableCells.push(betweenCell);
            while (selectableCells.length < nSel) selectableCells.push(cells[ci++]);

            selectableCells.forEach((cell, i) => {
              let rect = rectIn(box(cell), minSide, jitters[ji++]);
              if (between && i === 0) {
                // Full height of the centre row, so every path inside that row crosses it.
                rect = { ...rect, y: ys[cell.row], height: ys[cell.row + 1] - ys[cell.row] };
              }
              targets.push({ id: `t${i}`, rect, autoRepeat: autoRepeats[i], role: "default" });
            });
            if (cancelCell) {
              targets.push({ id: "cancel", rect: rectIn(box(cancelCell), minSide, jitters[ji++]), autoRepeat: false, role: "cancel" });
            }
            const finalRestCell = between ? restCell : restFree;
            if (restArea && finalRestCell) {
              targets.push({ id: "rest", rect: rectIn(box(finalRestCell), minSide, jitters[ji++]), autoRepeat: false, role: "rest-area" });
            }
            return { screen, targets };
          });
      });
    });
}

/** Ids of the targets a task may name: every target except the rest area (as `expandTask` does). */
export function selectableIds(layout: Layout): string[] {
  return layout.targets.filter((t) => t.role !== "rest-area").map((t) => t.id);
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/** Always `steady` first, so a failing user shrinks toward it. */
export const presetArb: fc.Arbitrary<PresetName> = fc.constantFrom(...PRESET_NAMES);

export interface CustomUserOptions {
  /** Narrow a customisable range (clipped to `CUSTOM_RANGES`; the narrowed range must not be empty). */
  ranges?: Partial<Record<Exclude<CustomParamName, "analysisWindowS">, NumberRange>>;
  /**
   * Values to pin. A pinned field is always present with exactly this value. For `headRangeDeg`
   * list only the directions to pin; the others stay random.
   */
  fixed?: CustomOverrides;
  /** Base preset. Default: any preset. */
  base?: PresetName;
}

const OVERRIDE_RANGE_KEYS = [
  "throughputBitsPerS",
  "tremorFrequencyHz",
  "tremorPeakToPeakDeg",
  "reactionTimeMs",
  "readingPauseChancePct",
  "scatterCapDeg",
  "trackingNoiseDeg",
] as const;

function effectiveRange(name: CustomParamName, narrowed: NumberRange | undefined): NumberRange {
  const r = CUSTOM_RANGES[name];
  const min = Math.max(r.min, narrowed?.min ?? r.min);
  const max = Math.min(r.max, narrowed?.max ?? r.max);
  if (min > max) throw new Error(`empty range for ${name}: ${min}..${max}`);
  return { min, max };
}

/** A double in [min, max]; both boundaries have their own branch so they show up often. */
export function rangedDouble(r: NumberRange): fc.Arbitrary<number> {
  if (r.min === r.max) return fc.constant(r.min);
  return fc.oneof(
    { weight: 6, arbitrary: fc.double({ min: r.min, max: r.max, noNaN: true }) },
    { weight: 1, arbitrary: fc.constant(r.min) },
    { weight: 1, arbitrary: fc.constant(r.max) },
  );
}

/** A custom user: a base preset plus overrides, all inside `CUSTOM_RANGES` (boundaries included). */
export function customUserArb(options: CustomUserOptions = {}): fc.Arbitrary<CustomUserInput> {
  const fixed = options.fixed ?? {};
  const ranges = options.ranges ?? {};
  const model: Record<string, fc.Arbitrary<unknown>> = {};
  const required: string[] = [];

  for (const k of OVERRIDE_RANGE_KEYS) {
    const pinned = fixed[k];
    if (pinned !== undefined) {
      model[k] = fc.constant(pinned);
      required.push(k);
    } else {
      model[k] = rangedDouble(effectiveRange(k, ranges[k]));
      // A narrowed range must always be applied, so the key cannot be dropped.
      if (ranges[k] !== undefined) required.push(k);
    }
  }

  if (fixed.tremorAxis !== undefined) {
    model.tremorAxis = fc.constant(fixed.tremorAxis);
    required.push("tremorAxis");
  } else {
    model.tremorAxis = fc.constantFrom("yaw", "pitch");
  }

  const headRange = effectiveRange("headRangeDeg", ranges.headRangeDeg);
  const directions = ["left", "right", "up", "down"] as const;
  const dirModel: Record<string, fc.Arbitrary<number>> = {};
  const dirRequired: string[] = [];
  for (const d of directions) {
    const pinned = fixed.headRangeDeg?.[d];
    if (pinned !== undefined) {
      dirModel[d] = fc.constant(pinned);
      dirRequired.push(d);
    } else {
      dirModel[d] = rangedDouble(headRange);
      // A narrowed head range covers all four directions, so each one is required too.
      if (ranges.headRangeDeg !== undefined) dirRequired.push(d);
    }
  }
  model.headRangeDeg = fc.record(dirModel, { requiredKeys: dirRequired });
  if (fixed.headRangeDeg !== undefined || ranges.headRangeDeg !== undefined) required.push("headRangeDeg");

  if (fixed.readingPauseLengthMs !== undefined) {
    model.readingPauseLengthMs = fc.constant(fixed.readingPauseLengthMs);
    required.push("readingPauseLengthMs");
  } else {
    const pr = effectiveRange("readingPauseLengthMs", ranges.readingPauseLengthMs);
    model.readingPauseLengthMs = fc
      .tuple(rangedDouble(pr), rangedDouble(pr))
      .map(([a, b]) => ({ min: Math.min(a, b), max: Math.max(a, b) }));
    if (ranges.readingPauseLengthMs !== undefined) required.push("readingPauseLengthMs");
  }

  // Optional fields shrink toward "not overridden", that is, toward the base preset.
  const overridesArb = fc.record(model, { requiredKeys: required }) as fc.Arbitrary<CustomOverrides>;
  const baseArb: fc.Arbitrary<PresetName> = options.base ? fc.constant(options.base) : presetArb;
  return fc
    .tuple(fc.integer({ min: 0, max: 999 }), baseArb, overridesArb)
    .map(([n, base, overrides]) => ({ name: `custom-${n}`, base, overrides }));
}

/** A preset name or a custom user, resolved. Shrinks toward the `steady` preset. */
export function resolvedUserArb(options: CustomUserOptions = {}): fc.Arbitrary<ResolvedUser> {
  const resolve = (input: string | CustomUserInput): ResolvedUser => {
    const r = resolveUser(input);
    if (!r.ok) throw new Error(`arbitrary produced an invalid user: ${r.error.message}`);
    return r.user;
  };
  return fc.oneof({ withCrossShrink: true }, presetArb.map(resolve), customUserArb(options).map(resolve));
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export interface ProfileOptions {
  /** Default 400..3000 (the profile's own range). */
  dwellTime?: NumberRange;
  /** Default 200..3000. */
  postSelectionPause?: NumberRange;
  /**
   * Also set the four calibration ranges (3..90 degrees each). Default false: the trial driver then
   * derives them from the user's head range. The dead zone never exceeds half the smallest range.
   */
  calibrationRanges?: boolean;
}

/** A `Partial<Profile>` whose fields are all valid (no clamping needed). */
export function profileArb(options: ProfileOptions = {}): fc.Arbitrary<Partial<Profile>> {
  const dwell = options.dwellTime ?? { min: 400, max: 3000 };
  const pause = options.postSelectionPause ?? { min: 200, max: 3000 };
  const common = {
    headGain: fc.double({ min: 1, max: 2, noNaN: true }),
    dwellTime: fc.integer({ min: Math.max(400, dwell.min), max: Math.min(3000, dwell.max) }),
    graceTime: fc.integer({ min: 0, max: 500 }),
    postSelectionPause: fc.integer({ min: Math.max(200, pause.min), max: Math.min(3000, pause.max) }),
  };
  const unit = fc.double({ min: 0, max: 1, noNaN: true });
  if (!options.calibrationRanges) {
    // The smallest range a user can have is 3 degrees, so a dead zone of up to 1.5 is always valid.
    return fc.record({ ...common, headDeadZone: unit.map((u) => u * 1.5) });
  }
  const range = fc.double({ min: 3, max: 90, noNaN: true });
  return fc
    .record({
      ...common,
      calibrationRangeLeft: range,
      calibrationRangeRight: range,
      calibrationRangeUp: range,
      calibrationRangeDown: range,
      deadZoneFraction: unit,
    })
    .map(({ deadZoneFraction, ...rest }) => ({
      ...rest,
      headDeadZone:
        deadZoneFraction *
        0.5 *
        Math.min(rest.calibrationRangeLeft, rest.calibrationRangeRight, rest.calibrationRangeUp, rest.calibrationRangeDown),
    }));
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export interface TaskOptions {
  /** Longest explicit list. Default 8. */
  maxLength?: number;
  /** Largest `n` of `{ eachTarget: n }`. Default 3. */
  maxEach?: number;
  /** Which forms to draw. Default "either". */
  form?: "list" | "eachTarget" | "either";
  /** May the task name the cancel target? Default true. */
  includeCancel?: boolean;
}

/**
 * A valid task for the layout: ids from the layout only (never the rest area), and no adjacent
 * repeat of a target without `autoRepeat`, so `expandTask` accepts it.
 */
export function taskArb(layout: Layout, options: TaskOptions = {}): fc.Arbitrary<TaskSpec> {
  const all = layout.targets.filter((t) => t.role !== "rest-area");
  const includeCancel = options.includeCancel ?? true;
  const candidates = all.filter((t) => includeCancel || t.role !== "cancel");
  if (candidates.length === 0) throw new Error("taskArb: the layout has no selectable target");
  const maxLength = options.maxLength ?? 8;
  const maxEach = options.maxEach ?? 3;
  const n = candidates.length;
  // With one non-autoRepeat target the only valid task has length 1 (or eachTarget: 1).
  const stuck = n === 1 && !candidates[0].autoRepeat;
  // `{ eachTarget }` always covers every non-rest target, cancel included (see `expandTask`).
  const eachAllowed = candidates.length === all.length;
  const eachStuck = all.length === 1 && !all[0].autoRepeat;
  const form = options.form ?? "either";
  if (form === "eachTarget" && !eachAllowed) {
    throw new Error("taskArb: form 'eachTarget' covers the cancel target, so it conflicts with includeCancel: false");
  }

  const list = fc
    .tuple(fc.integer({ min: 0, max: n - 1 }), fc.array(fc.nat(), { minLength: 0, maxLength: Math.max(0, maxLength - 1) }))
    .map(([first, rest]): TaskSpec => {
      const out = [candidates[first]];
      let prev = first;
      for (const raw of stuck ? [] : rest) {
        const span = candidates[prev].autoRepeat ? n : n - 1;
        // Offsets 1..span from prev; the extra offset n (back to prev) exists only for autoRepeat.
        const next = (prev + 1 + (raw % span)) % n;
        out.push(candidates[next]);
        prev = next;
      }
      return out.map((t) => t.id);
    });

  const each = fc
    .integer({ min: 1, max: Math.max(1, maxEach) })
    .map((count): TaskSpec => ({ eachTarget: eachStuck ? 1 : count }));

  if (form === "list") return list;
  if (form === "eachTarget") return each;
  return eachAllowed ? fc.oneof({ withCrossShrink: true }, list, each) : list;
}
