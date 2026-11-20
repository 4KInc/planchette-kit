/**
 * The public API of the skeleton (design §6). This file is the package's only entry
 * point: anything not exported here is private and may change.
 *
 * It does nothing when imported: the only runtime export is the factory function.
 */
import type { Planchette, PlanchetteOptions } from './api-types.js';
import { createPlanchetteInternal } from './planchette.js';

export type {
  CalibrationResult,
  CalibrationStep,
  DetectedFace,
  GestureScores,
  ImportResult,
  InputMode,
  Planchette,
  PlanchetteEventMap,
  PlanchetteEventType,
  PlanchetteOptions,
  Profile,
  Rect,
  SampleSource,
  ScanHighlightKind,
  ScreenSize,
  SelectSource,
  TargetInfo,
  TargetOptions,
  TargetRole,
  TimestampedSample,
  TrackingStatus,
} from './api-types.js';

/** Create a Planchette instance. There is no module-level state: each call is independent. */
export function createPlanchette(options: PlanchetteOptions): Planchette {
  return createPlanchetteInternal(options).planchette;
}
