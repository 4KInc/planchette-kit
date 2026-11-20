/**
 * targets.ts — target types shared by the dwell and scan engines.
 * Types only. No dependencies.
 */

/** A rectangle in CSS px. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TargetRole = 'default' | 'cancel' | 'undo' | 'rest-area';

export interface DwellTarget {
  id: string;
  rect: Rect;
  autoRepeat: boolean;
  role: TargetRole;
}
