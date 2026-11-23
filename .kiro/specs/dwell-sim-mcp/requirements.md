# Requirements Document

Planchette Kit dwell simulator (MCP server)

## Introduction
The dwell simulator lets an app developer try a layout against simulated people before
any real person has to. Each simulated user is a movement model built from published
figures: how fast people point with their head (Fitts' law), how their head shakes
(tremor frequency and size) and how far they can turn. The simulator turns each
simulated user's head movement into camera samples and feeds them to the skeleton's
real engine through the public API. It then reports accidental selections, missed
selections and time-to-select, per user and per target.

It runs as an MCP server, so Kiro (or any MCP client) can call it while building an
app, and the Kiro power can use it in a hook. Head pointing with dwell is the main
mode. Scan mode is supported at lower priority.

Simulated users are models made from published group averages. They are not real
people and do not predict how any one person will do. The results are for comparing
layouts and settings, not for clinical decisions. The model is open loop: the
simulated user does not react to what the screen shows.

## Glossary
- **Simulated user**: a set of movement-model parameters (below) plus a random seed.
- **Preset**: a named simulated user shipped with the simulator, with every parameter
  traced to a source in the Figures table or marked as chosen.
- **Layout**: a screen size plus the targets, in the serialisable form returned by
  `getTargets()`.
- **Rest area**: a target with role `rest-area`, a screen area with no selectable
  target where the pointer can sit while the person rests.
- **Rest area start**: the position where the first task entry begins in every trial.
  WHERE the layout has a rest-area target, it is a point inside that target, reached
  by the start of session from the screen centre. Otherwise it is the screen centre.
- **Start of session**: the movement from the start point (the screen centre, where
  the warm-up ends) to the rest area, made as a normal movement: a reaction time, then
  a minimum-jerk path at the user's throughput. It happens before the first task entry
  and only where the layout has a rest-area target.
- **Task**: the sequence of targets the simulated user intends to select. Each entry
  of the task is one task entry.
- **Trial**: one run of one task by one simulated user with one seed.
- **Intended selection**: a `select` (or `cancel`, for a cancel-role target) on the
  target the simulated user is currently aiming for, once the simulated user is moving
  towards it or holding on it, and not during a reading pause.
- **Accidental selection**: every `select` or `cancel` the skeleton emits during a
  trial that is neither an intended selection nor a start-of-session event, including one
  on the right target before the user meant to select it (for example while still passing
  over it).
- **Start-of-session event**: a `select` or `cancel` the skeleton emits during the start
  of session or while the simulated user is waiting at the start (including the warm-up).
  It is not an accidental selection and is counted only in the per-user start-of-session
  line. Its activity label is `waiting` and its cause is `start`.
- **Activity label**: what the simulated user was doing at the time of an accidental
  selection or a start-of-session event. One of `waiting`, `moving`, `reading pause`,
  `holding on the aim point`.
- **Cause**: why an accidental selection happened. One of `reading-pause`,
  `pass-over`, `tremor-at-edge`, `repeat`, `waiting`, `early-on-intended-target`,
  `other`, `start`. The cause `start` is carried only by start-of-session events.
  "Tremor near an edge" is a cause, not an activity. Each accidental selection
  has exactly one activity label and exactly one cause from the seven causes other than
  `start`.
- **Miss**: a task entry whose intended target is not selected within the analysis
  window.
- **Analysis window**: the time, from the moment the simulated user starts moving
  towards a target, within which the intended selection must happen, else it is a miss.
  It is a measurement horizon, not a limit on the person. After a miss the simulated
  user moves on to the next task entry.
- **Time-to-select**: from the moment the simulated user starts moving towards a target
  to its intended selection.
- **Throughput (TP)**: Fitts' law throughput in bits per second, with the Shannon
  formulation and effective width (Soukoreff and MacKenzie 2004).
- **Index of difficulty (ID)**: log2(A / W + 1), with A the movement distance and W the
  target width along the movement.
- **Scatter cap**: a per-user parameter, SDcap in degrees, that limits the standard
  deviation of the end-point scatter. Default 0.6 degrees.
- **Tremor**: an involuntary rhythmic movement added on top of the intended movement,
  described by frequency (Hz), peak-to-peak size (degrees) and axis.
- **Reading pause**: the simulated user stops on a target they do not intend to select,
  for example to read it. This is the main cause of accidental dwell selections (the
  "Midas touch" problem).
- **Head range**: how far the simulated user can turn, per direction, in degrees.
- **Paired result**: in `compare`, the results of the same simulated user, the same
  seed and the same trial index in both configurations.
- **Mostly**: more than half (more than 50 %) of one target's accidental selections (or
  misses) in the run come from the named cause.
- **Commonly used target**: a target that makes up at least 20 % of the task entries.
- **On the path**: the straight segment between two consecutive intended targets
  passes within one target width of the target.
- **Follow-up run**: at most 3 extra runs at 1.25 times, 1.5 times and 2 times the
  current target size, stopping at the first run with no accidental selections and no
  misses on that target.
- **Press duration**: in scan mode, how long the simulated user holds the switch. With
  cancel-by-hold on (the default) the skeleton registers the press on release, so the
  press duration must be shorter than `cancelHoldTime`.

