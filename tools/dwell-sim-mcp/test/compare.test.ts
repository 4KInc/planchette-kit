import { describe, expect, it } from "vitest";
import { checkSameTargetIds, compare, COMPARE_STATEMENT, type CompareRequest } from "../src/compare.js";
import { DISCLAIMER } from "../src/disclaimer.js";
import { resolveUser } from "../src/resolve-user.js";
import { SimulateError } from "../src/simulate.js";
import type { Layout, LayoutTarget, ResolvedUser } from "../src/types.js";

const target = (id: string, x: number, y: number, role: LayoutTarget["role"] = "default"): LayoutTarget => ({
  id,
  rect: { x, y, width: 160, height: 120 },
  autoRepeat: false,
  role,
});

const user = (input: Parameters<typeof resolveUser>[0]): ResolvedUser => {
  const r = resolveUser(input);
  if (!r.ok) throw new Error("user must resolve");
  return r.user;
};

const layout: Layout = {
  screen: { width: 800, height: 600 },
  targets: [target("rest", 620, 460, "rest-area"), target("cancel", 330, 460, "cancel"), target("a", 60, 60), target("b", 560, 60)],
};

const request = (over: Partial<CompareRequest> = {}): CompareRequest => ({
  a: { layout, profile: { dwellTime: 400 } },
  b: { profile: { dwellTime: 400 } },
  mode: "head + dwell",
  users: [user("steady"), user("head-tremor")],
  task: ["a", "b"],
  trialsPerUser: 2,
  fps: 30,
  analysisWindowS: 5,
  seed: 7,
  ...over,
});

const sorted = (o: object): string[] => Object.keys(o).sort();

