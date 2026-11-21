// Presets of requirements.md as data. Every parameter carries a figure source or a chosen reason.

import type { ParamSource, Sourced } from "./figures.js";
import type { UserParams } from "./types.js";

export type { UserParams } from "./types.js";

export type SourcedParams = { [K in keyof UserParams]: Sourced<UserParams[K]> };

export const PRESET_NAMES = [
  "steady",
  "slow",
  "head-tremor",
  "strong-head-tremor",
  "small-range",
  "reads-while-pointing",
] as const;

export type PresetName = (typeof PRESET_NAMES)[number];

export interface PresetDefinition {
  name: PresetName;
  description: string;
  params: SourcedParams;
}

function sourced<T>(value: T, source: ParamSource): Sourced<T> {
  return { value, source };
}

const chosen = (reason: string): ParamSource => ({ kind: "chosen", reason });

const NO_TREMOR = "chosen: no tremor";
const AXIS_REASON =
  "chosen: [8] measured the single principal axis of head tremor, so applying the full size to both axes would overstate it";
const RANGE_15 = "chosen: our own default calibration constant, not a published human range";
const NO_PAUSES = "chosen: no reading pauses";
const NO_NOISE =
  "chosen: not measured yet; input-core Task 14.9 will measure it from our own face clip and replace it";
const PAIRING_NOTE = "chosen pairing: one shared base (0.90 bits/s, without motor impairments), so each preset differs in one feature";

function headRange(deg: number): UserParams["headRangeDeg"] {
  return { left: deg, right: deg, up: deg, down: deg };
}

/** Parameters shared by every preset. */
function shared(): Pick<
  SourcedParams,
  | "tremorDriftFraction"
  | "reactionTimeMs"
  | "scatterCapDeg"
  | "trackingNoiseDeg"
  | "scanReactionTimeMs"
  | "scanLatePressChancePct"
  | "scanPressDurationMs"
> {
  return {
    tremorDriftFraction: sourced(
      0.2,
      chosen(
        "random walk keeping the size within ±20 % of nominal, changing over about 5 s; tremor size varies slowly in real recordings, but [8] gives no figure",
      ),
    ),
    reactionTimeMs: sourced(
      500,
      chosen("a choice reaction time for a user who has to pick the next target"),
    ),
    scatterCapDeg: sourced(0.6, {
      kind: "figure",
      row: "head-we-hmd",
      ref: 3,
      note: "derived: SD = We / 4.133 = 2.5 / 4.133 = 0.6 degrees",
    }),
    trackingNoiseDeg: sourced(0, chosen(NO_NOISE)),
    scanReactionTimeMs: sourced(500, chosen("same as reaction time")),
    scanLatePressChancePct: sourced(
      10,
      chosen("one item late, to exercise scan interval settings"),
    ),
    scanPressDurationMs: sourced(
      150,
      chosen("must be below cancelHoldTime (minimum 1000 ms)"),
    ),
  };
}

const NO_TREMOR_PARAMS: Pick<
  SourcedParams,
  "tremorFrequencyHz" | "tremorPeakToPeakDeg" | "tremorAxis"
> = {
  tremorFrequencyHz: sourced(0, chosen(NO_TREMOR)),
  tremorPeakToPeakDeg: sourced(0, chosen(NO_TREMOR)),
  tremorAxis: sourced("yaw" as const, chosen(AXIS_REASON)),
};

const NO_PAUSE_PARAMS: Pick<SourcedParams, "readingPauseChancePct" | "readingPauseLengthMs"> = {
  readingPauseChancePct: sourced(0, chosen(NO_PAUSES)),
  readingPauseLengthMs: sourced({ min: 0, max: 0 }, chosen(NO_PAUSES)),
};

function pairedThroughput(): Sourced<number> {
  return sourced(0.9, { kind: "figure", row: "head-tp-phone", ref: 4, note: PAIRING_NOTE });
}

