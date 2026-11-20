# Design: input core

## Overview

Five deterministic engines cover the input core. Each is a state machine with the
shape `step(state, input, now)` that mutates its state in place and returns an array
of events. Time flows in; no engine reads a clock.

```
camera adapter
      │ faces (list of bounding boxes + landmarks) + timestamp
      ▼
  head-pointer engine ──► smoothed (yaw, pitch) in degrees  [smoother runs here]
      │                ──► pointer-move (screen px)
      │
  dwell engine ──────────► dwell-progress, select
      │
  press-machine (shared) ◄── gesture engine (blendshape score → signal)
      │                  ◄── switch adapter  (key/button/gamepad → signal)
      ▼
  scan engine ───────────► highlight, select, cancel
```

Mouse and keyboard adapters feed the press machine directly, bypassing the camera
stack. All engines receive the profile on every `step` call; none stores a pointer to
it, so a profile change takes effect on the next frame without reinitialising state.

---

## 1. Head gain formula and minimum supported range

### Calibration records four ranges

Calibration records one half-angle per direction: `R_left`, `R_right` (yaw) and
`R_up`, `R_down` (pitch), all in degrees and all positive. The four values are stored
separately because most people have an asymmetric range (e.g. more rotation toward
their dominant side). The ranges are saved in the profile. The centre position
`(θ_cx, θ_cy)` is session state, not a profile field (Requirement 7 AC 2): it is
measured by a centre step each time the camera starts, and by `recentre()`. Until that
step completes it is `(0, 0)`. See §4 "Centre step".

The minimum supported range is the constant `MIN_RANGE = 3` degrees. If any of the
four measured values is below `MIN_RANGE`, calibration rejects the result, shows the
"range too small" message, and suggests switch scanning or face-gesture scanning. The
engine does not silently clamp to `MIN_RANGE`, because doing so would make part of
the screen unreachable.

### Dead zone constraint

The dead zone `D` (degrees, default 0.5) is applied symmetrically around the centre.
To ensure every screen edge stays reachable, the dead zone is clamped on import to:

```
D ≤ 0.5 × min(R_left, R_right, R_up, R_down)
```

This is enforced by `clampProfile` and `importProfile` after the calibration ranges
are set, so the constraint is always satisfied when the mapping runs.

### Dead zone application

Let `δ = θ − θ_centre` (signed, in degrees). The dead zone removes the central
insensitive band:

```
δ_dz = sign(δ) × max(0, |δ| − D)
```

At rest (`|δ| ≤ D`) the pointer is exactly at centre. For `|δ| > D`, movement begins
at zero and increases linearly. The dead zone acts at the centre only; it has no
effect on tremor that is not centred on the neutral position.

### Calibrated mapping with asymmetric ranges

After dead zone, the signed deflection `δ_dz` is mapped to `u ∈ [0, 1]` using the
appropriate half-range for the direction of movement. For yaw:

```
R_eff_x = (δ_dz ≥ 0 ? R_right : R_left) − D
u_x = clamp(δ_dz / (R_eff_x / G) × 0.5 + 0.5, 0, 1)
```

Subtracting `D` from each half-range gives the **effective range** that remains after
the dead zone, so the full screen edge is reached when `|δ_dz| = R_eff` regardless
of `D`. The same formula applies to pitch using `R_up` / `R_down`. The clamp ensures
the pointer never leaves the screen.

### Head gain

Head gain `G` (profile field, default 1.0, range [1.0, 2.0]) multiplies into the
mapping as shown above. At `G = 1.0` the full effective range traverses the screen.
At `G = 2.0` only half the effective range is needed. Because `G ≥ 1.0` always and
`R_eff ≥ MIN_RANGE − D ≥ MIN_RANGE / 2 > 0` always (by the dead zone constraint),
every screen position is reachable.

### Property 11 with default settings

At defaults (`D = 0.5°`, `G = 1.0`, any calibrated range `R ≥ 3°`):

- `R_eff = R − 0.5 ≥ 2.5°`
- For any target screen point `(u_x, u_y) ∈ [0, 1]²`, the required deflection is
  `δ_dz = (u − 0.5) × 2 × R_eff`, which has magnitude at most `R_eff`.
- Inverting the dead zone: required `|δ| = |δ_dz| + D ≤ R_eff + D = R`. So the
  physical rotation needed never exceeds the calibrated range. ✓

### Screen pixel conversion

```
x_px = round(u_x × (screenWidth  − 1))
y_px = round(u_y × (screenHeight − 1))
```

The pointer is always an integer pixel coordinate, clamped to
`[0, screenWidth − 1] × [0, screenHeight − 1]` before every `pointer-move` event.

---

## 2. One Euro filter

### Filter position in the pipeline

The One Euro filter runs on the raw centred angles — `δ_x = θ_x − θ_cx` and
`δ_y = θ_y − θ_cy` — before the dead zone and before the screen mapping. The
filtered angle `δ_filtered` is then passed to the dead zone formula in §1:

```
pipeline per axis:
  θ  →  δ = θ − θ_centre  →  [One Euro filter]  →  δ_filtered  →  [dead zone]  →  δ_dz  →  [mapping]  →  u
```

Filtering before the dead zone means the filter sees continuous, physically meaningful
input at all times; it does not see the discontinuity introduced when the pointer snaps
to centre as δ crosses the dead zone boundary.

### One Euro internals

The filter maintains per-axis state: `prev` (the previous filtered value) and
`dPrev` (the previous derivative estimate). On each step with new angle `x` and
elapsed time `dt` (seconds, `dt > 0`):

```
dx    = (x − prev) / dt
dHat  = dPrev + alphaDeriv(dt) × (dx − dPrev)      // low-pass on derivative
fC    = fC_min + beta × |dHat|                      // adaptive cutoff
a     = alpha(dt, fC)
out   = prev + a × (x − prev)                       // low-pass on value

alphaDeriv(dt) = 2π × fC_deriv × dt / (1 + 2π × fC_deriv × dt)
alpha(dt, fC)  = 2π × fC × dt / (1 + 2π × fC × dt)
fC_deriv       = 1 Hz  (fixed, not in profile)
```

State update: `prev = out`, `dPrev = dHat`.

### Parameter mapping from smoothing strength

`smoothing strength` `s ∈ [0, 1]` (default 0.5) controls two parameters:

| Parameter | s = 0 (least) | s = 1 (most) | Formula |
|---|---|---|---|
| `fC_min` | 1.5 Hz | 0.2 Hz | `fC_min = 1.5 − 1.3 × s` |
| `beta`   | 0.4 deg⁻¹ | 0.004 deg⁻¹ | `beta = 0.4 × 10^(−2 × s)` (log-linear) |

Units: `fC_min` is in Hz; `beta` is in deg⁻¹ because the input is in degrees, so
`beta × |dHat|` (deg/s) gives Hz.

These are the final values set by the tuning test. The starting design had
`fC_min = 0.3 Hz` at `s = 1`, which missed the tremor target at the high-tremor preset
(9.22 px at 15 fps and 8.15 px at 120 fps with even spacing). Lowering it to 0.2 Hz meets
the target; `beta` is unchanged. The resulting presets:

