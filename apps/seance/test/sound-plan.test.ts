import { describe, expect, it } from 'vitest';
import { SOUND_LIMITS, planSound } from '../src/sound-plan';
describe('sound-plan', () => {
  it('a Hit is one soft tone', () => {
    expect(planSound('hit', -Infinity, 1)).toEqual([{ freq: 392, startS: 1, durS: 0.25, gain: 0.08 }]);
  });
  it('a completed Round is two tones, the second after the first plus the minimum gap', () => {
    const t = planSound('complete', 0, 5);
    expect(t).toHaveLength(2);
    expect(t[1]!.startS).toBeCloseTo(5 + 0.3 + SOUND_LIMITS.minGapS, 10);
  });
  it('is empty when the last tone ended less than the minimum gap ago', () => {
    expect(planSound('hit', 1, 1.1)).toEqual([]);
    expect(planSound('hit', 1, 1.2).length).toBe(1);
  });
});