## Movement model (what each simulated user does)
Before the trial counts, the simulated user is calibrated to their own head range (see
Requirement 11). WHERE the layout has a rest-area target, the simulated user then makes
the start-of-session movement from the screen centre to a point inside it, before the
first task entry; WHERE not, the simulated user stays at the screen centre. Time spent
in the start of session is not counted in time-to-select. For each target in the task, the simulated user:
1. Waits a reaction time.
2. Picks an aim point inside the target. The scatter of aim points around the target
   centre has standard deviation SD = min(W / 4.133, SDcap), the same on both axes,
   truncated at ±3 SD. W is the target width along the axis.
3. Moves their head to the aim point along a minimum-jerk path (Flash and Hogan 1985),
   with the movement time given by Fitts' law: MT = ID / TP.
4. Holds still on the aim point until the target is selected or the analysis window
   runs out.

On top of this:
- **Tremor** adds a sinusoid at the user's tremor frequency and size to one axis (yaw
  by default, or pitch where the user is set to pitch), with a random phase and a slow
  random drift of its size. One axis is used because [8] measured the single principal
  axis of head tremor, so applying the full size to both axes would overstate it.
- **Head range** clamps every head angle to the user's range.
- **Reading pauses** happen on non-intended targets on the path, with a chosen chance
  and length.
- **Tracking noise** adds small random jitter to the angles, standing in for the face
  tracker's own noise.

Head angles are turned into camera samples (`source: 'camera'`, one face with `bbox`,
`rotation` and `confidence`) at the chosen frame rate, and fed through `feedSamples`.
The rotation is the engine-level rotation: the simulator does not model the camera
adapter's rotation maths. The skeleton's own smoother, mapping, dwell and scanning
engines do the rest. The simulated user's profile (calibration range, gain, dwell time
and so on) is set with `setProfile` before the trial.

## Requirements

### Requirement 1: Use the real engine

**User Story:** As a developer, I want the simulator to test the real skeleton, so that
its results apply to the code my app actually runs.

#### Acceptance criteria
1. THE simulator SHALL drive the skeleton only through its public API
   (`createPlanchette`, `setProfile`, `setScreen`, `registerTarget`, `feedSamples`
   and events). It SHALL NOT copy or reimplement any engine logic.
2. WHEN the simulator runs a head-pointing trial, THE simulator SHALL convert simulated
   head movement into camera samples and pass them to the skeleton through
   `feedSamples`, so that the skeleton's smoother and mapping process every sample used
   in the trial.
3. WHEN a trial starts in a mode that has a centre step, THE simulator SHALL hold the
   simulated head still at the centre from the first camera sample until the skeleton
   emits the `calibration-step` event with run `centre` and step `done`. That event
   follows `calibrationStillnessTime` of stillness within `calibrationStillnessThreshold`,
   or comes at `calibrationStepTimeout`.
4. THE simulator SHALL create a new `createPlanchette` instance for every trial and
   SHALL NOT reuse an instance, or any state held by an instance, from another trial.
5. THE simulator SHALL exclude the time from the first camera sample until that
   `calibration-step` event from every trial result.
6. WHILE a trial is in scan mode, THE simulator SHALL start the trial without holding
   the head still at the centre and without waiting for a centre step, because scan mode
   has no centre step.

### Requirement 2: Movement models from published figures

**User Story:** As a developer, I want each simulated user to be grounded in published
figures, so that I can trust what the simulator says and check it myself.

#### Acceptance criteria
1. WHEN the simulator computes the movement time of a movement, THE simulator SHALL use
   Fitts' law (Shannon formulation, MT = ID / TP) with the simulated user's throughput
   TP, and SHALL model end-point scatter with the per-user scatter cap, as in the
   Movement model section.
2. WHEN the simulator moves the head between a start point and an aim point, THE
   simulator SHALL use a minimum-jerk path: the position at normalised time t (0 to 1)
   equals start + (aim − start) × (10t³ − 15t⁴ + 6t⁵).
3. THE simulator SHALL add tremor as a sinusoid with the simulated user's frequency and
   peak-to-peak size on one axis, yaw unless the user's tremor axis is set to pitch,
   with a random phase per trial.
4. WHEN the simulator produces a head angle, THE simulator SHALL clamp it to the
   simulated user's head range.
5. THE simulator SHALL give every preset parameter either a citation to an entry in the
   Figures table or the mark "chosen" with a one-line reason.
6. THE simulator package SHALL include a methodology document
   (`tools/dwell-sim-mcp/METHODOLOGY.md`) that lists every figure with its source and a
   link to that source, states for each derived value how it was worked out, and lists
   what the model leaves out, including every limit listed under Out of scope.
7. WHEN the `list_users` tool is called, THE `list_users` tool SHALL return each preset
   parameter with its citation or its "chosen" reason.

### Requirement 3: Presets

**User Story:** As a developer who is not a clinician, I want ready-made simulated
users, so that I can test a layout without choosing every parameter myself.

#### Acceptance criteria
1. THE simulator SHALL ship at least these presets (parameters in the Presets table):
   `steady`, `slow`, `head-tremor`, `strong-head-tremor`, `small-range` and
   `reads-while-pointing`.
2. WHERE a custom simulated user is requested, THE simulator SHALL accept it with any one
   or more parameters overridden, provided each overridden parameter is within its range
   listed under "Custom ranges" in the Presets section.