| Preset | `s` | `fC_min` | `beta` |
|---|---|---|---|
| Default | 0.5 | 0.85 Hz | 0.040 deg⁻¹ |
| High tremor | 0.9 | 0.33 Hz | 0.0063 deg⁻¹ |

In code (`smoother.ts`): `FC_MIN_AT_0 = 1.5`, `FC_MIN_AT_1 = 0.2`, `BETA_AT_0 = 0.4`,
`BETA_AT_1 = 0.004`, `FC_DERIV_HZ = 1`. A non-finite `s` uses 0.5; `s` is clamped to
[0, 1].

### Tuning derivation and presets
The requirements state two targets at the reference calibration (±15° symmetric,
gain 1.0, 1920 × 1080 screen) with synthetic timestamped samples fed to the engine:
- **T1 (tremor):** 1° sinusoid at 4–12 Hz → pointer residual < 8 px.
  At the reference calibration, 1° maps to `1920 / 30 = 64 px`, so the target in
  angle terms is a residual < 8/64 = 0.125°.
- **T2 (lag):** 20° turn → 90 % reached within 150 ms of the head arriving.

Both apply at a camera frame rate of 30 fps or more, with frame spacing varying by up
to ±20 % (Requirement 2 AC 4).

**T1 and T2 cannot both be met at a single smoothing strength.** Lowering `fC_min`
suppresses 4 Hz tremor but increases lag; raising it reduces lag but passes more
tremor. So there are two presets: the default (`s = 0.5`) meets T2 and the high-tremor
preset (`s = 0.9`) meets T1.

**How the tuning test measures** (`smoother.test.ts`), at the filter output in degrees,
converted at 64 px per degree:
- *Lag:* the head is still at −10° for 1 s, then turns to +10° (inside the ±15° range),
  either instantly or as a smooth turn of 100 to 500 ms. Lag is the time from the head
  arriving (for an instant step, the first frame that sees the new position) until the
  output first reaches 90 % of the distance.
- *Tremor:* a sinusoid of up to 1° at 4–12 Hz around a still, off-centre pose. Movement
  is the largest distance of the output from the pose, after the filter has settled for
  4 s, over the next 6 s. The dead zone is not applied, so this is the off-centre worst
  case.
- *Timing:* even frame spacing, and spacing varying by up to ±20 % over several fixed
  seeds. Both targets are asserted at 30, 60 and 120 fps. At 15 and 24 fps the values
  are logged, not asserted.
- The full head-pointer pipeline (dead zone and screen mapping) is checked in Task 7.

**Measured values** (worst case over the cases above):

| Frame rate | Default lag, even | Default lag, ±20 % | High-tremor tremor, even | High-tremor tremor, ±20 % |
|---|---|---|---|---|
| 30 fps | 66.7 ms | 75.2 ms | 5.67 px | 7.24 px |
| 60 fps | 50.0 ms | 62.1 ms | 6.02 px | 6.58 px |
| 120 fps | 41.7 ms | 46.3 ms | 6.76 px | 7.38 px |
| 24 fps (not asserted) | 83.3 ms | 86.5 ms | 5.53 px | 10.77 px |
| 15 fps (not asserted) | 133.3 ms | 151.6 ms | 7.52 px | 27.89 px |

Limits: lag ≤ 150 ms, tremor < 8 px. The other side of each preset, for reference: the
default preset passes 14–22 px of 1° tremor, and the high-tremor preset takes
117–400 ms to reach 90 % of a step, depending on frame rate.

**Known limit: below 30 fps.** Below 30 fps the camera cannot capture fast tremor
reliably. A 15 fps camera can only represent motion up to 7.5 Hz. With even spacing a
12 Hz tremor is seen as a slower 3 Hz movement, but with uneven spacing it looks like
random 1° jumps from frame to frame, which no filter can tell apart from deliberate
movement without freezing the pointer. At 15 fps with ±20 % spacing, tremor reaches
27.89 px, and a 20° turn takes up to 151.6 ms because two long frames exceed 150 ms. At
24 fps with ±20 % spacing, 12 Hz tremor reaches 10.77 px. These rates still work, but
the targets are not promised there.

**Calibration tremor measurement.** During calibration's hold-still steps the
calibration engine measures the standard deviation of `δ` over the stillness window.
If the standard deviation exceeds `0.5°` on either axis, the calibration result
includes `suggestHighTremor: true`. The UI then offers the high-tremor preset to the
person or carer. This measurement uses the same synthetic-sample path as the engine,
so it is deterministic and testable.

### Filter initialisation and reset

On the first sample after initialisation or after a tracking loss: `prev = x`,
`dPrev = 0`. Resetting on loss prevents a stale `prev` from causing a jump when
tracking resumes.

---

## 3. Press vs. cancel-hold state machine

One shared module — `press-machine.ts` — implements this state machine. Both
`gesture.ts` and `switch.ts` instantiate it; only the signal source differs. The
engine is stepped every frame with the **current level state** of the signal (held or
not), so a continuously held key or gesture produces one sample per frame with
`signal = true`. The input timeout fires only when samples stop arriving entirely,
not when the signal is held.

### Timing example: 2000 ms cancel hold, 2000 ms input timeout

With cancel-by-hold ON, `cancelHoldTime = 2000 ms`, `inputTimeout = 2000 ms`:

- Frame at t = 0: signal goes active → PENDING_ACCEPT (acceptanceTime = 0 ms, so
  transitions to ARMED_HOLD_WAIT immediately on the same step).
- Frames at t = 16, 32, …: signal still active, `now − t_down < 2000 ms` → stay in
  ARMED_HOLD_WAIT. Each frame is a sample, so the input timeout does not fire.
- Frame at t = 2000 (or first frame where `now − t_down ≥ 2000 ms`): signal active,
  `now − t_down ≥ cancelHoldTime` → emit cancel → COOLDOWN.
- Input timeout does not fire because samples arrived continuously.
- Result: exactly one `cancel`, no press. ✓

If the person releases at t = 1500 ms instead: signal goes inactive → emit press →
IDLE. No cancel.

The input timeout only fires if no sample arrives for `inputTimeout` ms (e.g. the
adapter stops sending). In that case the machine resets silently to IDLE — no cancel,
no press.

### States

```
IDLE
  │  signal active
  ▼
PENDING_ACCEPT
  │  held ≥ acceptanceTime
  ├─► cancel-by-hold OFF → emit press → ARMED
  └─► cancel-by-hold ON  → ARMED_HOLD_WAIT

ARMED  (cancel-by-hold OFF)
  │  signal inactive
  └─► IDLE

ARMED_HOLD_WAIT  (cancel-by-hold ON)
  ├─► signal inactive before cancelHoldTime → emit press → IDLE
  └─► held ≥ cancelHoldTime → emit cancel → COOLDOWN

COOLDOWN
  │  signal inactive
  └─► IDLE
```

### Formal transition table

