/**
 * Fixed text templates of the suggestions (design section 8). Every suggestion sentence is built
 * here, so the phrases live in one file. Tests check `metric`, `targetId`, `users` and `value`,
 * not these sentences. Pure functions of their arguments.
 */

/** Phrase of the reading-pause rule. */
export const PHRASE_LONGER_DWELL = "longer dwell time";
/** Phrase of the tremor-at-edge rule. */
export const PHRASE_LARGER_TARGET = "larger target or more spacing";
/** Phrase of the unreachable rule. */
export const PHRASE_HIGHER_GAIN = "higher head gain";

function joinIds(ids: readonly string[]): string {
  return ids.join(", ");
}

/**
 * Reading-pause text. `pathTargets` lists the commonly used targets whose path passes `targetId`
 * (UTF-16 order); when it is not empty the path phrase is added to the same sentence.
 */
export function readingPauseText(targetId: string, share: number, pathTargets: readonly string[]): string {
  const base = `Target ${targetId}: ${percent(share)} of the selections on it happen during a reading pause. Try a ${PHRASE_LONGER_DWELL}`;
  if (pathTargets.length === 0) return `${base}.`;
  return `${base}, or move ${targetId} away from the path to ${joinIds(pathTargets)}.`;
}

export function tremorAtEdgeText(targetId: string, share: number): string {
  return `Target ${targetId}: ${percent(share)} of the events on it come from tremor at the target edge. Try a ${PHRASE_LARGER_TARGET}.`;
}

export function unreachableText(targetId: string): string {
  return `Target ${targetId} is outside the head range of the listed users. Try ${PHRASE_HIGHER_GAIN}, or move ${targetId}.`;
}

/**
 * Follow-up wording appended to a tremor-at-edge text: the multiple that removed the events on
 * the target and, when the larger rectangle overlaps other targets, "this size overlaps X".
 */
export function followUpText(factor: number, overlaps: readonly string[]): string {
  const base = `At ${factor} times the current size the simulated users had no accidental selections and no misses on it.`;
  if (overlaps.length === 0) return base;
  return `${base} Note: this size overlaps ${joinIds(overlaps)}.`;
}

function percent(share: number): string {
  return `${Math.round(share * 100)} %`;
}

/** Centre-hit text: the screen centre lies inside a selectable target. */
export function centreHitText(targetId: string): string {
  return `The screen centre lies inside target "${targetId}". Keep the centre empty or put the rest area there.`;
}