3. IF a custom parameter is outside its range under "Custom ranges", THEN THE simulator
   SHALL reject the request with an error message naming the parameter and its range,
   and SHALL NOT create the custom simulated user.
4. THE `list_users` tool SHALL take no inputs.
5. WHEN `list_users` is called, THE `list_users` tool SHALL return every preset with its
   parameters (throughput, tremor frequency, size, axis and drift, head range, reaction
   time, reading-pause chance and length, tracking noise, scatter cap).
6. IF a request names a preset that does not exist, THEN THE simulator SHALL return an
   error naming the unknown preset and listing the valid preset names.
7. WHEN `list_users` is called, THE `list_users` tool SHALL return, for each parameter of
   each preset, either its citation (a Figures table row and reference number) or the
   word "chosen" together with a one-line reason.
8. WHEN `list_users` is called, THE `list_users` tool SHALL return the allowed ranges for
   custom users, one range per custom parameter, matching "Custom ranges" in the Presets
   section.

### Requirement 4: The simulate tool

**User Story:** As a developer, I want to run my layout against simulated users and get
a clear report, so that I can find targets that are too small, too close or too easy
to select by accident.

#### Acceptance criteria
1. THE MCP server SHALL provide a `simulate` tool that accepts these parameters: a layout
   (screen size and targets as from `getTargets()`), an optional profile (partial,
   clamped by the skeleton), an input mode (`head + dwell`, or `scan` where supported),
   a list of simulated users (preset names or custom), a task (an explicit list of
   target ids, or "each target N times in random order"), trials per user, a frame rate
   (15, 30 or 60 fps), an analysis window (caller-set, default 10 s, range 2 to 120 s)
   and a seed (default 1).
2. THE `simulate` tool SHALL return, per simulated user: the count of intended
   selections, the count of accidental selections (not including start-of-session
   events), the accidental selection rate per 100 intended selections (accidental
   selections divided by intended selections, times 100), the count of misses, and
   time-to-select (median and 90th percentile), plus the same figures per target.
3. THE `simulate` tool SHALL list in its result each accidental selection with the
   target, the time, its activity label and its cause.
4. THE `simulate` tool SHALL include in its result the seed and the full parameters used,
   so that a run with the same seed and parameters produces an identical result.
5. THE `simulate` tool SHALL include in its result the sentence: "Simulated users are
   models from published group averages, not real people. Use these results to compare
   layouts and settings."
6. IF the layout has no selectable targets (no targets, or only rest-area targets), or a
   task names a target id that is not in the layout, THEN THE simulator SHALL return an
   error naming the problem and SHALL NOT return a report.
7. WHERE the input mode is `scan`, WHEN the scan highlight reaches the intended item, THE
   simulator SHALL press the switch after the simulated user's scan reaction time listed
   in the Presets section.
8. WHERE the input mode is `scan`, THE simulator SHALL hold the switch for the user's
   press duration, using the scan reaction time, late-press chance and press duration
   listed in the Presets table.
9. WHEN the skeleton emits a `select` or `cancel` event during a trial, THE simulator
   SHALL classify it exactly once, as an intended selection, an accidental selection or
   a start-of-session event.
10. THE simulator SHALL give every accidental selection exactly one activity label from
    the Glossary set and exactly one cause from the Glossary set other than `start`.
11. IF a `select` or `cancel` event occurs during the start of session or while the
    simulated user is waiting at the start, THEN THE simulator SHALL count it as a
    start-of-session event with the activity label `waiting` and the cause `start`, and
    SHALL NOT count it as an accidental selection.
12. WHEN a task entry is intended, THE simulator SHALL resolve it exactly once, as an
    intended selection or a miss.
13. IF a rate or percentile has no data (for example the rate per 100 intended
    selections when there are no intended selections, or a median time-to-select when
    nothing was selected), THEN THE simulator SHALL return null for it and SHALL NOT
    return a number.
14. WHEN a run uses tremor above 1 degree peak to peak (the size input-core's smoothing
    is tuned for), THE `simulate` tool SHALL include in its result a note stating that
    the tremor exceeds the size the smoothing is tuned for.
15. WHEN the input mode is `head + dwell` and the layout has no rest-area target, THE
    `simulate` tool SHALL include in its result a warning that names the missing rest
    area and cites the accessibility rule (every layout has a rest area).
16. WHEN the input mode is `head + dwell` and the layout has no cancel-role target, THE
    `simulate` tool SHALL include in its result a warning that names the missing cancel
    target and cites the accessibility rule (head-pointer layouts place a cancel
    target).
17. IF the input mode is `head + gesture`, `gesture scan` or `mouse`, THEN THE simulator
    SHALL return an error that names the mode and lists the supported modes
    (`head + dwell` and `scan`).
18. IF the frame rate is not 15, 30 or 60, THEN THE simulator SHALL return an error
    naming the frame rate parameter and its allowed values.
19. IF the analysis window is outside 2 to 120 s, THEN THE simulator SHALL return an
    error naming the analysis window and its range.
20. IF a request has more than 12 simulated users, THEN THE simulator SHALL return an
    error naming the parameter and its cap of 12.
21. IF a request has more than 50 trials per user, THEN THE simulator SHALL return an
    error naming the parameter and its cap of 50.