| State | Condition | Action | Next state |
|---|---|---|---|
| IDLE | signal active | `t_down = now` | PENDING_ACCEPT |
| PENDING_ACCEPT | signal inactive | — | IDLE |
| PENDING_ACCEPT | signal active, `now − t_down < acceptanceTime` | — | PENDING_ACCEPT |
| PENDING_ACCEPT | signal active, `now − t_down ≥ acceptanceTime`, hold OFF | emit press | ARMED |
| PENDING_ACCEPT | signal active, `now − t_down ≥ acceptanceTime`, hold ON | — | ARMED_HOLD_WAIT |
| ARMED | signal inactive | — | IDLE |
| ARMED_HOLD_WAIT | signal active, `now − t_down < cancelHoldTime` | — | ARMED_HOLD_WAIT |
| ARMED_HOLD_WAIT | signal active, `now − t_down ≥ cancelHoldTime` | emit cancel | COOLDOWN |
| ARMED_HOLD_WAIT | signal inactive, `now − t_down < cancelHoldTime` | emit press | IDLE |
| ARMED_HOLD_WAIT | signal inactive, `now − t_down ≥ cancelHoldTime` | emit cancel | IDLE |
| COOLDOWN | signal active | — | COOLDOWN |
| COOLDOWN | signal inactive | — | IDLE |
| any | next sample arrives with `now − t_last ≥ inputTimeout` | reset silently, then handle the sample as in IDLE | IDLE |

### Decisions on edge cases
- **Release at or after the cancel hold time gives `cancel`, not `press`.** The
  `now − t_down ≥ cancelHoldTime` check comes before the release check, so a release
  sample that itself reaches the cancel hold time cancels. Without this, a gap in the
  samples could turn a hold that reached the cancel hold time into a press, which
  Property 18 forbids. With a sample every frame the result is the same as the
  simple reading of the table.
- **The input timeout is applied when the next sample arrives.** The machine has no
  clock, so it cannot notice silence by itself. On each sample, if
  `now − t_last ≥ inputTimeout`, the state is reset silently to IDLE (no `cancel`, no
  `press`) and that sample is then handled as a fresh one. A stuck machine is
  therefore cleared by the next sample, not at the moment the timeout expires.
- **The acceptance time is a required argument of `stepPress`.** The switch engine
  passes `switchAcceptanceTime` and the gesture engine passes `gestureAcceptanceTime`.
  There is no default, so neither can silently use the other's value.
- Samples with a non-finite `now`, or a `now` not greater than the previous one, are
  ignored (Requirement 9 AC 4).

### Signal definitions

- **Keyboard / mouse / gamepad:** `signal = true` while the key or button is held;
  `signal = false` while released. Every adapter sends one sample per animation frame
  reflecting the current held state, so the press machine always receives a continuous
  stream while a switch is active.
- **Face gesture:** the camera adapter produces `gestureScores: { jawOpen, browRaise }`
  on every frame. `gesture.ts` selects the score for the gesture named in
  `profile.switchGesture` and sets `signal = true` while that score ≥
  `gestureThreshold`; `signal = false` while it < `releaseThreshold`. The adapter
  never picks the gesture; the engine does.

### State object

`{ state: PressState; t_down: number; t_last: number }` — no allocations per step.

---

## 4. Face-lock rule

### NumFaces

MediaPipe is configured with `numFaces = 2`. This allows the engine to receive at
most two detected faces per frame, which is enough to distinguish the user's face
from a bystander without the performance cost of tracking more.

### Representation

Each detected face is a bounding box `{ cx, cy, w, h }` in normalised image
coordinates (cx, cy = centre; w, h as fractions of frame dimensions), plus its
landmark array. The locked face is stored as `lock = { cx, cy, w, h }`.

### Initial lock (one face in view)

When only one face is detected — including on the very first frame — the engine locks
it immediately without scoring. This is the common case; the continuity threshold is
not consulted.

When two faces are detected on the first frame, the engine locks the one with the
larger bounding-box area (closest to the camera or most fully in frame).

### Frame-to-frame continuity (two faces in view)

When two faces are present, the engine picks the one that best continues the locked
face using a **continuity score**:

```
positionDist = sqrt((f.cx − lock.cx)² + (f.cy − lock.cy)²)
sizeRatio    = max(f.w / lock.w, lock.w / f.w)   // always ≥ 1.0
score        = positionDist + 0.5 × (sizeRatio − 1.0)
```

The face with the lower score is locked. No threshold is applied when choosing
between two faces: the engine always picks the better-scoring one. The threshold
`LOCK_THRESHOLD = 0.15` is used only when no face is detected (see below).

`lock` is updated to the winning face's bounding box every frame.

### Face lost (zero faces detected)

When no face is detected, the engine:

1. freezes the pointer at its last position;
2. resets dwell progress: the host passes a `null` pointer to the dwell engine, which ends
   the stay and emits one `dwell-progress` with progress 0 to clear the ring (§5). No
   `select` and no `cancel` are emitted;
3. emits `tracking-status: lost`;
4. retains `lock` at its last known value;
5. starts (or continues) the no-face timeout counter using `now`.

The no-face timeout is owned by the head-pointer engine, not the camera adapter. The
adapter only forwards frames; it does not track time between face detections. On each
camera sample with zero faces, the engine checks whether
`now − t_face_lost ≥ profile.noFaceTimeout`. If so, it emits
`tracking-status: no-face-timeout` (once; not on every subsequent frameless sample)
and clears the counter. `t_face_lost` is set to `now` on the first frameless sample
after a face was last seen, and cleared when a face is re-acquired.

No selection events are emitted while in the lost state.

### Re-acquire after loss

When faces return after a loss, Requirement 2 AC 9 says to re-lock the closest face:

- **One face detected:** lock it immediately (same rule as initial lock). No scoring.
- **Two faces detected:** apply the continuity score against the retained `lock` and
  lock the lower-scoring face, regardless of whether it exceeds `LOCK_THRESHOLD`.

`LOCK_THRESHOLD = 0.15` is used only as a diagnostic signal: if the winning score
exceeds the threshold the engine logs a warning but still locks the best candidate,
because the alternative — staying lost — is worse for the user. Requirement 2 AC 9
does not say to stay lost; it says to re-lock the closest face.

### Carer re-lock

The public API exposes `relockFace(faceIndex: number)`. When called with a valid
index (0 or 1) into the most recently received face list, the engine sets `lock` to
that face's bounding box and emits `tracking-status: found`. This is the only way to
intentionally switch to the other detected face.

### Gesture-induced pointer freeze (head + gesture mode only)

Only the gesture named in `profile.switchGesture` can freeze the pointer. Other
blendshape scores are ignored for freeze purposes even if they are above threshold.

The freeze starts when the chosen gesture's score first rises above the **release
threshold** (not the gesture threshold). This captures the pointer position before
the jaw or brow movement shifts the head, which typically happens slightly after the
score crosses the release threshold.

`freeze_pos` is recorded at that moment. The press machine continues running.

