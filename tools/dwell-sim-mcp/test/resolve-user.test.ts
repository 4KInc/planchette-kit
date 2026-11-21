import { describe, expect, it } from "vitest";
import { CUSTOM_RANGES } from "../src/custom-ranges.js";
import { PRESET_NAMES } from "../src/presets.js";
import { hashString, presetParams, resolveUser } from "../src/resolve-user.js";

function ok(input: Parameters<typeof resolveUser>[0]) {
  const r = resolveUser(input);
  if (!r.ok) throw new Error(r.error.message);
  return r.user;
}

describe("resolveUser", () => {
  it("resolves every preset name to its parameters and name hash", () => {
    for (const name of PRESET_NAMES) {
      const u = ok(name);
      expect(u.name).toBe(name);
      expect(u.key).toBe(hashString(name));
      expect(u.params).toEqual(presetParams(name));
    }
  });

  it("gives distinct keys to the presets", () => {
    const keys = new Set(PRESET_NAMES.map((n) => ok(n).key));
    expect(keys.size).toBe(PRESET_NAMES.length);
  });

  it("overrides replace only the named fields", () => {
    const base = presetParams("slow");
    const u = ok({
      name: "mine",
      base: "slow",
      overrides: { reactionTimeMs: 700, headRangeDeg: { left: 20 } },
    });
    expect(u.params).toEqual({
      ...base,
      reactionTimeMs: 700,
      headRangeDeg: { ...base.headRangeDeg, left: 20 },
    });
  });

  it("defaults the base to steady", () => {
    expect(ok({ name: "x" }).params).toEqual(presetParams("steady"));
  });

  it("accepts range boundaries", () => {
    const r = CUSTOM_RANGES.throughputBitsPerS;
    expect(resolveUser({ name: "lo", overrides: { throughputBitsPerS: r.min } }).ok).toBe(true);
    expect(resolveUser({ name: "hi", overrides: { throughputBitsPerS: r.max } }).ok).toBe(true);
  });

  it("reports an unknown preset name", () => {
    const r = resolveUser("sleepy");
    expect(r).toMatchObject({ ok: false, error: { code: "UNKNOWN_PRESET", parameter: "sleepy" } });
    const b = resolveUser({ name: "x", base: "nope" });
    expect(b).toMatchObject({ ok: false, error: { code: "UNKNOWN_PRESET", parameter: "base", value: "nope" } });
  });

  it("reports an out-of-range override with the parameter name and range", () => {
    const r = resolveUser({ name: "x", overrides: { reactionTimeMs: 50 } });
    expect(r).toMatchObject({
      ok: false,
      error: { code: "OUT_OF_RANGE", parameter: "reactionTimeMs", value: 50, min: 150, max: 1500, unit: "ms" },
    });
  });

  it("reports nested out-of-range paths", () => {
    const r = resolveUser({ name: "x", overrides: { headRangeDeg: { up: 61 } } });
    expect(r).toMatchObject({ ok: false, error: { parameter: "headRangeDeg.up", min: 3, max: 60 } });
    const p = resolveUser({ name: "x", overrides: { readingPauseLengthMs: { min: 900, max: 300 } } });
    expect(p).toMatchObject({ ok: false, error: { code: "OUT_OF_RANGE", parameter: "readingPauseLengthMs.min" } });
  });

  it("rejects unknown and non-customisable parameters and bad values", () => {
    const bad = (o: object) => resolveUser({ name: "x", overrides: o as never });
    expect(bad({ scanPressDurationMs: 100 })).toMatchObject({ ok: false, error: { code: "UNKNOWN_PARAMETER" } });
    expect(bad({ tremorDriftFraction: 0.1 })).toMatchObject({ ok: false, error: { code: "UNKNOWN_PARAMETER" } });
    expect(bad({ scatterCapDeg: Number.NaN })).toMatchObject({ ok: false, error: { code: "INVALID_VALUE" } });
    expect(bad({ tremorAxis: "roll" })).toMatchObject({ ok: false, error: { code: "INVALID_VALUE" } });
  });

  it("identical users give identical keys; different overrides or names differ", () => {
    const a = ok({ name: "u", overrides: { scatterCapDeg: 1, reactionTimeMs: 600 } });
    const b = ok({ name: "u", overrides: { reactionTimeMs: 600, scatterCapDeg: 1 } });
    expect(a.key).toBe(b.key);
    expect(ok({ name: "u", overrides: { scatterCapDeg: 1.1 } }).key).not.toBe(a.key);
    expect(ok({ name: "v", overrides: { scatterCapDeg: 1, reactionTimeMs: 600 } }).key).not.toBe(a.key);
  });
});