22. IF a layout has more than 100 targets, THEN THE simulator SHALL return an error
    naming the parameter and its cap of 100.
23. IF a task has more than 500 entries, THEN THE simulator SHALL return an error
    naming the parameter and its cap of 500.
24. WHERE the input mode is `scan`, WHEN the scan highlight reaches the intended item,
    THE simulator SHALL press the switch one item late with the late-press chance listed
    in the Presets section for that user.
25. THE `simulate` tool SHALL report, per simulated user, a "start of session" line
    holding the count of start-of-session events and their count per target
    (`byTarget`), and SHALL NOT include those events in the count of accidental
    selections or in the accidental selection rate per 100 intended selections
    (criterion 2).
26. IF an explicit task lists the same target id twice in a row and that target does not
    have `autoRepeat`, THEN THE simulator SHALL return a validation error naming the
    position (the zero-based index of the second entry) and the target id, and SHALL NOT
    return a report.
27. WHEN the task is "each target N times in random order" and the layout has more than
    one selectable target, THE simulator SHALL NOT place the same target twice in a row.
28. IF the task is "each target N times in random order", N is greater than 1, and the
    layout has exactly one selectable target that does not have `autoRepeat`, THEN THE
    simulator SHALL return a validation error naming position 1 (the zero-based index of
    the second entry) and that target id, and SHALL NOT return a report.
29. WHERE the task is "each target N times in random order" and the layout has exactly
    one selectable target that has `autoRepeat`, THE simulator SHALL use N entries of
    that target without shuffling.

### Requirement 5: Compare two settings

**User Story:** As a developer, I want to compare two profiles or two layouts on the
same simulated users, so that I can see whether a change helps.

#### Acceptance criteria
1. THE MCP server SHALL provide a `compare` tool that runs two configurations (two
   profiles, or two layouts with the same target ids) with the same simulated users,
   seeds and random draws, changing only what differs between them.
2. THE `compare` tool SHALL report paired results per trial and, for each of accidental
   selections, misses and time-to-select, how many trials each configuration won and
   how many were ties.
3. WHEN the two configurations have won different numbers of trials on a metric, THE
   `compare` tool SHALL say that the configuration with more wins did better on that
   metric.
4. WHEN the two configurations have won equal numbers of trials on a metric, THE
   `compare` tool SHALL report a tie on that metric.
5. THE `compare` tool SHALL report time-to-select for a pair only when both
   configurations selected the target in that pair.
6. THE `compare` tool SHALL NOT claim statistical significance.
7. WHERE the two configurations differ only in selection-timing profile fields
   (`dwellTime`, `graceTime`, `postSelectionPause`, `autoRepeatInterval`,
   `smoothingStrength`), THE `compare` tool SHALL give both configurations the same
   head-angle samples, for each paired result, up to the first differing `select` or
   `cancel` event in that pair.
8. WHERE the two configurations differ in any field other than those listed in criterion
   7 (for example gain, dead zone, ranges or layout), THE `compare` tool SHALL give both
   configurations the same random draws and SHALL NOT guarantee the same head-angle
   samples.

### Requirement 6: Suggestions

**User Story:** As a developer, I want plain suggestions, so that I know what to change.

#### Acceptance criteria
1. WHEN more than 50 % of a target's accidental selections in the run have the cause
   `reading-pause`, THE simulator SHALL suggest a longer dwell time or moving the target
   away from the path to commonly used targets.
2. WHEN more than 50 % of a target's misses or accidental selections in the run have the
   cause `tremor-at-edge`, THE simulator SHALL suggest a larger target or more spacing.
3. WHEN a target is outside the reach of a simulated user's head range, THE simulator
   SHALL state that the target is outside that user's head range and SHALL suggest a
   higher head gain or moving the target.
4. THE simulator SHALL name, in each suggestion, the metric and the simulated users that
   triggered it.
5. WHERE a follow-up run was made for a target, THE simulator SHALL include in the
   suggestion for that target the size, as a multiple of the current target size (1.25,
   1.5 or 2), of the first follow-up run that had no accidental selections and no misses
   on that target.
6. IF no result in the run supports a suggestion, THEN THE simulator SHALL NOT make that
   suggestion.
7. IF a target has fewer than 3 events (accidental selections or misses) in the run,
   THEN THE simulator SHALL NOT make an event-based suggestion for that target.
   Clarification: the unreachable rule (AC 3), like the centre rule (AC 10), comes from geometry, not events, so the 3-event minimum does not apply to it.
8. WHEN a suggestion for a target is made under criterion 2, THE simulator SHALL make a
   follow-up run for that target.
9. IF no follow-up run for a target has zero accidental selections and zero misses on
   that target, THEN THE simulator SHALL make the suggestion for that target without a
   follow-up size.
10. WHEN the screen centre lies inside a selectable target (the start of session begins
    there when the layout has a rest area, and the user stays there when it has none),
    THE simulator SHALL suggest keeping the screen centre empty or putting the rest area
    there. This applies both to a layout with a rest-area target and to a layout
    without one, and criterion 7 does not limit it.

### Requirement 7: Determinism and speed

**User Story:** As a developer, I want the same request to give the same answer, so
that I can trust a change in the result.

#### Acceptance criteria
1. THE simulator SHALL draw every random choice from a seeded random number generator
   and SHALL NOT draw random values from any unseeded source.