describe("compare", () => {
  it("gives all ties for identical configurations", () => {
    const r = compare(request());
    for (const m of [r.metrics.accidental, r.metrics.misses, r.metrics.timeToSelect]) {
      expect(m.aWins).toBe(0);
      expect(m.bWins).toBe(0);
      expect(m.verdict).toBe("tie");
    }
    expect(r.metrics.accidental.ties).toBe(r.pairs.length);
    for (const p of r.pairs) expect(p.a).toEqual(p.b);
  });

  it("gives different results when the dwell time differs", () => {
    const same = compare(request());
    const diff = compare(request({ b: { profile: { dwellTime: 1500 } } }));
    expect(diff.pairs).not.toEqual(same.pairs);
    expect(diff.metrics.timeToSelect.ties).toBeLessThan(same.metrics.timeToSelect.ties);
    expect(diff.parameters.b.profile).toEqual({ dwellTime: 1500 });
    expect(diff.parameters.b.effectiveProfiles[0].effectiveProfile.dwellTime).toBe(1500);
    expect(diff.parameters.a.effectiveProfiles[0].effectiveProfile.dwellTime).toBe(400);
  });

  it("is deterministic and has no extra fields", () => {
    const r = compare(request());
    expect(compare(request())).toEqual(r);
    expect(sorted(r)).toEqual(["disclaimer", "metrics", "notes", "pairs", "parameters", "seed", "statement", "warnings"]);
    expect(sorted(r.parameters)).toEqual(["a", "b", "shared"]);
    expect(sorted(r.parameters.shared)).toEqual(["analysisWindowS", "fps", "mode", "task", "trialsPerUser", "users"]);
    expect(sorted(r.parameters.a)).toEqual(["effectiveProfiles", "layout", "profile"]);
    expect(r.disclaimer).toBe(DISCLAIMER);
    expect(r).not.toHaveProperty("users");
    expect(r).not.toHaveProperty("accidentalSelections");
    expect(r).not.toHaveProperty("suggestions");
  });

  it("carries the statement", () => {
    expect(compare(request()).statement).toBe("These counts are not a test of statistical significance.");
    expect(COMPARE_STATEMENT).toBe("These counts are not a test of statistical significance.");
  });

  it("lists pairs per user and trial, users in request order", () => {
    const r = compare(request());
    expect(r.pairs.map((p) => [p.user, p.trial])).toEqual([
      ["steady", 0],
      ["steady", 1],
      ["head-tremor", 0],
      ["head-tremor", 1],
    ]);
    expect(r.parameters.shared.users.map((u) => u.name)).toEqual(["steady", "head-tremor"]);
    expect(r.parameters.a.effectiveProfiles.map((e) => e.user)).toEqual(["steady", "head-tremor"]);
  });

  it("echoes b's layout as a's when none is given", () => {
    const r = compare(request());
    expect(r.parameters.b.layout).toEqual(layout);
    expect(r.parameters.a.layout).toEqual(layout);
    expect(r.parameters.a.layout).not.toBe(layout);
  });

  it("echoes labels and keeps the verdict strings fixed", () => {
    const r = compare(request({ a: { layout, label: "big" }, b: { label: "small" } }));
    expect(r.parameters.a.label).toBe("big");
    expect(r.parameters.b.label).toBe("small");
    expect(r.metrics.accidental.verdict).toBe("tie");
    const none = compare(request());
    expect(none.parameters.a).not.toHaveProperty("label");
    expect(none.parameters.b).not.toHaveProperty("label");
  });

  it("throws UNSUPPORTED_MODE for scan", () => {
    try {
      compare(request({ mode: "scan" }));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SimulateError);
      expect((e as SimulateError).code).toBe("UNSUPPORTED_MODE");
    }
  });

  it("throws LAYOUT_MISMATCH for different id sets", () => {
    const other: Layout = { ...layout, targets: [...layout.targets.slice(0, 3), target("z", 560, 60)] };
    try {
      compare(request({ b: { layout: other } }));
      expect.unreachable();
    } catch (e) {
      expect((e as SimulateError).code).toBe("LAYOUT_MISMATCH");
      expect((e as SimulateError).message).toContain("b, z");
    }
  });

  it("merges warnings with A: / B: prefixes and one unprefixed copy when identical", () => {
    // Both layouts lack a rest area (identical warning). Only A lacks a cancel target.
    const noRestWithCancel: Layout = { ...layout, targets: layout.targets.filter((t) => t.id !== "rest") };
    const noRestNoCancel: Layout = { ...layout, targets: layout.targets.filter((t) => t.id !== "rest").map((t) => (t.role === "cancel" ? { ...t, role: "default" as const } : t)) };
    const r = compare(request({ a: { layout: noRestNoCancel }, b: { layout: noRestWithCancel } }));
    const rest = r.warnings.filter((w) => w.includes("NO_REST_AREA"));
    expect(rest).toHaveLength(1);
    expect(rest[0].startsWith("NO_REST_AREA")).toBe(true);
    const cancel = r.warnings.filter((w) => w.includes("NO_CANCEL_TARGET"));
    expect(cancel).toHaveLength(1);
    expect(cancel[0].startsWith("A: NO_CANCEL_TARGET")).toBe(true);

    const swapped = compare(request({ a: { layout: noRestWithCancel }, b: { layout: noRestNoCancel } }));
    expect(swapped.warnings.filter((w) => w.startsWith("B: NO_CANCEL_TARGET"))).toHaveLength(1);
  });

  it("prefixes notes that differ between sides", () => {
    const r = compare(request());
    expect(r.notes.every((n) => !n.startsWith("A: ") && !n.startsWith("B: "))).toBe(true);
    expect(r.notes.length).toBe(r.notes.filter((n) => n.includes("TREMOR_ABOVE_TUNED")).length);
  });
});

describe("checkSameTargetIds", () => {
  const withIds = (...ids: string[]): Layout => ({ screen: layout.screen, targets: ids.map((id) => target(id, 0, 0)) });

  it("returns null for equal id sets, whatever the rects and order", () => {
    const moved: Layout = { screen: layout.screen, targets: [target("b", 1, 1), target("a", 2, 2)] };
    expect(checkSameTargetIds(withIds("a", "b"), moved)).toBeNull();
  });

  it("lists the sorted symmetric difference joined with ', '", () => {
    const e = checkSameTargetIds(withIds("a", "z", "m", "common"), withIds("common", "b", "Y", "a"));
    expect(e).toBeInstanceOf(SimulateError);
    expect(e?.code).toBe("LAYOUT_MISMATCH");
    expect(e?.message).toBe("The two layouts must have the same target ids; differing: Y, b, m, z.");
  });
});
