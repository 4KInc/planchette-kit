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
their dominant side). The centre position `(θ_cx, θ_cy)` is also stored.

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
| `fC_min` | 1.5 Hz | 0.3 Hz | `fC_min = 1.5 − 1.2 × s` |
| `beta`   | 0.4 deg⁻¹ | 0.004 deg⁻¹ | `beta = 0.4 × 10^(−2 × s)` (log-linear) |

Units: `fC_min` is in Hz; `beta` is in deg⁻¹ because the input is in degrees, so
`beta × |dHat|` (deg/s) gives Hz.

### Tuning derivation and presets

The requirements state two targets at the reference calibration (±15° symmetric,
gain 1.0, 1920 × 1080 screen) with synthetic timestamped samples fed to the engine:

- **T1 (tremor):** 1° sinusoid at 4–12 Hz → pointer residual < 8 px.
  At the reference calibration, 1° maps to `1920 / 30 ≈ 64 px`, so the target in
  angle terms is a residual < 8/64 = 0.125°.
- **T2 (lag):** 20° step → 90 % reached within 150 ms.

Working in degrees removes the screen-resolution dependency from the analysis. The
hand calculations below are estimates only. The tuning test (`smoother.test.ts`)
measures the real values by simulating 1° tremor at 4–12 Hz and a 20° step at the
reference calibration on synthetic samples, and sets the final `fC_min` and `beta`
values from those results. The formulas below are the starting point.

**T1 and T2 cannot both be met at a single smoothing strength.** Lowering `fC_min`
suppresses 4 Hz tremor but increases lag for the 20° step; raising it reduces lag but
passes more tremor. The design therefore specifies two presets:

- **Default (`s = 0.5`):** tuned to meet T2 (lag). `fC_min ≈ 0.9 Hz`,
  `beta ≈ 0.04 deg⁻¹`. At rest, `fC ≈ 0.9 Hz`. A 20° step drives `|dHat|` to
  roughly 400 deg/s, giving `fC ≈ 0.9 + 0.04 × 400 ≈ 16.9 Hz`. At 60 fps,
  `alpha ≈ 0.86`; estimated 90 % distance reached in 2–3 frames (33–50 ms). T2 ✓
  (estimate — tuning test confirms). T1 fails at this setting; residual ≈ 0.22°.
- **High-tremor preset (`s = 0.9`):** tuned to meet T1 at the cost of longer lag.
  `fC_min ≈ 0.42 Hz`. At 4 Hz input, estimated attenuation ≈ 0.10, residual ≈ 0.06°.
  T1 ✓ (estimate). Estimated 90 % lag ≈ 220 ms; T2 fails at this preset.

The tuning test measures both targets for both presets and fails if the measured
values cross, so the final formulas may differ from the estimates above.

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
2. resets dwell progress silently (no event);
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

---

## 5. Engine file layout

```
skeleton/src/engine/
  press-machine.ts     shared press/cancel state machine; used by gesture.ts and switch.ts
  smoother.ts          One Euro filter on angles; step(state, { angle, dt }) → { angle }
  head-pointer.ts      face lock + dead zone + mapping; step(state, { faces }, now, profile) → events
  targets.ts           Rect, TargetRole, DwellTarget (types only, no dependencies)
  dwell.ts             dwell timer; step(state, { pointer, targets }, now, profile) → events
  gesture.ts           blendshape → signal, calls press-machine; step(state, { score }, now, profile) → events + press
  switch.ts            key/button → signal, calls press-machine; step(state, { signal }, now, profile) → events + press
  scan.ts              scan cycle + highlight; step(state, { press, targets }, now, profile) → events
  calibration.ts       stillness detector + range recorder; step(state, { rotation }, now, profile) → events
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
  | 'highlight'          // { targetId: string }
  | 'select'             // { targetId: string; now: number; source: SelectSource; role: TargetRole }
  | 'cancel'             // {}
  | 'tracking-status'    // { status: TrackingStatus }
  | 'mode-change'        // { mode: InputMode }
  | 'calibration-step'   // { step: CalibrationStep; completed: boolean; timeout: boolean }

type SelectSource = 'dwell' | 'scan' | 'gesture' | 'mouse'

type TrackingStatus =
  | 'found' | 'lost' | 'low-confidence'
  | 'permission-denied' | 'load-failed' | 'no-face-timeout'

type CalibrationStep = 'centre' | 'left' | 'right' | 'up' | 'down' | 'done'
```

### TimestampedSample

```typescript
interface TimestampedSample {
  now: number
  source: 'camera' | 'keyboard' | 'mouse' | 'gamepad' | 'synthetic'
  faces?: Array<{ bbox: { cx: number; cy: number; w: number; h: number }
                  landmarks: NormalisedLandmarks }>
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
| 6 | **Scan coverage** | Random target lists (1–20 items); random scan interval | Every item highlighted exactly once per loop, in registration order |
| 7 | **Short presses ignored** | Hold durations in [1, acceptanceTime − 1 ms]; random acceptance times from valid range | No press or `select` emitted |
| 8 | **Pause respected** | Random sequences of valid selections | Gap between consecutive `select` events ≥ `postSelectionPause` |
| 9 | **Resume does not select** | Scan sequences reaching pause; then one press | First event is `highlight`, not `select` |
| 10 | **Pointer bounded** | Random head rotation values including extremes and ±Inf | Every `pointer-move` has `x ∈ [0, W−1]`, `y ∈ [0, H−1]` |
| 11 | **Every target reachable** | Random screen points; random calibrated ranges R ≥ MIN_RANGE per direction; random G ∈ [1.0, 2.0]; D clamped by constraint | For each point a head rotation with `\|θ\| ≤ R` maps to it (verified analytically via the inverse formula) |
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