2. THE simulator SHALL use simulated time only. It SHALL NOT read the real clock or wait
   in real time during a simulation run.
3. WHEN the `simulate` tool runs 6 presets × 10 trials × 20 selections at 30 fps, THE
   simulator SHALL finish the run in under 10 seconds of wall-clock time on a typical
   laptop.
4. WHEN the simulator receives the same request with the same seed, THE simulator SHALL
   return a result identical in every field to the result of any earlier run of that
   request with that seed.

### Requirement 8: Runs locally

**User Story:** As a developer, I want the simulator to stay on my machine, so that my
app's layout is not sent anywhere.

#### Acceptance criteria
1. THE MCP server SHALL use the stdio transport, and while it is running SHALL open no
   outbound network connection and no listening network socket.
2. WHEN a developer runs `npx dwell-sim-mcp` or `npm run sim` from the repo root, THE MCP
   server SHALL start and accept MCP requests over stdio.
3. THE MCP server SHALL import only these packages, directly or transitively:
   `@modelcontextprotocol/sdk` (already approved), the packages the SDK requires, `zod`
   (only if the SDK needs it for tool schemas, and approved only if its licence is MIT),
   `fast-check` and `vitest` (both already approved and declared in the package), and
   the skeleton.
4. THE simulator's README SHALL document the start command (`npx dwell-sim-mcp` or
   `npm run sim`).
5. WHEN a new dependency is added to the simulator project, THE simulator project SHALL
   record in `THIRD_PARTY.md` that dependency's name, its licence and its exact pinned
   version (no version range).
6. THE simulator's README SHALL include the Kiro MCP configuration snippet.
7. IF a dependency is needed that criterion 3 does not list, THEN THE simulator project
   SHALL NOT add it until the user has approved it.

### Requirement 9: Skeleton additions

**User Story:** As a developer of the simulator, I want the skeleton to expose its
pointer mapping and richer cancel events, so that the simulator uses the one real
mapping and can tell what caused a cancel. This requirement is the first work in the
task list.

#### Acceptance criteria
1. THE skeleton SHALL export, through `skeleton/src/index.ts`, the pure helpers
   `pointToRotation` and `rotationToPoint`, where `pointToRotation` takes a profile, a
   screen size, a centre and a screen point and returns a head rotation (yaw and pitch),
   and `rotationToPoint` takes a profile, a screen size, a centre and a head rotation and
   returns a screen point. Both helpers SHALL return the same output for the same inputs
   and SHALL NOT modify their inputs or any other state.
2. THE skeleton SHALL implement the pointer mapping (dead zone, calibration ranges, head
   gain, clamp, round to integer px, with pitch > 0 moving the pointer up and yaw > 0
   moving it right) in one code location, and the helpers and the head-pointer engine in
   `skeleton/src/engine/head-pointer.ts` SHALL both call that code, so that no second
   copy of the mapping exists in the skeleton.
3. THE skeleton SHALL include a property test asserting that, for any valid profile, any
   screen size and any point `p` in the reachable area,
   `rotationToPoint(pointToRotation(p))` is within 1 px of `p` on each axis. The
   tolerance exists because the mapping rounds to integer px.
4. THE skeleton SHALL include a property test asserting that, for any valid profile, any
   screen size and any head rotation, `rotationToPoint` returns the same point as the
   `pointer-move` event that the head-pointer engine emits for that rotation.
5. WHEN the skeleton emits a `cancel` event, THE skeleton SHALL include in the payload a
   `now` timestamp and, only if a target caused the cancel, a `targetId` equal to the id
   of that target. THE skeleton SHALL omit `targetId` when the cancel comes from the scan
   virtual cancel item or from the Escape input.
6. WHEN the skeleton emits a `cancel` event to an existing listener that ignores the
   payload, THE skeleton SHALL call that listener exactly once for that event, as before
   the payload was extended, without the listener throwing an error.
7. THE simulator SHALL import the skeleton only through the public API (Requirement 1).

### Requirement 10: Packaging

**User Story:** As a developer, I want the simulator to build and test with the rest of
the repo, so that it does not rot.

#### Acceptance criteria
1. THE simulator package SHALL be listed in the `workspaces` field of the root
   `package.json`.
2. WHEN `npm test` runs at the repo root, THE test run SHALL execute the simulator's
   tests and include their pass or fail results in the overall exit status.
3. WHEN the typecheck runs at the repo root, THE typecheck SHALL include the simulator's
   source files and report their type errors in the overall exit status.
4. THE simulator package SHALL document in its README that it requires a built skeleton,
   because the skeleton's package exports point to `dist`.
5. THE simulator package SHALL declare Node 20 or later (for the `CustomEvent` global;
   the repo is on Node 24 types) in the `engines` field of its `package.json`.
6. THE simulator package's README SHALL state the command that builds the skeleton.

### Requirement 11: Movement-model behaviour

**User Story:** As a developer, I want the movement model's behaviour stated in
testable terms, so that I know what each result is based on.

#### Acceptance criteria
1. WHEN a trial starts, THE simulator SHALL set the profile's `calibrationRangeLeft`,
   `calibrationRangeRight`, `calibrationRangeUp` and `calibrationRangeDown` to the user's
   head range in the corresponding direction, for each of these fields that the caller's
   profile does not set.
