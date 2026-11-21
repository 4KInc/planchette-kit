import type { Profile, Rect, ScreenSize, TargetRole } from "@planchette/skeleton";

export interface Point {
  x: number;
  y: number;
}

export interface Pose {
  yaw: number;
  pitch: number;
}

export interface LayoutTarget {
  id: string;
  rect: Rect;
  autoRepeat: boolean;
  role: TargetRole;
}

export interface Layout {
  screen: ScreenSize;
  targets: LayoutTarget[];
}

export type Activity = "waiting" | "moving" | "reading pause" | "holding on the aim point";

/** 'start' is not an accidental cause: start-of-session events are their own category. */
export type AccidentalCause =
  | "reading-pause"
  | "pass-over"
  | "tremor-at-edge"
  | "repeat"
  | "waiting"
  | "early-on-intended-target"
  | "other";

export type TaskSpec = readonly string[] | { eachTarget: number };

export interface RawEvent {
  kind: "select" | "cancel";
  targetId?: string;
  now: number;
}

/** Flat parameter values of one simulated user. */
export interface UserParams {
  throughputBitsPerS: number;
  tremorFrequencyHz: number;
  tremorPeakToPeakDeg: number;
  tremorAxis: "yaw" | "pitch";
  /** Not customisable. */
  tremorDriftFraction: number;
  headRangeDeg: { left: number; right: number; up: number; down: number };
  reactionTimeMs: number;
  readingPauseChancePct: number;
  readingPauseLengthMs: { min: number; max: number };
  /** Peak, uniform in [-n, +n] per axis. */
  trackingNoiseDeg: number;
  scatterCapDeg: number;
  /** Shared, not customisable. */
  scanReactionTimeMs: number;
  /** Shared, not customisable. */
  scanLatePressChancePct: number;
  /** Shared, not customisable. */
  scanPressDurationMs: number;
}

export interface ResolvedUser {
  name: string;
  /** Stable hash of the user, used in draw keys. */
  key: number;
  params: UserParams;
}

export interface SimulateRequest {
  layout: Layout;
  profile: Partial<Profile>;
  mode: "head + dwell" | "scan";
  users: ResolvedUser[];
  task: TaskSpec;
  trialsPerUser: number;
  fps: 15 | 30 | 60;
  analysisWindowS: number;
  seed: number;
}