**Freeze expiry.** If the score does not reach the gesture threshold within
`gestureAcceptanceTime + 300 ms` of crossing the release threshold, the freeze is
cancelled: `freeze_pos` is discarded, the pointer resumes normal output, and no press
is counted. This prevents an ambiguous half-gesture (score above release threshold
but below gesture threshold) from holding the pointer indefinitely.

If the gesture completes (a press is emitted after the score stays above the gesture
threshold for the acceptance time), the `select` event uses `freeze_pos` for target
lookup.

When the gesture ends (score falls back below the release threshold), the freeze is
cleared and normal pointer output resumes. The filter state is maintained throughout,
so there is no position jump on resume.

In head + dwell mode this freeze never occurs.

### Centre step (session state)
The centre `(θ_cx, θ_cy)` is not saved in the profile. It is measured by the
calibration engine's centre step alone (Task 9), with the same stillness and
step-timeout rules as in full calibration, so it is hands-free.
- **When it runs.** Each time the camera starts, and when the app calls `recentre()`.
  A full calibration also measures the centre, as its first step. `recentre()` while a
  calibration or centre step is already running does nothing.
- **Before it completes.** The centre is `(0, 0)` until the first centre step of the
  session completes. A later `recentre()` keeps the previous centre until the new step
  completes. While a centre step runs, the pointer moves as usual (using the current
  centre) but nothing is selected: dwell and gesture selection begin when the step
  completes. Scanning, keyboard and mouse input are not affected.
- **Result.** The centre is the mean head rotation over the stillness window. If the
  step ends by the step timeout instead, the centre is the mean of the samples seen
  during the step. If no face was seen at all, the previous centre is kept.
- **Events.** The centre step reports through the same `calibration-step` events, with
  `run: 'centre'` (a full calibration uses `run: 'full'`): one event for the `centre`
  step and one `done` event when it completes.
- **Head pointer.** The host passes the session centre to `stepHeadPointer` on every
  sample as `centre`.

### Head-pointer engine details (`head-pointer.ts`)
Choices made where the sections above leave something open:
- **Rotation input.** Each detected face carries `rotation: { yaw, pitch }` in degrees.
  The camera adapter (Task 14) computes it from MediaPipe's facial transformation
  matrix and un-mirrors the image, so the engine never works with landmarks. Sign
  convention: positive yaw is the person turning to their right and moves the pointer
  right (uses `R_right`); positive pitch is the person looking up and moves the pointer
  up, to smaller `y` (uses `R_up`).
- **Centre.** The calibrated centre `(θ_cx, θ_cy)` is passed in on every step as
  `centre: { yaw, pitch }`, together with `screen`. It is not a profile field.
- **Gesture scores per face.** A face may carry its own `gestureScores`. The engine uses
  the locked face's scores and falls back to the sample-level `gestureScores` only when
  the face has none, so a bystander's jaw or brows cannot freeze the pointer. The score
  used is `jawOpen` for `switchGesture` 'jaw open' and `browRaise` for 'brow raise'. A
  missing or non-finite score counts as 0.
- **Invalid faces.** A face whose box is not finite, or has `w ≤ 0` or `h ≤ 0`, is
  ignored as if not detected. A face with a non-finite rotation is detected and locked,
  but the pointer and the filter hold for that sample. More than two faces are handled
  with the same rules.
- **Tracking status.** `found` and `lost` are emitted only when the state changes. The
  first face ever seen emits `found`. Before any face is found, a frameless sample emits
  no `lost` (nothing was lost), but it does start the no-face timer, so
  `no-face-timeout` also fires when the camera runs and no face ever appears
  (Requirement 8 AC 1). `no-face-timeout` is emitted at most once per loss: a further
  one needs a face to be found and lost again.
- **Filter reset.** Both axis filters reset on loss and on a carer re-lock, so the first
  sample afterwards goes straight to the new pose with no stale history.
- **Pointer output.** There is no pointer before the first face. `pointer-move` is
  emitted only when the shown position changes, after any `tracking-status` from the
  same sample. While the face is lost the pointer holds, but it is still clamped when the
  screen shrinks. `selectionPointer(state)` gives the position for target lookup: `null`
  while no face is tracked, the freeze position during a gesture freeze, otherwise the
  pointer.
- **Freeze details.** The freeze starts on the sample where the score first goes above
  (`>`) the release threshold, and ends when it goes below (`<`) it. `freeze_pos` is the
  pointer shown before that sample, so head movement on the crossing frame itself does
  not count. The gesture threshold counts as reached at `≥`, including on the expiry
  sample. After an expiry, no new freeze starts until the score has fallen below the
  release threshold. While frozen, no `pointer-move` is emitted; on release the pointer
  moves to the live (still filtered) position. Losing the face, or leaving
  head + gesture mode, clears the freeze. The head pointer never counts presses; Task 8
  makes sure an expired freeze produces no press.
- **Lock warning.** The engine is pure, so it does not log. It sets `lockWarning` (and
  `lockScore`) when a re-acquire with several faces picks one scoring above
  `LOCK_THRESHOLD`, and the host logs it.
- **Re-lock.** `relockFace(state, i)` uses the faces from the most recent sample. An
  invalid index, or a most recent sample with no face, does nothing.
- **Locked face scores.** `state.scores` holds the locked face's gesture scores from
  the last sample (its own, else the sample-level ones), or `null` when no face is
  tracked. The host passes these to the gesture engine, so both engines use the same face.

### Gesture engine details (`gesture.ts`)
`stepGesture(state, { gestureScores }, now, profile)`, where `gestureScores` is the
locked face's scores, or `null` when no face is detected. It calls `stepPress` with
`profile.gestureAcceptanceTime` and returns the press machine's `press` and `cancel`
events. Choices made where the spec is open:
- **Signal.** The score of `profile.switchGesture` (a missing or non-finite value counts
  as 0). The signal turns on at `score ≥ gestureThreshold` and off at
  `score < releaseThreshold`; in between it keeps its previous value (design §3).
- **Face not detected.** No press and no cancel. A gesture in progress is dropped
  silently: the press machine returns to IDLE without an event, so a cancel-by-hold
  gesture cannot turn into a press when the face disappears. After such a loss the
  score must fall below the release threshold before a new gesture can count, so a
  face that returns with the jaw still open does not press.
- **Expired freeze (head + gesture mode only).** The gesture begins when the score
  goes above the release threshold, as for the freeze. If it has not reached the
  gesture threshold within `gestureAcceptanceTime + 300 ms` of that, the gesture can no
  longer press until the score falls below the release threshold. This matches the
  freeze expiry, so a gesture whose freeze expired never selects. In gesture scan mode
  there is no freeze and a slow gesture presses normally.
- **Timing.** Its own clock: duplicate, backwards or non-finite timestamps are ignored.
  Camera samples without a face still count as samples for the press machine's input
  timeout, which therefore measures camera silence.

---

## 5. Engine file layout