2. WHEN a trial starts and the caller's profile sets a calibration range larger than the
   user's head range, THE simulator SHALL treat each target that the user's head range
   cannot reach as unreachable.
3. WHEN the simulated user starts a task entry, THE simulator SHALL make the simulated
   user wait for the user's reaction time before the simulated user begins moving.
4. THE simulator SHALL draw each aim point independently on each axis from a
   distribution with SD = min(W / 4.133, SDcap), truncated at ±3 SD, where W is the
   target width along that axis and SDcap is the user's scatter cap (default 0.6
   degrees).
5. WHILE tremor is on, THE simulator SHALL vary the tremor size by a random drift that
   keeps the size within ±20 % of the nominal size and changes over a period of about
   5 s.
6. WHEN the head path's pointer positions enter the rectangle of a target that is not the
   intended target and is on the path, THE simulator SHALL start a reading pause at that
   target with probability equal to the user's reading-pause chance.
7. THE simulator SHALL NOT start a reading pause on the intended target.
8. THE simulator SHALL add tracking noise to the head angles as random jitter whose size
   is the user's tracking-noise size.
9. WHERE the layout has a rest-area target, THE simulator SHALL make the simulated user
   perform the start-of-session movement (a reaction time, then a minimum-jerk path at
   the user's throughput) from the screen centre to a point inside the rest-area target
   before the first task entry, and SHALL NOT count the movement time in any
   time-to-select.
10. WHERE the layout has no rest-area target, THE simulator SHALL place the simulated
    user at the screen centre at the start of each trial.
11. WHEN a task entry is missed, THE simulator SHALL move the simulated user on to the
    next task entry.
12. WHEN a trial starts and no calibration range set by the caller's profile is larger
    than the user's head range, THE simulator SHALL treat every target as reachable.
13. WHEN a reading pause starts, THE simulator SHALL set its duration to a value drawn
    uniformly from the user's reading-pause length range (300 to 900 ms for
    `reads-while-pointing`).

### Requirement 12: Final results on the skeleton demo

**User Story:** As the project owner, I want the simulator run on the real demo layout,
so that the results are on record.

#### Acceptance criteria
1. WHEN the simulator project is run against the skeleton demo page layout (Task 17 of
   input-core, exported with `getTargets()` through the page's `window.planchetteDemo`
   hook), THE simulator project SHALL execute all six presets, each exactly once,
   against the target list that `getTargets()` returns.
2. WHEN the run of all six presets completes, THE simulator project SHALL record the
   results in `docs/kiro-journal.md`, with one result entry per preset (six entries in
   total).

## Properties (property-based tests)
1. **Deterministic**: the same request and seed give the same result, and the result
   holds no wall-clock fields.
2. **Clean run, no accidents, no misses**: with tremor, tracking noise and reading
   pauses off, no `autoRepeat` targets, scatter truncated at ±3 SD with the per-user SD
   cap, every target at least 6 SD wide on both axes, the screen centre outside every
   selectable target, `smoothingStrength` at the default 0.5, dwell time at least the
   longest planned crossing time of any non-intended target (the planned crossing times
   include the start-of-session path) plus a margin of L + F(fps) = 150 ms + 1000 / fps
   (F: one frame. L = 150 ms is used as an allowance for stay length: the smoother's lag
   delays both the entry into and the exit from a target, so a stay's length is shifted
   by less than either. It is not a proven bound for this motion),
   an analysis window above reaction time + movement time + dwell
   time + post-selection pause, and every target reachable: each intended target is
   selected exactly once, with no accidental selection and no miss.
3. **Unreachable means miss**: in head modes, with the profile's calibration ranges set
   above the user's head range, a target whose rectangle contains no pointer position
   reachable within the head range (computed with the skeleton's mapping helpers) gets
   no `select` or `cancel` event at all, and every intended entry for it is a miss. A
   partly reachable target is not covered.
4. **Every event is accounted for**: intended selections + accidental selections +
   start-of-session events (from the start of session and the wait at the start) equal
   all `select` and `cancel` events the skeleton emitted during the trials, counted by a
   listener that is independent of the classifier. The three categories do not overlap.
5. **Same random draws when comparing**: in `compare`, both configurations consume the
   same random draws. If they differ only in `dwellTime`, `graceTime`,
   `postSelectionPause`, `autoRepeatInterval` or `smoothingStrength`, the head-angle
   samples are identical up to the first differing `select` or `cancel` event
   (`dwell-progress` events are not compared).
6. **Longer dwell, fewer reading-pause accidents** (two parts):
   (a) a stay on a target shorter than `dwellTime` never produces a `select` on it;
   (b) for a fixed (open-loop) sample stream with no `autoRepeat` targets, where
   consecutive non-intended stays are at least d_new + `postSelectionPause` apart,
   raising `dwellTime` from d_old to d_new never increases the accidental count, and
   every accident under d_new is also an accident under d_old.
   Known counterexample that the restriction in (b) excludes: d1 = 1000 ms,
   d2 = 1200 ms, `postSelectionPause` 500 ms. Stay S1 from 0 to 1000 ms selects under d1
   and starts a pause to 1500 ms. Stay S2 from 1100 to 2400 ms (a 900 ms reading pause
   inside it) does not select under d1 (the 900 ms counts), but selects at 2300 ms under
   d2, because S1 no longer starts a pause.
7. **Frame rate**: with tremor, tracking noise, reading pauses and `autoRepeat` targets
   off, meeting input-core P15's boundary conditions B1, B2, B4 and B5 (B3 is replaced
   by the assertions below), `smoothingStrength` at the default 0.5 and B4 generated by
   construction (`postSelectionPause` drawn first, `reactionTimeMs` in
   [max(150, `postSelectionPause`), 1500]):
   (a) 15 fps and 60 fps give the same ordered list of `(entry, targetId)` intended
   selections;
   (b) for every selected entry at both frame rates,
   `tts − arrival = ceil(dwellTime / F) × F` within 1e-6 ms, with F = 1000 / fps and
   `arrival = max(first frame on which the pointer is inside the target in the unbroken
   run ending at the select, first frame at or after the end of the preceding
   post-selection pause)`.
   Time-to-select across frame rates is reported, not bounded: the smoother's arrival
   lag depends on the frame rate for slow, smooth movement, and nothing in the skeleton
   bounds that dependence. The test prints the largest `|tts15 − tts60|` and the largest
   single-entry `D = |(arrival15 − tMove0_15) − (arrival60 − tMove0_60)|`.
