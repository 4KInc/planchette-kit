# Requirements: input core

## Introduction

The input core is the heart of the skeleton. It turns head movement, a face gesture,
a single switch or a mouse into one stream of pointing and selection events that any
web app can consume. It covers the head pointer, dwell selection, single-switch
scanning, the face-gesture switch, camera and tracking failure handling, cancel and
undo, calibration, the profile and the public API. The dwell simulator MCP server,
additional face gestures and the two apps are defined in separate specs.

## Glossary

- **Pointer**: the on-screen position the person controls.
- **Target**: an element an app registers as selectable, with an id and a rectangle.
- **Stay**: one continuous period with the pointer inside a target, where gaps no
  longer than the grace time do not end the stay.
- **Dwell time**: the time on a target needed to select it. It accumulates only while
  the pointer is on the target (see Requirement 3).
- **Scanning**: the system highlights items one after another; a switch press selects
  the highlighted item.
- **Switch**: any single input used for scanning: a face gesture, a key, a mouse
  click, a gamepad button, or an assistive switch that sends a key press.
- **Face gesture**: a deliberate face movement (jaw open or brow raise) read from the
  face model's blendshape scores.
- **Acceptance time**: how long a switch or gesture must be held before it counts.
- **Post-selection pause**: a short time after a selection when no new selection can
  start.
- **Calibrated mapping**: the mapping, produced by calibration, that turns the
  person's measured range of head rotation into the full screen width and height.
- **Head gain**: a multiplier applied on top of the calibrated mapping. 1.0 means the
  edges of the person's measured range reach the screen edges; above 1.0 means less
  head movement is needed. It is never below 1.0, so every point stays reachable.
- **Minimum supported range**: the smallest range of head rotation the head pointer
  supports: ±3 degrees per axis. A fixed constant, not a profile setting.
- **Reference calibration**: ±15 degrees per axis with head gain 1.0, used to state
  measurable smoothing targets.
- **Press**: one counted switch or gesture activation.
- **Head dead zone**: head movement small enough to be ignored (a profile value).
- **Rest area**: a screen area with no targets, where the pointer can rest safely.
  Not the same as the head dead zone.
- **Reset**: dwell progress and any half-finished press are cleared silently, with no
  event emitted. Different from **cancel**, which the person chooses and which emits
  `cancel`.
- **Profile**: the person's saved settings. Every field, its default and its range are
  in the Profile fields table at the end of this document.
- **Engine**: the deterministic logic that turns timestamped samples into events.

---

## Requirement 1: One input interface

**User story:** As an app developer, I want one interface for every input mode so that
my app works with head pointing, face gestures, scanning and mouse without separate
code paths.

### Acceptance criteria

1. THE skeleton SHALL let an app register, update and unregister targets by id and
   rectangle, and mark a target as allowing auto-repeat.
2. WHEN an app calls `updateTarget(id, rect)`, THE skeleton SHALL keep that target's
   dwell progress if the pointer is inside the new rectangle.
3. THE skeleton SHALL emit the same events in every mode: `pointer-move`,
   `dwell-progress`, `highlight`, `select`, `cancel`,
   `tracking-status` (found, lost, low-confidence, permission-denied, load-failed,
   no-face-timeout) and `mode-change`.
4. THE skeleton SHALL expose `getTargets()`, returning the current targets in a
   serialisable form so tools such as the dwell simulator can read a live app's layout.
5. WHEN the app changes the input mode, THE skeleton SHALL switch without the app
   re-registering targets and SHALL emit `mode-change`.
6. THE repo SHALL include an integration example that adds the skeleton to a plain web
   page in 15 lines of code or fewer, verified by a test that counts the lines.

---

## Requirement 2: Head pointer

**User story:** As a person who cannot use my hands, I want to move a pointer by
moving my head so that I can point at things on screen.

### Acceptance criteria

1. THE camera SHALL start only after a start action, which can come from any available
   input: a switch key, a mouse click or a carer. WHERE the profile's
   "start camera on load" setting is on, THE skeleton SHALL start the camera when the
   page loads.
2. WHILE the camera is running, THE skeleton SHALL show a visible "camera on"
   indicator.
3. THE skeleton SHALL move the pointer from head rotation using the calibrated mapping,
   the head gain and the head dead zone.