```
skeleton/src/engine/
  press-machine.ts     shared press/cancel state machine; used by gesture.ts and switch.ts
  smoother.ts          One Euro filter on angles; step(state, { angle, dt }) → { angle }
  head-pointer.ts      face lock + smoothing + dead zone + mapping; step(state, { faces, gestureScores?, screen, centre }, now, profile) → events
  targets.ts           Rect, TargetRole, DwellTarget (types only, no dependencies)
  dwell.ts             dwell timer; step(state, { pointer, targets }, now, profile) → events
  gesture.ts           blendshape → signal, calls press-machine; step(state, { gestureScores }, now, profile) → press/cancel events
  switch.ts            key/button → signal, calls press-machine; step(state, { signal }, now, profile) → events + press
  scan.ts              scan cycle + highlight; step(state, { press, targets }, now, profile) → events
  calibration.ts       stillness detector + range recorder + gesture thresholds; step(state, { rotation, gestureScores }, now, profile) → events
  profile.ts           Profile type, defaults, clampProfile, importProfile, exportProfile
```

Each file exports one `step` function and its state type. `profile.ts` has no `step`.
### Dwell engine details (`dwell.ts`)
- **Samples are levels.** Time between two consecutive samples that are both on the
  same target counts as dwell time. A gap off the target needs at least one off-target
  sample.
- **Sample gap cap.** One gap between two consecutive on-target samples adds at most
  `MAX_SAMPLE_GAP_MS` = 100 ms to the dwell timer. Normal frame gaps of 16 to 100 ms
  (down to a 10 fps camera) count in full. A longer gap, such as a 1.9 s stall below
  the input timeout, adds only 100 ms, so a stall cannot select by itself. With
  samples every 150 ms the timer therefore advances at 100 ms per sample.
- **Gap rule.** After an off-target sample, the stay survives only while
  `now − lastOnTime ≤ graceTime`. The gap adds nothing to the dwell time. A longer gap
  ends the stay and resets the timer. Moving straight onto another target always
  starts a new stay for that target.
- **Post-selection pause.** The pause is a time when no new selection can start.
  No dwell time counts toward any target before `pauseEnd`, and `dwell-progress` is 0
  during the pause. Counting starts when the pause ends: if the pause end falls
  between two samples, only the part of the interval after it counts (still capped).
  A target entered during the pause therefore needs its full dwell time after the
  pause ends.
- **Auto-repeat.** After the first select, a target with auto-repeat selects again at
  `selectedAt + max(autoRepeatInterval, postSelectionPause)`. Its `dwell-progress` is 0
  during the pause, then runs 0 to 1 from the pause end to that time. Without
  auto-repeat, a completed stay shows progress 0 until it ends. The `select` sample
  itself reports progress 1 first, so a ring can fill before it clears.
- **Stay end.** When a stay ends, one `dwell-progress` with `progress: 0` is emitted for
  the old target, before any event for a new stay. A stay ends when the pointer moves
  onto a different target, when the grace time is exceeded, when the input timeout
  fires, and when the pointer is lost (`null` or non-finite), which ends it at once
  with no grace time. No clearing event is emitted when there is no stay.
- **Hit test.** Targets with role `rest-area` are skipped. If rectangles overlap, the
  first one in the list wins. Rectangles include their left and top edges and exclude
  right and bottom.
- **Input timeout.** Silence of `inputTimeout` or more ends the stay. The
  post-selection pause end time is kept.
- **Shared types.** `Rect`, `TargetRole` and `DwellTarget` live in `targets.ts`
  (types only, no dependencies) so dwell and scan share them.

### Scan engine details (`scan.ts`)
`stepScan(state, { press, targets, order? }, now, profile)`. `press` is true on the step
where the press machine counted a press. The engine is started by its first step (and
by the first step after an input timeout); a press on that step is ignored because
nothing was highlighted yet. The host creates a fresh state when the mode changes.
- **Slots.** Each level is a cycle of slots, and the highlight moves one slot per
  `scanInterval`:
  - list (linear): the items, then the cancel item;
  - grid, top level: the rows, then the cancel item;
  - inside a row: the row's items, then the back item, then the cancel item.
- **Scan order.** Reading order unless the app passes `order` (target ids). With
  `order`, the listed ids come first in that order (unknown ids are ignored) and any
  unlisted targets follow in reading order, so no target becomes unreachable.
  Reading order groups targets into visual rows and sorts rows top to bottom and items
  left to right. A target joins the current row when its vertical centre lies within
  the vertical extent of the row's first (topmost) target. Targets with role
  `rest-area` are not scanned. Targets with role `cancel` and `undo` are ordinary items.
- **Row-then-item mode.** It is used when there are two or more rows and at least one
  row has two or more items. Otherwise the list is scanned item by item (a vertical
  list, or a single row). In row mode a row with a single item is highlighted as that
  item and a press selects it directly. There is no profile field for the mode.
- **Virtual items.** The back and cancel items are not registered targets. Their
  highlight events use the ids `$back` and `$cancel` (`SCAN_BACK_ID`, `SCAN_CANCEL_ID`),
  with `kind` `'back'` or `'cancel'`. The UI must draw them. Selecting the cancel item
  emits `cancel` (not `select`) and returns to the top of the cycle.
- **Highlight event.** `{ kind: 'item' | 'row' | 'back' | 'cancel' | 'none', targetId,
  targetIds }`. For a row, `targetIds` lists every item in it and `targetId` is the
  first. `'none'` (empty ids) clears the highlight when scanning pauses.
- **Timing.** The next advance is scheduled from the previous due time, not from the
  sample that triggered it, so highlights do not drift with the frame rate. One step
  advances at most one slot. After a stall of a whole interval or more, the schedule
  resynchronises to `now + scanInterval` instead of catching up.
- **Press.** A press acts on the item highlighted before the step, and no advance
  happens in the same step. Acting presses are: selecting an item (`select`, source
  `scan`), entering a row, the back item, and the cancel item. After each of them the
  engine applies the post-selection pause, resets the loop count, and highlights the
  new position at once. Selecting an item or cancel restarts at the top of the cycle.
  Entering a row highlights its first item. The back item highlights the row just left.
  The first highlight after an acting press lasts until the pause end plus a full
  `scanInterval`.
- **Post-selection pause.** A press with `now < pauseEnd` is ignored and changes
  nothing, including a press that would end a scan pause.
- **Loops without a press.** A loop is one pass through a level's slots. When
  `scanLoopsBeforePause` loops complete without a press: at the top level the engine
  pauses, emits a `'none'` highlight and stops advancing; inside a row it returns to row
  scanning on that row, with the loop count reset (it does not pause). A press resets
  the loop count.
- **Resume.** While paused, the next counted press (outside the post-selection pause)
  restarts scanning at the first slot of the top level, emits its highlight, and
  selects nothing. It does not start a post-selection pause.
- **Input timeout.** Silence of `inputTimeout` or more restarts the cycle from the top
  on the next sample, unless the engine is paused, which stays paused until a press.
  The post-selection pause end time is kept.