function etTremor(
  peakToPeak: Sourced<number>,
): Pick<SourcedParams, "tremorFrequencyHz" | "tremorPeakToPeakDeg" | "tremorAxis"> {
  return {
    tremorFrequencyHz: sourced(4.25, { kind: "figure", row: "head-tremor-et", ref: 8 }),
    tremorPeakToPeakDeg: peakToPeak,
    tremorAxis: sourced("yaw" as const, chosen(AXIS_REASON)),
  };
}

export const PRESETS: Readonly<Record<PresetName, PresetDefinition>> = {
  steady: {
    name: "steady",
    description: "Steady head pointing at the mobile head-tracker throughput, no tremor, no reading pauses.",
    params: {
      throughputBitsPerS: sourced(1.42, { kind: "figure", row: "head-tp-mobile", ref: 5 }),
      ...NO_TREMOR_PARAMS,
      headRangeDeg: sourced(headRange(15), chosen(RANGE_15)),
      ...NO_PAUSE_PARAMS,
      ...shared(),
    },
  },
  slow: {
    name: "slow",
    description: "Slow head pointing at the throughput of people with motor impairments, no tremor.",
    params: {
      throughputBitsPerS: sourced(0.61, { kind: "figure", row: "head-tp-phone", ref: 4 }),
      ...NO_TREMOR_PARAMS,
      headRangeDeg: sourced(headRange(15), chosen(RANGE_15)),
      ...NO_PAUSE_PARAMS,
      ...shared(),
    },
  },
  "head-tremor": {
    name: "head-tremor",
    description: "Head tremor at the essential-tremor mean (4.25 Hz, 0.46° peak to peak, yaw).",
    params: {
      throughputBitsPerS: pairedThroughput(),
      ...etTremor(sourced(0.46, { kind: "figure", row: "head-tremor-deg", ref: 8 })),
      headRangeDeg: sourced(headRange(15), chosen(RANGE_15)),
      ...NO_PAUSE_PARAMS,
      ...shared(),
    },
  },
  "strong-head-tremor": {
    name: "strong-head-tremor",
    description: "Head tremor at the essential-tremor mean plus 2 SD (4.25 Hz, 1.6° peak to peak, yaw).",
    params: {
      throughputBitsPerS: pairedThroughput(),
      ...etTremor(
        sourced(1.6, chosen("ET mean + 2 SD; the SD exceeds the mean, so this is not a percentile (see head-tremor-deg row, [8])")),
      ),
      headRangeDeg: sourced(headRange(15), chosen(RANGE_15)),
      ...NO_PAUSE_PARAMS,
      ...shared(),
    },
  },
  "small-range": {
    name: "small-range",
    description: "Small head range (±3°, the smallest range input-core supports), no tremor.",
    params: {
      throughputBitsPerS: pairedThroughput(),
      ...NO_TREMOR_PARAMS,
      headRangeDeg: sourced(
        headRange(3),
        chosen("input-core minimum supported head range (MIN_RANGE), see the min-head-range row"),
      ),
      ...NO_PAUSE_PARAMS,
      ...shared(),
    },
  },
  "reads-while-pointing": {
    name: "reads-while-pointing",
    description: "Stops on targets it does not intend to select: 30 % chance per passed target, 300–900 ms.",
    params: {
      throughputBitsPerS: pairedThroughput(),
      ...NO_TREMOR_PARAMS,
      headRangeDeg: sourced(headRange(15), chosen(RANGE_15)),
      readingPauseChancePct: sourced(
        30,
        chosen(
          "30 % chance per passed target; the low end of the length is below the 400 ms minimum dwell and the high end is below the 1000 ms default, so it exercises dwell settings",
        ),
      ),
      readingPauseLengthMs: sourced(
        { min: 300, max: 900 },
        chosen("300–900 ms uniform; below the 400 ms minimum dwell at the low end and below the 1000 ms default at the high end"),
      ),
      ...shared(),
    },
  },
};
