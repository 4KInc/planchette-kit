// Allowed ranges for custom simulated users ("Custom ranges" in requirements.md).

export type CustomParamName =
  | "throughputBitsPerS"
  | "tremorFrequencyHz"
  | "tremorPeakToPeakDeg"
  | "headRangeDeg"
  | "reactionTimeMs"
  | "readingPauseChancePct"
  | "readingPauseLengthMs"
  | "scatterCapDeg"
  | "trackingNoiseDeg"
  | "analysisWindowS";

export interface CustomRange {
  /** Name of the parameter in a custom user (or in the request, for the analysis window). */
  path: string;
  min: number;
  max: number;
  unit: string;
}

export const CUSTOM_RANGES: Readonly<Record<CustomParamName, CustomRange>> = {
  throughputBitsPerS: { path: "throughputBitsPerS", min: 0.3, max: 4, unit: "bits/s" },
  tremorFrequencyHz: { path: "tremorFrequencyHz", min: 0, max: 15, unit: "Hz" },
  tremorPeakToPeakDeg: { path: "tremorPeakToPeakDeg", min: 0, max: 5, unit: "degrees peak to peak" },
  headRangeDeg: { path: "headRangeDeg", min: 3, max: 60, unit: "degrees per direction" },
  reactionTimeMs: { path: "reactionTimeMs", min: 150, max: 1500, unit: "ms" },
  readingPauseChancePct: { path: "readingPauseChancePct", min: 0, max: 100, unit: "%" },
  readingPauseLengthMs: { path: "readingPauseLengthMs", min: 0, max: 3000, unit: "ms" },
  scatterCapDeg: { path: "scatterCapDeg", min: 0.1, max: 3, unit: "degrees" },
  trackingNoiseDeg: { path: "trackingNoiseDeg", min: 0, max: 2, unit: "degrees" },
  analysisWindowS: { path: "analysisWindowS", min: 2, max: 120, unit: "s" },
};

/** UserParams keys that a custom user may not override (no range is listed for them). */
export const NON_CUSTOMISABLE_PARAMS = [
  "tremorDriftFraction",
  "scanReactionTimeMs",
  "scanLatePressChancePct",
  "scanPressDurationMs",
] as const;

/** Enumerated parameter: overridable, but has no numeric range. */
export const ENUM_PARAMS = ["tremorAxis"] as const;
