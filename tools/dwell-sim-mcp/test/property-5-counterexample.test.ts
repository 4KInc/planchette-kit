import { describe, expect, it } from "vitest";
import type { Profile } from "@planchette/skeleton";
import { resolveUser } from "../src/resolve-user.js";
import { openTrial, runEntries, runStartOfSession, runWarmup, type TrialConfig } from "../src/run-trial.js";
import type { Layout } from "../src/types.js";

/**
 * The counterexample found for Property 5 when the samples were compared up to the frame AFTER the cut-off
 * frame, pinned as an example (preset `small-range`, 993 x 480, 15 fps, task [t1, t0], two autoRepeat targets).
 *
 * A (smoothingStrength 0) selects t1 at 8466.67; B (smoothingStrength 0.5) selects t1 at 8600. The first
 * differing event is therefore at 8466.67 (frame 127). The samples are equal for every frame with
 * now <= 8466.67 (frames 0..127), the cut-off frame inclusive. Frame 128 (now 8533.33) differs: in A the
 * select at 8466.67 resolved entry 0 before its move ended, so entry 1 has started and A holds at
 * basePose(plan 0, 8466.67); B is still on plan 0's move. The cut-off frame is fed before its event exists,
 * so only the frames after it can differ (design section 5, section 9).
 *
 * **Validates: Requirements 5.1, 5.7**
 */

const layout: Layout = {
  screen: { width: 993, height: 480 },
  targets: [
    { id: "t0", rect: { x: 853, y: 326, width: 41, height: 40 }, autoRepeat: true, role: "default" },
    { id: "t1", rect: { x: 946, y: 2, width: 42, height: 234 }, autoRepeat: true, role: "default" },
    { id: "rest", rect: { x: 183, y: 328, width: 40, height: 83 }, autoRepeat: false, role: "rest-area" },
  ],
};

const user = (() => {
  const r = resolveUser("small-range");
  if (!r.ok) throw new Error("small-range preset must resolve");
  return r.user;
})();

const base: Partial<Profile> = {
  headGain: 1,
  headDeadZone: 0,
  dwellTime: 400,
  graceTime: 0,
  postSelectionPause: 200,
  autoRepeatInterval: 1000,
};

interface Rec {
  samples: { now: number; yaw: number; pitch: number; phase: string }[];
  events: { kind: string; targetId: string | undefined; now: number }[];
}

function run(smoothingStrength: number): Rec {
  const rec: Rec = { samples: [], events: [] };
  const cfg: TrialConfig = {
    layout,
    profile: { ...base, smoothingStrength },
    user,
    mode: "head + dwell",
    task: ["t1", "t0"],
    fps: 15,
    analysisWindowMs: 3164,
    requestSeed: -1000062012,
    trialIndex: 2,
    observers: {
      onSample(now, rotation, phase) {
        rec.samples.push({ now, yaw: rotation.yaw, pitch: rotation.pitch, phase });
      },
      onEvent(e) {
        rec.events.push({ kind: e.kind, targetId: e.targetId, now: e.now });
      },
    },
  };
  const d = openTrial(cfg);
  try {
    runWarmup(d);
    const s = runStartOfSession(d);
    runEntries(d, s);
  } finally {
    d.pl.destroy();
  }
  return rec;
}

describe("Property 5: the known counterexample (named example)", () => {
  const a = run(0);
  const b = run(0.5);
  const cutNow = 8466.67;

  it("A's first event is select t1 at 8466.67 and B's is select t1 at 8600", () => {
    expect(a.events[0].kind).toBe("select");
    expect(a.events[0].targetId).toBe("t1");
    expect(Math.abs(a.events[0].now - 8466.67)).toBeLessThan(1e-6 + 0.01);
    expect(b.events[0].kind).toBe("select");
    expect(b.events[0].targetId).toBe("t1");
    expect(Math.abs(b.events[0].now - 8600)).toBeLessThan(1e-6);
  });

  it("samples are equal for frames 0..127 (now <= 8466.67) and differ at frame 128 (now 8533.33)", () => {
    const limit = a.events[0].now;
    expect(Math.abs(limit - cutNow)).toBeLessThan(0.01);
    const frameMs = 1000 / 15;
    for (let j = 0; j <= 127; j++) {
      expect(a.samples[j].now, `frame ${j}`).toBeLessThanOrEqual(limit + 1e-6);
      expect(b.samples[j], `frame ${j}`).toEqual(a.samples[j]);
    }
    expect(a.samples[127].now).toBeCloseTo(127 * frameMs, 6);
    // Frame 128: A has started entry 1 and holds at basePose(plan0, 8466.67); B is still on plan 0's move.
    expect(a.samples[128].now).toBeCloseTo(8533.33, 2);
    expect(b.samples[128].now).toBe(a.samples[128].now);
    const same = a.samples[128].yaw === b.samples[128].yaw && a.samples[128].pitch === b.samples[128].pitch;
    expect(same).toBe(false);
  });
});