4. THE skeleton SHALL smooth the pointer. The design document names the filter and
   how its parameters follow the smoothing strength; a One Euro filter is the expected
   choice. Two smoothing presets are defined, each verified by the tuning test on
   synthetic timestamped samples at the reference calibration (±15° symmetric, gain
   1.0, 1920 × 1080). Camera capture and face-model latency, roughly 30–60 ms, are
   outside the engine and are not included in the measurement:
   - **Default preset (smoothing strength 0.5):** a deliberate 20-degree head turn
     SHALL reach 90 % of its target distance within 150 ms of the head arriving.
   - **High-tremor preset (smoothing strength 0.9):** simulated tremor up to 1 degree
     at 4–12 Hz SHALL move the pointer by less than 8 px.
   The tuning test measures the real values and sets the final parameters; the design
   document contains estimates only. The simulator reports the trade-off for each
   user's calibrated range.
5. FOR calibrated ranges smaller than the reference calibration, tremor filtering, head
   dead zone and lag trade off against each other. THE skeleton makes no fixed promise
   there; the dwell simulator measures jitter and lag for each range and reports them.
6. WHEN calibration measures a range smaller than the minimum supported range, THE
   skeleton SHALL say so and suggest a scanning mode (switch scanning or face-gesture
   scanning).
7. THE pointer SHALL always stay inside the visible screen area.
8. WHEN more than one face is in view, THE skeleton SHALL follow the locked face by
   continuity of position and size from frame to frame. THE skeleton does not and
   SHALL NOT identify people (no face recognition).
9. WHEN tracking resumes after the face was lost, THE skeleton SHALL lock onto the face
   closest to the last known position and size. A carer SHALL be able to re-lock onto
   a chosen face with an explicit action.
10. WHEN the locked face is not detected, THE skeleton SHALL freeze the pointer, reset
    dwell progress, emit `tracking-status: lost`, and emit no selection until the face
    is found again. This is a reset, not a `cancel`.
11. THE skeleton SHALL send no camera frame, landmark or derived data off the device.
12. WHEN the person or carer stops head pointing, THE skeleton SHALL stop the camera
    and remove the indicator.

---

## Requirement 3: Dwell selection

**User story:** As a head-pointer user, I want to select a target by holding the
pointer on it so that I can choose without a click.

### Acceptance criteria

1. THE dwell timer SHALL accumulate only while the pointer is on the target. A gap off
   the target no longer than the grace time SHALL pause the timer without resetting it,
   and add nothing to it; time off the target never counts toward the dwell time.
   A gap longer than the grace time SHALL reset the timer to zero.
2. WHEN the accumulated dwell time reaches the profile's dwell time, THE skeleton SHALL
   emit one `select` for that target.
3. WHILE the pointer is on a target, THE skeleton SHALL emit `dwell-progress` with a
   value from 0 to 1.
4. AFTER a selection, THE skeleton SHALL not select the same target again during the
   same stay, UNLESS the target allows auto-repeat. Auto-repeat is off by default.
5. WHERE a target allows auto-repeat, THE skeleton SHALL select it again while the stay
   continues, once per effective repeat interval: the larger of the auto-repeat interval
   and the post-selection pause.
6. AFTER any selection, THE skeleton SHALL select nothing during the post-selection
   pause.
7. WHEN the pointer is in the rest area or over no registered target, THE skeleton
   SHALL emit no selection.

---

## Requirement 4: Single-switch scanning

**User story:** As a person who can operate only one switch, I want options highlighted
in turn so that I can select one with my switch.

### Acceptance criteria

1. WHEN scanning is active, THE skeleton SHALL highlight items one at a time in a
   predictable order (reading order unless the app provides a custom order), advancing
   every scan interval.
2. THE skeleton SHALL support row-then-item scanning for grids: the first press picks
   a row, the second picks an item within it.
3. WHILE scanning inside a row, THE skeleton SHALL include a "back" item that returns
   to row scanning, and SHALL return to row scanning automatically after the profile's
   number of loops without a press.
4. EVERY scan cycle SHALL include a "cancel" item.
5. WHEN a switch is held for less than the acceptance time, THE skeleton SHALL ignore
   it. WHEN cancel-by-hold is on, a press is decided on release (see Requirement 6).
