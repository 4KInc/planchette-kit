/**
 * sound-plan.ts: which tones to play for an event, inside fixed limits (design.md, `sound-plan.ts`).
 * Pure. A plan is either inside the limits or empty. Miss, Undo and Stop have no plan: they are silent.
 */
export const SOUND_LIMITS = { maxGain: 0.12, minFadeS: 0.02, maxToneS: 0.6, minGapS: 0.15 } as const;
export interface Tone {
  readonly freq: number;
  readonly startS: number;
  readonly durS: number;
  readonly gain: number;
}
export type SoundEvent = 'hit' | 'complete';
const GAIN = 0.08;
export function planSound(event: SoundEvent, lastToneEndS: number, nowS: number): Tone[] {
  if (nowS - lastToneEndS < SOUND_LIMITS.minGapS) return [];
  if (event === 'hit') return [{ freq: 392, startS: nowS, durS: 0.25, gain: GAIN }];
  return [
    { freq: 392, startS: nowS, durS: 0.3, gain: GAIN },
    { freq: 523.25, startS: nowS + 0.3 + SOUND_LIMITS.minGapS, durS: 0.3, gain: GAIN },
  ];
}
