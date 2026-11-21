import { describe, expect, it } from "vitest";
import { hash32, Purpose, stream, u01 } from "../src/rng.js";

describe("rng", () => {
  it("hash32 gives the pinned outputs for fixed keys", () => {
    expect(hash32()).toBe(2166136261);
    expect(hash32(0)).toBe(164558732);
    expect(hash32(1)).toBe(675239238);
    expect(hash32(1, 2, 3)).toBe(836928418);
    expect(hash32(-1)).toBe(3880164170);
  });

  it("stream and u01 give the pinned outputs for a fixed key", () => {
    const s = stream(1, 2, 3, Purpose.Aim);
    expect(s.seed).toBe(846354067);
    expect(u01(s, 0, 0)).toBe(0.5336615264944768);
    expect(u01(s, 0, 1)).toBe(0.5517429570400685);
    expect(u01(s, 5, 0)).toBe(0.9023140795476041);
  });

  it("u01 defaults j to 0", () => {
    const s = stream(7, 8, 9, Purpose.Reaction);
    expect(u01(s, 4)).toBe(u01(s, 4, 0));
  });

  it("u01 stays in [0, 1) over a run of counters", () => {
    const s = stream(1, 1, 0, Purpose.TrackingNoise);
    for (let k = 0; k < 2000; k++) {
      const v = u01(s, k, k & 1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("a different key gives a different draw", () => {
    const s = stream(1, 2, 3, Purpose.Aim);
    const base = u01(s, 0, 0);
    expect(u01(s, 1, 0)).not.toBe(base);
    expect(u01(s, 0, 1)).not.toBe(base);
    expect(u01(stream(2, 2, 3, Purpose.Aim), 0, 0)).not.toBe(base);
    expect(u01(stream(1, 3, 3, Purpose.Aim), 0, 0)).not.toBe(base);
    expect(u01(stream(1, 2, 4, Purpose.Aim), 0, 0)).not.toBe(base);
    expect(u01(stream(1, 2, 3, Purpose.Reaction), 0, 0)).not.toBe(base);
  });
});