6. WHEN a press is counted, THE skeleton SHALL select the highlighted item (or enter
   the highlighted row) and then apply the post-selection pause.
7. WHEN a press arrives during the post-selection pause, THE skeleton SHALL ignore it.
8. WHEN scanning completes the profile's number of loops without a press, THE skeleton
   SHALL pause. The next counted press SHALL only resume scanning from the start and
   SHALL NOT select anything.
9. THE skeleton SHALL treat the profile's switch binding (a key, mouse button or
   gamepad button) or switch gesture as the switch input.

---

## Requirement 5: Face-gesture switch

**User story:** As a person who cannot move my hands and has limited head control, I
want to use a face movement as my switch so that I can scan and select with my face.

### Acceptance criteria

1. THE skeleton SHALL offer jaw open and brow raise as switch inputs, using the face
   model already running for the head pointer. The person chooses one in the profile's
   switch gesture field.
2. WHEN the gesture score rises above the person's threshold and stays there for the
   acceptance time, THE skeleton SHALL count one press (or, when cancel-by-hold is on,
   decide on release as in Requirement 6). For a gesture, release means the score
   falling below the release threshold.
3. THE skeleton SHALL not count another press until the score has fallen below the
   release threshold, so one long gesture counts as exactly one press.
4. IN head + gesture mode only, WHILE the gesture score is above the threshold, THE
   skeleton SHALL freeze the pointer, and the gesture SHALL select the target under the
   pointer at the moment the gesture started. (Opening the jaw or raising the brows
   moves the head, which would otherwise pull the pointer off the target.) In head +
   dwell mode the pointer SHALL never freeze for a face movement, so talking does not
   stop it.
5. THE calibration SHALL measure the person's resting and deliberate gesture scores and
   set both thresholds from them.
6. WHEN the face is not detected, THE skeleton SHALL count no gesture presses.
7. THE face-gesture switch SHALL work with scanning (Requirement 4) and, with the head
   pointer, in place of dwell.

---

## Requirement 6: Cancel and undo

**User story:** As a person using any input mode, I want to cancel or undo so that a
mistake can be fixed without outside help.

### Acceptance criteria

1. THE skeleton SHALL provide a cancel input in every mode:
   - head pointer: a cancel target the app places, selected by dwell or gesture;
   - scanning: the "cancel" item in every scan cycle;
   - switch or gesture: holding it until the cancel hold time (cancel-by-hold, which
     can be turned off in the profile for people whose presses are often long);
   - mouse and keyboard: the Escape key.
2. WHILE cancel-by-hold is on, THE skeleton SHALL decide each switch or gesture
   activation on release:
   - released after the acceptance time and before the cancel hold time: one press;
   - still held when the cancel hold time is reached: cancel, and no press is counted.
   This adds latency (a press counts on release, not at the acceptance time); the
   write-up and settings screen SHALL say so explicitly.
3. WHILE cancel-by-hold is off, THE skeleton SHALL count a press as soon as the
   acceptance time is reached.
4. WHEN cancel is triggered, THE engine SHALL return to idle (or to the top of the scan
   cycle) and emit `cancel`.
5. THE skeleton SHALL let the app offer an undo target that is reachable by dwell, by
   gesture and by scanning.
6. WHEN no samples arrive for longer than the input timeout, THE engine SHALL reset to
   idle; it SHALL never remain stuck mid-selection.

---

## Requirement 7: Calibration and profile

**User story:** As a person (or my carer), I want the input to fit my range of movement
and speed, and to keep those settings, so that it works for my body.

### Acceptance criteria

1. THE skeleton SHALL offer a calibration sequence that can be completed hands-free:
   the person looks at the centre and then at the screen edges in four directions
   (left, right, up, down). Each step advances when the head stays within the
   stillness threshold for the stillness time, OR after the step timeout, whichever
   comes first, so tremor cannot block it. During each hold-still step, THE skeleton
   SHALL measure the standard deviation of head rotation and, if it exceeds 0.5° on
   either axis, SHALL record `suggestHighTremor: true` in the calibration result so
   the UI can offer the high-tremor smoothing preset.
