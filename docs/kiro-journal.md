# Kiro Journal

## 19 Nov 2026

### What Kiro did

Reviewed four steering files (product, tech, structure, accessibility) against the
existing repo. Wrote requirements.md for the input-core spec, working from
`docs/drafts/input-core-requirements.md`. Went through several rounds of design,
then wrote the task list.

---

### Steering review

The steering files were missing several things that would have caused guessing during
implementation: no definition of the Profile type or its fields, no public API shape,
no description of the dwell simulator's MCP interface, no game design for App B, no
versioning or deployment strategy, and no camera-failure handling. The review session
produced seven concrete decisions that were written back into the files, including the
Vite multi-page build serving all three pages from one URL, the `fC_min`/`beta`
parameter formulas living in `tech.md` until the input-core spec existed, and the
camera-failure rule (every mode except head pointing works without a camera).

---

### Requirements: what changed from the draft

The draft had 8 requirements, 20 properties and 25 profile fields.

**New requirement (Req 8): camera and tracking failures.** The draft had no
requirement for what happens when `getUserMedia` is denied, MediaPipe fails to load,
or no face is detected. Added three distinct failure cases, each with a plain-language
message, a `tracking-status` event with a typed reason, and an offer of alternative
modes. Added the `noFaceTimeout` profile field (default 10 s, range 3–60 s) and
property P21 (scanning and mouse still produce selections with the camera unavailable).

**Requirement 2 AC 4 revised (smoothing presets).** The original single smoothing
target — tremor < 8 px AND lag < 150 ms — was split across two presets after the
design showed they conflict. See design section below.

**Requirement 7 AC 1–2 revised (four calibration ranges).** The draft recorded one
symmetric half-angle `R`. Changed to four independent values (`rangeLeft`,
`rangeRight`, `rangeUp`, `rangeDown`) because real users have asymmetric ranges.
Added tremor measurement during hold-still steps and the `suggestHighTremor` flag.

**Requirement 7 AC 5 revised (clamping order).** Calibration ranges and dead zone
added to the clamping order: ranges first, then dead zone (clamped to at most half
the smallest range), then the existing chain.

**Profile field count.** The draft had 25 fields. After the camera-failure requirement
added `noFaceTimeout` (26), and the design added four separate calibration range fields
replacing the implicit single range (net +3 → 29), and one additional field surfaced
in a recount (30 total). The count was stated incorrectly as 25 → 26 → 29 → 30 across
three separate corrections. The final count is 30 and is verified by a test in task 2.6
that enumerates `defaultProfile`'s keys.

---

### Design rounds

**Round 1.** First design made three significant errors:

1. The One Euro filter was placed after the dead zone on pixel coordinates. Corrected
   to run on raw centred angles in degrees, before the dead zone, so the filter always
   sees smooth physical input and is independent of screen resolution.

2. The tremor analysis claimed "with the dead zone, residual < 8 px." The numbers in
   the same paragraph showed residual ≈ 48 px from the filter alone, then stated the
   dead zone "provides the remaining suppression." The dead zone only acts at the
   neutral position and has no effect on tremor occurring off-centre. The claim was
   wrong.

3. The face-lock re-acquire rule said the engine waits for the locked face to return
   within `LOCK_THRESHOLD = 0.15` before re-locking. Requirement 2 AC 9 says re-lock
   the closest face; there is no threshold on re-acquire.

**Round 2 (smoothing presets).** Working through the One Euro attenuation in angle
space honestly: at the reference calibration, 1° tremor at 4 Hz through a 0.9 Hz
low-pass gives residual ≈ 0.22° ≈ 14 px — above the 8 px target. T1 (tremor) and T2
(lag) cannot both be met at a single smoothing strength. Resolution: two presets.
Default `s = 0.5` meets T2 (90 % distance in ≤ 150 ms). High-tremor `s = 0.9` meets
T1 (< 8 px at 4–12 Hz). The tuning test sets the final parameter values; the design
contains estimates only. Calibration measures tremor std-dev during hold-still steps
and sets `suggestHighTremor: true` when it exceeds 0.5°, so the UI can offer the
preset to the person.

**Round 3 (four calibration ranges, dead zone constraint, face-lock, gesture
freeze).** Calibration ranges became asymmetric (four values). Dead zone gained a
constraint: `D ≤ 0.5 × min(R_left, R_right, R_up, R_down)`, enforced by
`clampProfile`, so screen edges remain reachable. Face-lock rule corrected per above.
Gesture freeze start moved from gesture threshold crossing to release threshold
crossing, capturing the pointer position before head movement distorts it; added
expiry (gesture must reach the gesture threshold within `gestureAcceptanceTime +
300 ms` of the release threshold crossing, otherwise unfreeze with no press).

**Property 17 weakened then restored.** In one design revision the P17 generator was
narrowed to "valid Profile objects only" with the note that arbitrary-JSON clamping
was "covered separately as an example test." The original requirement says the
property must hold for arbitrary JSON (any field order, unknown keys, `__proto__`
injection). Restored to cover all three parts: round-trip for valid profiles, all
fields in range for any import, and exactly the known fields regardless of input.

**Per-source timestamp bugs found in review.**

- First version: a single global `lastNow`. Broken because camera frames carry their
  capture timestamp, which is typically 30–60 ms older than the most recent switch
  sample. A global clock would drop every camera frame while a switch is held.
  Fixed to per-source clocks.

- Second version: keyboard and gamepad shared one clock. Broken because both adapters
  fire on the same animation frame; the second adapter's sample would always match the
  first one's `now` and be silently dropped. Fixed to one clock per source.

- Third version: synthetic samples bypassed the duplicate-timestamp check. This made
  P16 meaningless for the simulator and property tests (the check they are testing was
  not running). Fixed: synthetic gets its own clock and the same check as real sources.

The `source` field on `TimestampedSample` now takes `'camera' | 'keyboard' | 'mouse'
| 'gamepad' | 'synthetic'` — five distinct values, each with its own `lastNow`.

---

### What we changed

- Steering files: seven decisions written back (see steering review above).
- requirements.md: Req 8 added; Req 2 AC 4 split across presets; Req 7 AC 1–2
  revised for four ranges and tremor measurement; Req 7 AC 5 clamping order extended;
  profile table corrected to 30 fields.
- design.md: filter moved before dead zone; tremor analysis corrected; face-lock
  re-acquire fixed; two smoothing presets formalised; asymmetric ranges and dead-zone
  constraint added; gesture freeze start and expiry specified; P17 generator restored;
  `source` field expanded to five values with separate clocks; no-face timeout moved
  from camera adapter into head-pointer engine.
- tasks.md: 18 tasks written, ordered tooling → pure engines → adapters → UI →
  deploy.