- **Known limit: tall targets.** A row's vertical band comes from its first target. If
  that target is taller than one row (for example a tall button at the left of a grid
  that spans two rows), the next row's items have their vertical centres inside its band
  and join its row. The tall target then absorbs the next row's items into its row, and
  they are scanned as one row. A custom `order` does not change this grouping. It is not
  handled yet.
- **Changing targets.** The layout is rebuilt from `targets` whenever a step needs it
  (a press or an advance), so changes take effect at the next advance or press. A slot
  index that no longer exists wraps to the first slot. A row level that no longer
  exists, or a layout that stopped being a grid, returns to the top level.

### Calibration engine details (`calibration.ts`)
The engine is pure: time comes in as `now`, input comes in as a sample, and it touches
no DOM and no device. It never changes the profile. The result carries the profile
fields to apply, and the host applies them with `setProfile`, which clamps.
**Runs and steps.**
- `run: 'full'`: `centre`, `left`, `right`, `up`, `down`, `rest`, `gesture`, then `done`.
- `run: 'centre'`: `centre`, then `done`. It skips the gesture step and measures
  nothing else (see "Centre step" in §4).
**Input.** `{ rotation: FaceRotation | null, gestureScores: GestureScores | null }` per
camera sample. `rotation` is `null` when no face is detected, or when a value is not
finite; such a sample carries no measurement. A sample with a non-finite `now` is ignored.
**Stillness and timeout (every step, the gesture phases included).**
- A step keeps a window of the samples since the head last moved. The head is still
  while, over the window, the spread (max − min) of yaw and of pitch are both at most
  `calibrationStillnessThreshold`. A sample that would break this restarts the window
  at that sample. A sample with no face empties the window.
- The step ends when the window has lasted `calibrationStillnessTime` (`timeout: false`),
  or when `calibrationStepTimeout` has passed since the step started (`timeout: true`),
  whichever comes first. If both hold on the same sample, stillness wins.
- A step starts at the `now` of the first sample the engine sees (first step) or at
  the `now` of the sample that ended the previous step. That ending sample is not
  measured in the next step.
- The measurement is over the window on stillness, and over every sample of the step on
  timeout. With no face sample at all, the measurement is missing.

**Head steps.** The centre is the mean `(yaw, pitch)`. Ranges are relative to the run's
centre: `left = c.yaw − mean.yaw`, `right = mean.yaw − c.yaw`, `down = c.pitch − mean.pitch`,
`up = mean.pitch − c.pitch` (same signs as §4). After the `down` step, if the centre or a
range is missing, or any range is below `MIN_RANGE`, the head result is rejected
(`range-too-small`, or `no-centre` when the centre step saw no face). A rejection drops the
four ranges only: the profile keeps its old ranges. The run carries on to the gesture
step, because a person who cannot point with their head is exactly the person who needs
the gesture switch.

**Tremor.** For each of the five head steps the population standard deviation of yaw and
of pitch is taken over the measured samples. `suggestHighTremor` is true if any of them
exceeds `0.5°`. The gesture phases are not measured for tremor, because opening the jaw
moves the head. A centre-only run reports `suggestHighTremor: false`.

**Gesture step (full run only, hands-free).** Two phases, each with the stillness and
timeout rules above, so the person never needs a hand:
1. `rest`: the person relaxes their face. The score is that of `profile.switchGesture`
   (`jawOpen` or `browRaise`, via `switchGestureScore`; a face with no scores counts
   as 0). `rest` is the mean score over the measured samples.
2. `gesture`: the person makes the gesture and holds it. `deliberate` is the 90th
   percentile of the measured scores (nearest rank: the value at index `ceil(0.9 n) − 1`
   of the sorted scores). A percentile rather than the mean, because the gesture starts
   part-way into the window. A percentile rather than the maximum, so one noisy frame
   does not set the threshold.

`range = deliberate − rest`. Constants: `GESTURE_MIN_RANGE = 0.15`,
`GESTURE_THRESHOLD_FRACTION = 0.6`, `GESTURE_RELEASE_FRACTION = 0.3`.
```
if range ≥ 0.15:
  threshold = rest + 0.6 × range
  release   = rest + 0.3 × range
  both clamped by clampProfile (threshold to 0.1–0.95, release to 0.05–threshold − 0.05)
else:
  gestureThreshold and gestureReleaseThreshold are kept as they were
```
With a range of at least 0.15 the unclamped release is already at least 0.045 below the
threshold, and the clamp widens it to the 0.05 gap. If a phase has no measurement (no
face) the thresholds are also kept. The calibration as a whole is never rejected for the
gesture: the done event says what happened.

**Done event.** `{ type: 'done', run, result }`. `result` is
`{ run, centre: FaceRotation | null, ranges: {left,right,up,down} | null,
rejected: 'range-too-small' | 'no-centre' | null, suggestHighTremor, gesture, profile }`.
`gesture` is `null` for a centre-only run, otherwise
`{ rest, deliberate, range, applied, kept: null | 'range-too-small' | 'no-measurement' }`
(`rest`, `deliberate` and `range` are `null` when missing). `profile` is the
`Partial<Profile>` to apply: the four ranges unless rejected, and the two thresholds only
when `applied`.

**Step events.** `{ type: 'step', run, step, completed, timeout }`: `completed: false`
when a step starts, `completed: true` when it ends (`timeout` says how). The first
step's start event comes on the first sample. When a step ends, its end event and the
next step's start event are emitted from the same call. After `done`, further samples
produce nothing.

**Known limit.** A person who is already still when a step starts finishes that step
after `calibrationStillnessTime` without having moved. For a head step this measures a
range near 0, which is rejected. For the gesture phase it gives a range near 0, so the
thresholds are kept. The UI should give a short cue before each step.

---

## 6. Public API (skeleton/src/index.ts)

The API is exposed through a factory function. There is no module-level state.

```typescript
export function createPlanchette(options: PlanchetteOptions): Planchette

interface PlanchetteOptions {
  screen: { width: number; height: number }  // CSS px
  profile?: Partial<Profile>
}

interface Rect {
  x: number; y: number; width: number; height: number  // CSS px, plain object
}

type TargetRole = 'default' | 'cancel' | 'undo' | 'rest-area'

interface Planchette extends EventTarget {
  // Targets
  registerTarget(id: string, rect: Rect, options?: {
    autoRepeat?: boolean
    role?: TargetRole
  }): void
  updateTarget(id: string, rect: Rect): void
  unregisterTarget(id: string): void
  getTargets(): ReadonlyArray<{
    id: string; rect: Rect; autoRepeat: boolean; role: TargetRole
  }>

  // Screen
  setScreen(size: { width: number; height: number }): void

  // Mode
  setMode(mode: InputMode): void

  // Camera
  startCamera(): Promise<void>
  stopCamera(): void
  relockFace(faceIndex: number): void

  // Profile
  getProfile(): Profile
  setProfile(profile: Partial<Profile>): void   // clamps values before applying
  exportProfile(): string                        // JSON
  importProfile(json: string): ImportResult

  // Calibration
  startCalibration(): void
  cancelCalibration(): void
  recentre(): void   // runs the centre step again (§4 "Centre step"); the centre is session state
  // calibration progress and completion are reported via 'calibration-step' events

  // Synthetic input (simulator and tests)
  feedSamples(samples: TimestampedSample[]): void
}
```