8. **Each task entry resolves once**: intended selections + misses = task length.

## Figures (sources)
| Figure | Value | Source |
|---|---|---|
| Fitts' law, Shannon formulation; effective width We = 4.133 × SD of end points; throughput = IDe / MT | method | Soukoreff and MacKenzie 2004 [1]; MacKenzie 1992 [2] |
| Head pointing throughput, people without motor impairments, head-mounted display (41 people; mean over click and dwell groups; 300 ms dwell in the dwell group) | 2.47 bits/s (mouse 3.24, gaze 2.13); time to activate 850 ms. Upper bound, context only: not used by a preset. | Hansen et al. 2018 [3] |
| Head effective width, same study | about 72 px (about 2.5 degrees). Used for the scatter cap. Derivation: SD = We / 4.133 = 72 / 4.133 = 17.4 px; 2.5 / 4.133 = 0.6 degrees. | Hansen et al. 2018 [3] |
| Head pointing throughput with a phone's front camera | 0.61 bits/s with motor impairments, 0.90 bits/s without; IDs 1.62–5.20 bits | Cicek et al. 2020 [4] |
| Head pointing throughput, mobile head tracker | 1.42 bits/s. Used by `steady`. | Roig-Maimó et al. 2018 [5] |
| Minimum-jerk movement path | method | Flash and Hogan 1985 [6] |
| Frequency of most pathological tremors | 4–8 Hz | Bhatia et al. 2018 [7] |
| Physiological tremor | 8–12 Hz | Bhatia et al. 2018 [7] |
| Parkinsonian rest tremor | 4–7 Hz | Bhatia et al. 2018 [7] |
| Intention (cerebellar) tremor | below 5 Hz | Bhatia et al. 2018 [7] |
| Head tremor, essential tremor (n = 78) | peak 4.25 ± 0.88 Hz; 12.3 ± 15.3 deg/s between successive extrema | Berbakov et al. 2019 [8] |
| Head tremor, cervical dystonia (n = 96) | peak 4.37 ± 1.22 Hz; 7.77 ± 6.72 deg/s | Berbakov et al. 2019 [8] |
| Head tremor size in degrees (derived) | ET mean ≈ 0.46° peak to peak; CD mean ≈ 0.28°. "ET mean + 2 SD = 1.6°" is chosen, not a percentile, because the SD exceeds the mean. | Derived from [8]: peak-to-peak degrees = (deg/s between successive extrema of the angular-velocity signal) / (2π f). The paper defines amplitude as the difference between successive extrema of the angular-velocity signal, measured on the first principal axis after band-pass filtering around the peak frequency. |
| Minimum supported head range | ±3° | input-core requirements (MIN_RANGE, our own constant) |
| Reference head range | ±15° | chosen (our own default calibration constant, not a published human range) |

The derived tremor sizes assume a pure sinusoid at the peak frequency. Real tremor is
less regular, and in cervical dystonia often irregular. METHODOLOGY.md must say so.

## Presets
| Preset | Throughput | Tremor | Head range | Reading pauses | Tracking noise |
|---|---|---|---|---|---|
| `steady` | 1.42 bits/s [5] | none | ±15° (chosen) | none | 0° (chosen) |
| `slow` | 0.61 bits/s [4] | none | ±15° (chosen) | none | 0° (chosen) |
| `head-tremor` | 0.90 bits/s (chosen pairing) [4] | 4.25 Hz, 0.46° p-p, yaw [8] | ±15° (chosen) | none | 0° (chosen) |
| `strong-head-tremor` | 0.90 bits/s (chosen pairing) [4] | 4.25 Hz, 1.6° p-p, yaw (chosen, ET mean + 2 SD) [8] | ±15° (chosen) | none | 0° (chosen) |
| `small-range` | 0.90 bits/s (chosen pairing) [4] | none | ±3° (input-core minimum) | none | 0° (chosen) |
| `reads-while-pointing` | 0.90 bits/s (chosen pairing) [4] | none | ±15° (chosen) | 30 % chance per passed target, 300–900 ms uniform (chosen) | 0° (chosen) |