2. THE calibration SHALL produce four half-angle ranges (`rangeLeft`, `rangeRight`,
   `rangeUp`, `rangeDown`), gain, head dead zone and centre values, mapping the
   person's measured range of movement, down to the minimum supported range, to the
   whole screen.
3. THE profile SHALL hold every field in the Profile fields table.
4. THE skeleton SHALL save the profile on the device, and SHALL export and import it as
   a JSON file.
5. WHEN a profile is imported, THE skeleton SHALL clamp each value to the range in the
   Profile fields table, use the default for missing or invalid fields, and report what
   it changed. Fields whose range depends on another field SHALL be clamped after it,
   in this order: calibration ranges first, then dead zone (clamped to at most half the
   smallest calibration range), then cancel hold time, then both acceptance times, then
   the gesture threshold, then the release threshold.
6. WHEN a profile is imported, THE skeleton SHALL build the new profile only from the
   known field names in the Profile fields table, reading each field explicitly. It
   SHALL never spread, merge or copy the parsed object, so unknown fields and keys such
   as `__proto__` are silently ignored.
7. Exporting and then importing a valid profile SHALL return the same profile.

---

## Requirement 8: Camera and tracking failures

**User story:** As a person (or my carer), I want to know when the camera cannot be
used and to keep working without it, so that a camera problem does not leave me stuck.

### Acceptance criteria

1. THE skeleton SHALL detect and distinguish three failure cases:
   - **Permission denied**: the browser rejects `getUserMedia`.
   - **Load failure**: the MediaPipe WASM or model file fails to fetch or initialise.
   - **No-face timeout**: the camera starts and tracking runs, but no face is detected
     within the profile's no-face timeout.
2. FOR each failure case, THE skeleton SHALL:
   a. show a clear plain-language message that names the specific problem;
   b. emit `tracking-status` with the matching reason
      (`permission-denied`, `load-failed` or `no-face-timeout`);
   c. offer switch scanning and mouse mode as alternatives.
3. EVERY input mode except head pointing SHALL work without a camera. Scanning, mouse,
   keyboard switch and gamepad switch SHALL be available regardless of camera state.
4. AFTER a failure, THE skeleton SHALL allow the person or carer to retry the camera
   without reloading the page.

---

## Requirement 9: Deterministic engine

**User story:** As a developer (and as the dwell simulator), I want the engine to be
deterministic so that it can be tested with generated input and simulated users.

### Acceptance criteria

1. THE dwell, scanning, gesture, smoothing and calibration engines SHALL take time as
   an input and SHALL NOT read clocks, the DOM or devices.
2. EACH engine SHALL be a state machine with the shape `step(state, input, now)` that
   updates a small state object in place (no allocation per frame) and returns events.
   It SHALL provide `cloneState` so tests can branch and replay states.
3. GIVEN the same profile and the same timestamped samples, THE engine SHALL always
   produce the same events.
4. WHEN a sample's timestamp is equal to or earlier than the previous one, THE engine
   SHALL ignore it without changing state or emitting events.
5. THE engine SHALL behave identically at any frame rate: it measures elapsed time and
   never counts frames.
6. THE skeleton SHALL expose a way to feed recorded or synthetic samples instead of a
   live camera or switch. The dwell simulator SHALL use this public API and the real
   engine, never a reimplementation of it.

---

## Profile fields

Defaults and ranges are starting points chosen for the prototype, not clinical
standards. Adjust them after feedback from a therapist or real users.

Fields whose range depends on another field are clamped in this order on import:
calibration ranges → dead zone → cancel hold time → both acceptance times → gesture threshold → release threshold.