### Event payloads

```typescript
type InputMode = 'head+dwell' | 'head+gesture' | 'scan' | 'gesture-scan' | 'mouse'
type InputEventType =
  | 'pointer-move'       // { x: number; y: number }
  | 'dwell-progress'     // { targetId: string; progress: number }  0–1
  | 'highlight'          // { kind: ScanHighlightKind; targetId: string; targetIds: string[] }
  | 'select'             // { targetId: string; now: number; source: SelectSource; role: TargetRole }
  | 'cancel'             // {}
  | 'tracking-status'    // { status: TrackingStatus }
  | 'mode-change'        // { mode: InputMode }
  | 'calibration-step'   // { run: 'full' | 'centre'; step: CalibrationStep; completed: boolean; timeout: boolean; result?: CalibrationResult }  // result on 'done' only (§5 "Calibration engine details")

/**
 * What a scan highlight is on (the `kind` of a `highlight` event):
 *  'item'   one target. `targetId` is its id and `targetIds` is `[targetId]`.
 *  'row'    a row of targets in row-then-item scanning. `targetIds` lists every target
 *           in the row, in scan order, and `targetId` is the first of them.
 *  'back'   the virtual back item shown inside a row. `targetId` is '$back', `targetIds` is [].
 *  'cancel' the virtual cancel item in every scan cycle. `targetId` is '$cancel', `targetIds` is [].
 *  'none'   scanning paused after its loops without a press. `targetId` is '' and
 *           `targetIds` is []. The UI clears the highlight.
 * The UI draws the 'back' and 'cancel' items itself, since they are not registered targets.
 */
type ScanHighlightKind = 'item' | 'row' | 'back' | 'cancel' | 'none'
type SelectSource = 'dwell' | 'scan' | 'gesture' | 'mouse'

type TrackingStatus =
  | 'found' | 'lost' | 'low-confidence'
  | 'permission-denied' | 'load-failed' | 'no-face-timeout'

type CalibrationStep = 'centre' | 'left' | 'right' | 'up' | 'down' | 'rest' | 'gesture' | 'done'
```

### TimestampedSample

```typescript
interface TimestampedSample {
  now: number
  source: 'camera' | 'keyboard' | 'mouse' | 'gamepad' | 'synthetic'
  faces?: Array<{ bbox: { cx: number; cy: number; w: number; h: number }
                  rotation: { yaw: number; pitch: number }          // degrees, see §4
                  gestureScores?: { jawOpen: number; browRaise: number }
                  landmarks?: NormalisedLandmarks }>
  pointer?: { x: number; y: number }              // mouse mode: direct pointer position
  signal?: boolean                                 // switch held (true) or released (false)
  cancel?: boolean                                 // true = cancel input (e.g. Escape key)
  gestureScores?: { jawOpen: number; browRaise: number }  // 0–1 blendshape values
}
```

`cancel: true` is handled by the engine before the press machine. When present, the
engine immediately emits `cancel` and returns to idle regardless of current state.
This lets `feedSamples` carry Escape-key cancel in tests and the simulator without
needing a separate API call. The keyboard adapter sets `cancel: true` on the sample
produced when the Escape key is pressed.

### Per-source timestamp ordering

The duplicate-timestamp rule (ignore a sample whose `now` is not strictly greater
than the previous one) is applied **per input source**, not globally. Each source
maintains its own `lastNow` value:

- Camera samples are compared only against the previous camera sample's `now`.
- Keyboard samples (source `'keyboard'`) have their own clock.
- Gamepad samples (source `'gamepad'`) have their own clock.
- Mouse samples (source `'mouse'`) have their own clock.
- Synthetic samples (source `'synthetic'`) have their own clock.

Keyboard and gamepad each get a separate clock because both adapters emit one sample
per animation frame. If they shared a clock, the second adapter's sample would always
arrive with the same `now` as the first and be silently dropped. Synthetic samples
get their own clock so that property tests and the simulator are subject to the same
duplicate-timestamp rule as real inputs; this is what makes P16 meaningful for
generated streams.

This is necessary because camera frames arrive after MediaPipe processing with their
original capture timestamp. That capture time may be older than the most recent
switch sample's timestamp. Dropping camera frames that are "older than the last
switch sample" would break head tracking whenever a switch is held.

Each adapter sets `source` on every sample it emits. The engine routes each sample
to the per-source clock check before processing.

### setProfile clamping

`setProfile` calls `clampProfile` on the incoming partial before merging, so callers
cannot put the profile into an invalid state. It applies the same field ordering as
`importProfile` (cancel hold time first, then acceptance times, then thresholds).

---

## 7. Adapters

Each adapter converts device events into `TimestampedSample` objects and calls
`feedSamples`. Adapters contain no logic beyond the conversion.

| Adapter | `source` value | Produces |
|---|---|---|
| `camera-adapter.ts` | `'camera'` | `{ now, source, faces, gestureScores }` — one sample per processed frame; capture timestamp used as `now` |
| `keyboard-adapter.ts` | `'keyboard'` | `{ now, source, signal }` — one sample per animation frame; sets `cancel: true` when Escape is pressed |
| `mouse-adapter.ts` | `'mouse'` | `{ now, source, signal, pointer? }` — one sample per animation frame |
| `gamepad-adapter.ts` | `'gamepad'` | `{ now, source, signal }` — one sample per animation frame |

The camera adapter owns the `<video>` element and the "camera on" indicator. It is
the only module that touches the DOM or the camera. It extracts both face landmarks
and blendshape scores from MediaPipe and packs both into `gestureScores`; the engine
selects the relevant score by name.

Every switch adapter (keyboard, mouse, gamepad) sends one sample per animation frame
with `source: 'keyboard'` or `source: 'gamepad'` reflecting the current held state. The camera adapter sets
`source: 'camera'` on every sample. The mouse adapter uses `source: 'mouse'` and may
emit both pointer position and switch signal in one sample. Each adapter tracks its
own `lastNow` and silently discards samples where `now` has not advanced; it never
compares its timestamp against another adapter's clock. This ensures the press
machine always receives a continuous stream and the input timeout never fires while a
switch is held.

---

## 8. Profile import security

`importProfile` reads each field by its exact name from the parsed JSON object. It
never spreads, assigns or indexes with a user-supplied key.