Parameters shared by every preset:

| Parameter | Value | Source or reason |
|---|---|---|
| Reaction time | 500 ms | chosen: a choice reaction time for a user who has to pick the next target |
| Tremor size drift | random walk keeping the size within ±20 % of nominal, changing over about 5 s | chosen: tremor size varies slowly in real recordings, but [8] gives no figure |
| Scatter cap | 0.6° | Figures table, Hansen head effective width row [3] |
| Scan switch reaction time | 500 ms | chosen: same as reaction time |
| Scan late-press chance | 10 % | chosen: one item late, to exercise scan interval settings |
| Scan press duration | 150 ms | chosen: must be below `cancelHoldTime` (minimum 1000 ms) |

Request defaults: frame rate 30 fps; analysis window 10 s; seed 1.

## Chosen values
| Value | Reason |
|---|---|
| Throughput pairing 0.90 bits/s for `head-tremor`, `strong-head-tremor`, `small-range`, `reads-while-pointing` | One shared base, so each preset differs in one feature |
| Head range ±15° | Our own default calibration constant, not a published human range |
| Reading pauses: 30 % chance per passed target, 300–900 ms uniform | The low end is below the 400 ms minimum dwell and the high end is below the 1000 ms default, so it exercises dwell settings |
| Tracking noise 0° | Not measured yet; input-core Task 14.9 will measure it from our own face clip in `test-media/`, then replace it |
| Reaction time 500 ms | A choice reaction time for a user who has to pick the next target |
| Tremor size drift | Tremor size varies slowly in real recordings, but [8] gives no figure |
| Strong tremor size 1.6° p-p | ET mean + 2 SD; the SD exceeds the mean, so this is not a percentile |
| Tremor axis yaw | [8] measured the single principal axis of head tremor, so applying the full size to both axes would overstate it |
| Scan reaction time, late-press chance, press duration | See the shared parameters table |
| Analysis window default 10 s | Slow users at ID 5.2 need 8.5 s of movement, so callers can raise it up to 120 s |

Custom ranges (chosen, to cover the figures above with margin): throughput 0.3–4
bits/s; tremor 0–15 Hz and 0–5° peak to peak; head range 3–60° per direction; reaction
time 150–1500 ms; reading-pause chance 0–100 %, length 0–3000 ms; scatter cap 0.1–3°;
tracking noise 0–2°; analysis window 2–120 s.

## Out of scope
- Eye tracking, hand pointing and touch.
- Fatigue over a long session, learning effects, and changes in a person's condition.
- Users who react to on-screen feedback, and camera delay. The model is open loop.
- Tracking dropouts (face lost).
- MediaPipe and the camera adapter's rotation maths. The simulator feeds engine-level
  rotation.
- Loading a live web page. The layout comes from `getTargets()`; the app or a hook
  exports it.
- Any claim about a specific condition or person. Presets are named after movement
  features, not diagnoses.

## References
1. Soukoreff RW, MacKenzie IS. Towards a standard for pointing device evaluation,
   perspectives on 27 years of Fitts' law research in HCI. *International Journal of
   Human-Computer Studies* 61 (2004) 751–789.
2. MacKenzie IS. Fitts' law as a research and design tool in human-computer
   interaction. *Human-Computer Interaction* 7 (1992) 91–139.
3. Hansen JP, Rajanna V, MacKenzie IS, Bækgaard P. A Fitts' law study of click and
   dwell interaction by gaze, head and mouse with a head-mounted display. COGAIN @
   ETRA 2018. doi:10.1145/3206343.3206344. https://www.yorku.ca/mack/etra2018.html
4. Cicek M, Dave A, Feng W, Huang MX, Haines JK, Nichols J. Designing and evaluating
   head-based pointing on smartphones for people with motor impairments. ASSETS 2020.
   doi:10.1145/3373625.3416994.
   https://research.google/pubs/designing-and-evaluating-head-based-pointing-on-smartphones-for-people-with-motor-impairments/
5. Roig-Maimó MF, MacKenzie IS, Manresa-Yee C, Varona J. Head-tracking interfaces on
   mobile devices: evaluation using Fitts' law and a new multi-directional corner task
   for small displays. *International Journal of Human-Computer Studies* 112 (2018)
   1–15. doi:10.1016/j.ijhcs.2017.12.003. https://www.yorku.ca/mack/ijhcs2018.html
6. Flash T, Hogan N. The coordination of arm movements: an experimentally confirmed
   mathematical model. *Journal of Neuroscience* 5(7) (1985) 1688–1703.
7. Bhatia KP et al. Consensus statement on the classification of tremors, from the Task
   Force on Tremor of the International Parkinson and Movement Disorder Society.
   *Movement Disorders* 33(1) (2018) 75–87. doi:10.1002/mds.27121.
   https://pmc.ncbi.nlm.nih.gov/articles/PMC6530552/
8. Berbakov L, Jovanović Č, Svetel M, Vasiljević J, Dimić G, Radulović N. Quantitative
   assessment of head tremor in patients with essential tremor and cervical dystonia by
   using inertial sensors. *Sensors* 19(19) (2019) 4246. doi:10.3390/s19194246.
   https://pmc.ncbi.nlm.nih.gov/articles/PMC6806605/