| Field | Default | Min | Max |
|---|---|---|---|
| mode | head + dwell | one of: head + dwell, head + gesture, scan, gesture scan, mouse | — |
| start camera on load | off | — | — |
| switch gesture | jaw open | one of: jaw open, brow raise | — |
| switch binding | Space key | one key, mouse button or gamepad button | — |
| head gain | 1.0 | 1.0 | 2.0 |
| head dead zone | 0.5 deg | 0 deg | 0.5 × min(rangeLeft, rangeRight, rangeUp, rangeDown) |
| smoothing strength | 0.5 | 0 | 1 |
| dwell time | 1000 ms | 400 ms | 3000 ms |
| grace time | 150 ms | 0 ms | 500 ms |
| post-selection pause | 500 ms | 200 ms | 3000 ms |
| auto-repeat interval | 1000 ms | 500 ms | 3000 ms |
| scan interval | 1200 ms | 500 ms | 5000 ms |
| scan loops before pause | 3 | 1 | 10 |
| switch acceptance time | 0 ms | 0 ms | 2000 ms (must be below cancel hold time) |
| gesture acceptance time | 300 ms | 100 ms | 2000 ms (must be below cancel hold time) |
| gesture threshold | from calibration, else 0.5 | 0.1 | 0.95 |
| gesture release threshold | from calibration, else 0.3 | 0.05 | threshold − 0.05 |
| cancel-by-hold | on | — | — |
| cancel hold time | 2000 ms | 1000 ms | 5000 ms |
| no-face timeout | 10 000 ms | 3000 ms | 60 000 ms |
| input timeout | 2000 ms | 500 ms | 10 000 ms |
| calibration range left | from calibration | 3 deg | 90 deg |
| calibration range right | from calibration | 3 deg | 90 deg |
| calibration range up | from calibration | 3 deg | 90 deg |
| calibration range down | from calibration | 3 deg | 90 deg |
| calibration stillness threshold | 2 deg | 0.5 deg | 6 deg |
| calibration stillness time | 1500 ms | 500 ms | 4000 ms |
| calibration step timeout | 6000 ms | 3000 ms | 20 000 ms |
| target size | 96 CSS px | 64 CSS px | 400 CSS px |
| target spacing | 16 CSS px | 8 CSS px | 64 CSS px |

---

## Properties for property-based tests

These must hold for any generated pointer path, switch timing, gesture scores and
valid profile.

1. **No quick-pass selection**: if the time the pointer spends on a target (counted
   only while on it, reset by any gap longer than the grace time) never reaches the
   dwell time, the target is never selected.
2. **One selection per stay**: a target without auto-repeat is selected at most once
   per stay.
3. **Face lost means no selection**: no `select` and no gesture press while the face is
   not detected.
4. **Cancel always works**: from any reachable state, a cancel input returns the engine
   to idle in one step and emits `cancel`.
5. **No stuck states**: after input stops, the engine reaches idle within the input
   timeout.
6. **Scan coverage**: with no presses, every item is highlighted once per loop, in
   order.
7. **Short presses ignored**: a press or gesture shorter than its acceptance time never
   counts.
8. **Pause respected**: no two selections are closer together than the post-selection
   pause.
9. **Resume does not select**: the first press after a scan pause never selects
   anything.
10. **Pointer bounded**: the pointer is always inside the screen, whatever the input.
11. **Every target reachable**: for any calibrated range at or above the minimum
    supported range and any head gain within range, every point on the screen can be
    reached.
12. **One gesture, one press**: a gesture held for any length counts as at most one
    press until the score falls below the release threshold.
13. **Gesture does not drift the selection**: a gesture-select picks the target under
    the pointer at the gesture's start, whatever the head does during the gesture.
14. **Moving targets keep progress**: `updateTarget` with a rectangle that still
    contains the pointer never resets dwell progress.
15. **Frame-rate independence**: for generated paths where every stay is more than
    67 ms (one 15 fps frame) away from the dwell time, every stay is longer than 67 ms,
    and the pointer stays more than 20 px from target edges, sampling at 15 fps and at
    60 fps produces the same selections, each within 67 ms of the other. Paths near
    these boundaries are covered by separate example tests, not this property.
16. **Bad timestamps ignored**: duplicate or backwards timestamps change nothing.
17. **Profile round-trip and clamping**: export then import returns the same valid
    profile; any imported value ends up inside its declared range, whatever order the
    fields appear in; unknown fields and `__proto__` keys never reach the profile.
18. **Cancel hold never selects**: with cancel-by-hold on, a hold that reaches the
    cancel hold time never produces a press or a `select`.
19. **Auto-repeat respects the pause**: repeated selections of the same target are
    never closer together than the larger of the auto-repeat interval and the
    post-selection pause.
20. **Talking does not freeze the pointer**: in head + dwell mode, gesture scores never
    freeze the pointer.
21. **Camera unavailable, other modes still work**: with the camera unavailable
    (permission denied, load failure or no-face timeout), scanning and mouse modes
    still produce selections without error.