```typescript
function importProfile(json: string): ImportResult {
  const raw = JSON.parse(json)       // throws SyntaxError — caller catches
  const changes: string[] = []
  const p = { ...defaultProfile }

  p.dwellTime   = readMs(raw, 'dwellTime',   defaults.dwellTime,   400,  3000,  changes)
  p.graceTime   = readMs(raw, 'graceTime',   defaults.graceTime,   0,    500,   changes)
  p.cancelHoldTime = readMs(raw, 'cancelHoldTime', defaults.cancelHoldTime, 1000, 5000, changes)
  // acceptance times clamped after cancelHoldTime:
  p.switchAcceptanceTime  = readMs(raw, 'switchAcceptanceTime',  0, 0, Math.min(2000, p.cancelHoldTime - 1), changes)
  p.gestureAcceptanceTime = readMs(raw, 'gestureAcceptanceTime', 100, 100, Math.min(2000, p.cancelHoldTime - 1), changes)
  // ... one explicit read per field; no Object.assign, no spread of raw
  // gesture thresholds clamped last:
  p.gestureThreshold        = readFloat(raw, 'gestureThreshold',        0.5,  0.1,  0.95, changes)
  p.gestureReleaseThreshold = readFloat(raw, 'gestureReleaseThreshold', 0.3,  0.05, p.gestureThreshold - 0.05, changes)

  return { profile: p, changes }
}
```

No field is ever accessed as `raw[userSuppliedKey]` or via computed property.

---

## 9. Property-based test plan

Engines are exercised through the public API (`feedSamples` + event listeners) using
the real engine, not stubs.

| # | Property | Generator | Check |
|---|---|---|---|
| 1 | **No quick-pass selection** | Pointer paths where each on-target segment is capped below dwellTime; random valid profiles | No `select` event for any target |
| 2 | **One selection per stay** | Pointer paths that enter and stay on one target (no auto-repeat); random valid profiles | At most one `select` per stay |
| 3 | **Face lost means no selection** | Landmark streams that interleave detected and lost periods (random lengths); random gesture scores throughout | No `select` or press emitted during any lost period |
| 4 | **Cancel always works** | Random sequences driving the engine to any reachable state; then inject a cancel input appropriate to the mode | Exactly one `cancel` emitted; engine reaches idle |
| 5 | **No stuck states** | Random input sequences followed by silence for `inputTimeout + 1 ms` | Engine is idle after the silence |
| 6 | **Scan coverage** | Random target lists (1–20 items, registered in random order); grids; random scan interval and custom orders | Every item (or row) highlighted exactly once per loop, in reading order (or the custom order), followed by the cancel item |
| 7 | **Short presses ignored** | Hold durations in [1, acceptanceTime − 1 ms]; random acceptance times from valid range | No press or `select` emitted |
| 8 | **Pause respected** | Random sequences of valid selections | Gap between consecutive `select` events ≥ `postSelectionPause` |
| 9 | **Resume does not select** | Scan sequences reaching pause; then one press | First event is `highlight`, not `select` |
| 10 | **Pointer bounded** | Random head rotation values including extremes and ±Inf | Every `pointer-move` has `x ∈ [0, W−1]`, `y ∈ [0, H−1]` |
| 11 | **Every target reachable** | Random screen points; random calibrated ranges R ≥ MIN_RANGE per direction; random G ∈ [1.0, 2.0]; D clamped by constraint | For each point, the rotation from the inverse formula has `\|δ\| ≤ R` on its side, and fed forward through the real engine (smoother, dead zone, gain, clamp, rounding) it lands within 1 px of the point |
| 12 | **One gesture, one press** | Gesture score traces that cross gestureThreshold once and stay above releaseThreshold for any duration | Exactly one press per activation |
| 13 | **Gesture does not drift the selection** | Random head movement after the score rises above releaseThreshold; random targets | `select` uses the target under the pointer at the moment score crossed releaseThreshold |
| 14 | **Moving targets keep progress** | Pointer on a target; `updateTarget` with rectangle still containing the pointer | `dwell-progress` does not decrease |
| 15 | **Frame-rate independence** | Pointer paths satisfying boundary conditions (stays > 67 ms from dwellTime, pointer > 20 px from edges); same seed at 15 fps and 60 fps | Same `select` events; each within 67 ms of its counterpart |
| 16 | **Bad timestamps ignored** | Interleaved camera (`source: 'camera'`), keyboard (`source: 'keyboard'`) and gamepad (`source: 'gamepad'`) streams with realistic camera delay (camera `now` lags keyboard/gamepad `now` by 20–80 ms); duplicate and backwards timestamps injected independently into each stream | Camera frames are never dropped due to keyboard or gamepad timestamps; each source ignores its own duplicates and reversals; events are identical to the clean versions of each stream |
| 17 | **Profile round-trip and clamping** | Arbitrary JSON strings: random valid profiles exported then reimported; random JSON objects with extra keys, `__proto__` keys, missing fields, out-of-range values, fields in any order | (a) `importProfile(exportProfile(p))` equals `p` for valid profiles; (b) every field in an imported profile is within its declared range; (c) the imported profile has exactly the known fields — no unknown keys, no `__proto__` |
| 18 | **Cancel hold never selects** | Hold durations ≥ cancelHoldTime; cancel-by-hold ON | No press or `select`; exactly one `cancel` |
| 19 | **Auto-repeat respects the pause** | Stays on an auto-repeat target; random autoRepeatInterval and postSelectionPause | Consecutive `select` events ≥ max(autoRepeatInterval, postSelectionPause) apart |
| 20 | **Talking does not freeze the pointer** | Random gesture score traces (including values above gestureThreshold); head + dwell mode; same trace with and without gesture scores | `pointer-move` events are identical in both runs |
| 21 | **Camera unavailable, other modes still work** | Scan or mouse input sequences; camera state set to each failure reason before the sequence | `select` events produced; no error; `tracking-status` carries the correct failure reason |

### Notes on revised properties

**P3** generates streams with alternating found/lost periods of random duration.
The check is that no `select` or press appears during any lost period — not just
all-lost streams.

**P13** uses `freeze_pos` captured when the score first crosses the release threshold
(not the gesture threshold), consistent with §4.

**P17** covers both directions and arbitrary JSON. Part (a) checks round-trip for
valid profiles. Part (b) checks that any imported value ends up in range. Part (c)
checks that the profile object has exactly the known fields regardless of what the
JSON contains, including `__proto__` injection attempts.

**P16** generates two independent streams — camera and switch — with the camera
stream's timestamps offset behind the switch stream by a realistic processing delay
(20–80 ms). The property checks that neither stream drops valid samples due to the
other's clock, and that injected bad timestamps within each stream are ignored without
affecting the other.

**P20** generates two identical runs — same pointer path, same profile, head + dwell
mode — differing only in whether gesture scores are present. The check is that
`pointer-move` events are bit-for-bit identical.

### Shared arbitraries (`test/arbitraries.ts`)

- `validProfile()` — all fields in range; dependent constraints satisfied
- `pointerPath(profile, screen)` — `{ x, y, now }` sequence
- `landmarkStream(options)` — `NormalisedLandmarks` sequence with controlled
  lost/found periods
- `gestureTrace(threshold, releaseThreshold, crossingCount)` — score array with
  exact number of threshold crossings
- `holdDuration(profile)` — duration relative to acceptance and cancel hold times

### Counterexample policy

When fast-check finds a counterexample, the shrunk minimal case is pinned as a named
example test in the same file and logged in `docs/kiro-journal.md` with: date,
property number, counterexample values, root cause, and fix.
