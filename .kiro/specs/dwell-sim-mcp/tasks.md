# Implementation Plan: dwell simulator (MCP server)

## Overview

Tasks are ordered so each one builds on a tested foundation. Task 1 changes the skeleton
(Requirement 9) before any simulator code exists. Task 2 sets up the package and the
workspace wiring. Tasks 3 to 13 build the model from pure parts (data, random draws,
movement primitives, task expansion and the start of session) up to the trial driver, metrics, suggestions, `compare` and scan
mode, and end with a checkpoint. Tasks 14 to 15 add input validation, the three MCP tools
and the server entry. Tasks 16 to 20 add the benchmark, the documents, the end-to-end
test and the demo-layout run.

Each sub-task names the file it writes and the test file next to it. Unit tests are
`tools/dwell-sim-mcp/test/<thing>.test.ts`, property tests are `<thing>.props.test.ts`,
and skeleton tests are in `skeleton/test/`. Each of the eight properties in requirements.md
is its own required sub-task, placed right after the component it checks. Only the scan
sub-tasks (Task 12) are optional, because scan mode is lower priority.

Each task references the requirements (Req N AC M) and properties (P N) it covers.


## Tasks

- [x] 1. Skeleton additions (Requirement 9)

  - The first work in this spec. No simulator code is written before this task is done.

  - [x] 1.1 Extract the one mapping function.
    - Move `deadZone`, `toUnit` and `mapToPixel` from `skeleton/src/engine/head-pointer.ts` unchanged into the new internal file `skeleton/src/engine/pointer-mapping.ts`, exporting `mapCentredAngles` and `unmapPixel` (design §1.1, §1.2) and the types `MappingProfile` and `MappingScreen`. `head-pointer.ts` imports `mapCentredAngles`; no second copy remains. The file is not exported from `index.ts`.
    - Write `skeleton/test/pointer-mapping.test.ts`: forward examples (centre, edges, dead zone, asymmetric ranges, gain, 1-px screen), inverse examples (dead-zone band maps to 0, clamped point, non-finite coordinate treated as centre).
    - Confirm the existing `skeleton/test/head-pointer.test.ts` and `head-pointer.props.test.ts` pass unchanged.
    - _Requirements: 9.2, 9.7_

  - [x] 1.2 Add and export the public helpers.
    - Create `skeleton/src/pointer-helpers.ts` with `pointToRotation(profile, screen, centre, point)` and `rotationToPoint(profile, screen, centre, rotation)` and the types `HeadRotation` and `ScreenPoint` (design §1.1). Both are pure and do not modify their arguments.
    - Re-export them and the types from `skeleton/src/index.ts`. Check that `sideEffects: false` still holds.
    - Write `skeleton/test/pointer-helpers.test.ts`: fixed examples, the arguments are not mutated (deep-freeze the inputs), the same inputs give the same output, a rotation in the dead zone gives the centre pixel, `index.ts` exports exactly the two new functions as runtime values.
    - _Requirements: 9.1, 9.2_

  - [x] 1.3 Write the round-trip property test for the helpers.
    - In `skeleton/test/pointer-helpers.props.test.ts`, for any valid profile (use the `validProfile()` arbitrary from `skeleton/test/arbitraries.ts`), any screen size and any point `p` in the reachable rectangle, `rotationToPoint(pointToRotation(p))` is within 1 px of `p` on each axis. Tag: `Feature: dwell-sim-mcp, Requirement 9 AC 3`.
    - _Requirements: 9.3_

  - [x] 1.4 Write the test that the helpers agree with the engine.
    - In the same file `skeleton/test/pointer-helpers.props.test.ts` (add a second property), for any valid profile, screen, centre and rotation, `rotationToPoint` equals the `pointer-move` that `stepHeadPointer` emits on its first sample for that rotation (filter reset, so the first sample goes straight to the pose).
    - _Requirements: 9.4_

  - [x] 1.5 Extend the `cancel` event payload.
    - In `skeleton/src/api-types.ts` change the `cancel` detail to `{ targetId?: string; now: number }`. In `skeleton/src/engine/dwell.ts` the cancel event carries `targetId` and `now`. In `skeleton/src/engine/scan.ts` the cancel event carries `now`, with `targetId` only when a cancel-role item was selected as an ordinary item; the virtual cancel item has none. In `skeleton/src/planchette.ts` change `cancelToIdle(now, targetId?)` and update every caller (design §1.3): dwell, scan, `selectAt` on a cancel-role hit, hold-to-cancel from a switch or gesture (no id), and `cancel: true` samples such as Escape (no id). The `targetId` key is absent, never `undefined`. `press-machine.ts` is unchanged. `emit` still dispatches exactly one `CustomEvent('cancel')` per cancel.
    - _Requirements: 9.5, 9.6_

  - [x] 1.6 Test the cancel payload and backward compatibility.
    - Write `skeleton/test/cancel-payload.test.ts`: a dwell cancel-role target gives `{ targetId, now }`; the scan virtual cancel item gives `{ now }` with no `targetId` key; a cancel-role item selected as an ordinary scan item gives `{ targetId, now }`; Escape gives `{ now }` with no `targetId` key; hold-to-cancel from a switch and from a gesture give `{ now }`; a listener that ignores the payload is called exactly once per cancel and does not throw.
    - Update the existing skeleton tests that compare a cancel `detail` with `{}` to expect `{ now }`, and run the full existing skeleton suite to confirm nothing else changed (`skeleton/test/cancel.test.ts`, `cancel.props.test.ts`, `api.test.ts`).
    - _Requirements: 9.5, 9.6_

  - [x] 1.7 Record the API change in the docs.
    - This spec does not edit input-core files. Append a dated entry to `docs/kiro-journal.md` (format from tech.md) that records the three public API additions (`pointToRotation`, `rotationToPoint`, the `cancel` payload `{ targetId?, now }`) and proposes the edit for the input-core owner to apply: add the two helpers and the extended `cancel` event to the API list in input-core `design.md` §6. The same note is in the Notes section below.
    - _Requirements: 9.1, 9.5_

  - [x] 1.8 Checkpoint - Ensure the skeleton still passes
    - Run the full skeleton test suite (`npm test --workspace=skeleton`) and `npm run build --workspace=skeleton`. Ensure all tests pass, ask the user if questions arise.

  - **Covers:** Req 9 AC 1–7.

- [x] 2. Package scaffolding and wiring (Requirements 8, 10)

  - [x] 2.1 Create the package files.
    - Write `tools/dwell-sim-mcp/package.json`: name `dwell-sim-mcp`, `type: module`, `engines.node` `>=20` (design §14, Requirement 10 AC 5), `bin: { "dwell-sim-mcp": "dist/server.js" }`, `main`, `files: ["dist","README.md","METHODOLOGY.md"]`, scripts `test` (`vitest run --passWithNoTests`), `build` (`tsc -p tsconfig.build.json && tsc -p tsconfig.scripts.json`), dependencies pinned exactly: `@modelcontextprotocol/sdk` 1.32.2, `zod` 4.6.7, `@planchette/skeleton` `*`; devDependencies `fast-check`, `vitest`, `typescript` at the same exact versions as `skeleton/package.json` (currently 4.10.3, 5.1.1, 7.0.2).
    - Write `tsconfig.json` (typecheck, `noEmit`, `strict`, `paths` mapping `@planchette/skeleton` to `../../skeleton/src/index.ts`, include `src`, `test`, `scripts`), `tsconfig.build.json` (no `paths`, `rootDir: src`, `outDir: dist`) `tsconfig.scripts.json` (compiles `scripts/` to `dist-scripts/`, same `module` settings as the build config, no `paths`) and `vitest.config.ts` (alias to the skeleton source).
    - Write `tools/dwell-sim-mcp/test/package.test.ts`: every dependency version is exact (no range characters), the three dev tool versions equal the skeleton's, `engines.node` minimum is at least 20, `bin` points at `dist/server.js`.
    - _Requirements: 8.5, 10.5_

  - [x] 2.2 Wire the workspace into the root.
    - In root `package.json` add `tools/dwell-sim-mcp` to `workspaces`; add scripts `build:sim`, `sim` (`node tools/dwell-sim-mcp/dist/server.js`), extend `typecheck` to also run `tsc --noEmit -p tools/dwell-sim-mcp/tsconfig.json`, and extend `test` to run `build:sim` first and then the tests of both workspaces (design §14). Add `tools/dwell-sim-mcp/dist/` and `tools/dwell-sim-mcp/dist-scripts/` to `.gitignore` (do not touch `.kiro/`). Run `npm install` so the lock file and workspace link update.
    - Write `tools/dwell-sim-mcp/test/root-wiring.test.ts`: the root `workspaces` lists the package, the `sim`, `build:sim`, `typecheck` and `test` scripts contain the expected commands, `.gitignore` ignores `tools/dwell-sim-mcp/dist/` and `tools/dwell-sim-mcp/dist-scripts/` and does not ignore `.kiro/`.
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 2.3 Record the dependencies and test the record.
    - Add to `THIRD_PARTY.md` the package `@modelcontextprotocol/sdk` 1.32.2 (MIT) and `zod` 4.6.7 (MIT), and every transitive production dependency that `npm ls --all --omit=dev --workspace=tools/dwell-sim-mcp` lists, each with its exact installed version and licence. If any licence is not MIT, Apache-2.0, BSD or ISC, stop and ask the user (Req 8.7).
    - Write `tools/dwell-sim-mcp/test/third-party.test.ts`: every installed production dependency of the package (read from `node_modules` package files) appears in `THIRD_PARTY.md` with its exact version and licence, and every licence is MIT, Apache-2.0, BSD-* or ISC.
    - _Requirements: 8.3, 8.5, 8.7_

  - [x] 2.4 Add the static rule test for the source.
    - Write `tools/dwell-sim-mcp/test/static-rules.test.ts`: no file in `src/` uses `Math.random`, `Date.now`, `performance.now`, `new Date`, or `setTimeout`/`setInterval`; `src/` imports only `@modelcontextprotocol/sdk/server/mcp.js`, `@modelcontextprotocol/sdk/server/stdio.js`, `zod`, `@planchette/skeleton` and relative paths (no `node:http`, `node:net`, `node:https`, `fetch`, or any skeleton internal path); no `any` type annotation. `scripts/` and `test/` are excluded from the clock rule.
    - _Requirements: 1.1, 7.1, 7.2, 8.1, 8.3, 9.7_

  - **Covers:** Req 8 AC 1, 3, 5, 7; Req 10 AC 1–3, 5.

- [x] 3. Preset data and `list_users`

  - [x] 3.1 Types, disclaimer and the Figures table as data.
    - Write `tools/dwell-sim-mcp/src/types.ts` (the core types from design "Data Models"), `src/disclaimer.ts` (the exact sentence from Req 4 AC 5) and `src/figures.ts` (`FIGURES`, `REFERENCES`, `FigureRowId`, `ParamSource`, `Sourced`).
    - Write `test/figures.test.ts`: parse the Figures table and the References list in `.kiro/specs/dwell-sim-mcp/requirements.md` and assert every row label, value and reference number in `FIGURES` and `REFERENCES` matches it, with no row missing or extra.
    - _Requirements: 2.5, 2.6, 4.5_

  - [x] 3.2 Presets and custom ranges.
    - Write `src/custom-ranges.ts` (`CUSTOM_RANGES` with path, min, max, unit) and `src/presets.ts` (`UserParams`, `SourcedParams`, `PRESET_NAMES`, `PRESETS`), every parameter carrying a `figure` source (row and reference) or a `chosen` reason.
    - Write `test/presets.test.ts`: the six preset names exist; every value equals the Presets and shared-parameter tables in requirements.md; every parameter has a source; every `figure` source names an existing `FIGURES` row and reference; every preset value is inside its custom range; every `CUSTOM_RANGES` key is overridable and every other key is not.
    - _Requirements: 2.5, 3.1, 3.2, 3.3_

  - [x] 3.3 The `list_users` data and the golden file.
    - Write `src/list-users.ts` (`listUsers()` returning every preset with each parameter's value and citation or `chosen: <reason>`, the custom ranges and the disclaimer; takes no input).
    - Write `test/list-users.test.ts` and `test/golden/list-users.json`: the live output equals the golden file; every `source.row` label exists in the Figures table of requirements.md with the same reference number; the ranges equal the "Custom ranges" paragraph of requirements.md; the disclaimer is present.
    - _Requirements: 2.7, 3.4, 3.5, 3.7, 3.8, 4.5_

  - **Covers:** Req 2 AC 5, 7; Req 3 AC 1–5, 7, 8; Req 4 AC 5.

- [x] 4. Seeded randomness and user keys

  - [x] 4.1 Counter-based random draws.
    - Write `src/rng.ts` (`mix32`, `hash32`, `Purpose`, `stream`, `u01`, design §3).
    - Write `test/rng.test.ts`: fixed known outputs for fixed keys (pins the generator), `u01` is in [0, 1), a different key gives a different draw.
    - Write `test/rng.props.test.ts`: for any keys, `u01` is in [0, 1) and is a pure function of its key; drawing other keys first never changes a draw (no shared state); two different streams do not give equal draw sequences.
    - _Requirements: 7.1, 7.4_

  - [x] 4.2 Resolve users and derive user keys.
    - Write `src/resolve-user.ts`: a preset name or a custom user (base preset plus overrides) becomes a `ResolvedUser`; `key` is the hash of the preset name (UTF-16) or of the canonical JSON of the resolved parameters plus the name (design §3).
    - Write `test/resolve-user.test.ts`: preset resolution, overrides replace only the named fields, an unknown preset name and an out-of-range override are reported with the name and range (the typed error codes are wired in Task 14), identical users give identical keys.
    - Write `test/resolve-user.props.test.ts`: stream independence. For any user list, adding, removing or reordering other users does not change a given user's key or any draw `u01(stream(seed, key, trial, purpose), k, j)`.
    - _Requirements: 3.2, 3.3, 3.6, 7.1_

  - **Covers:** Req 3 AC 2, 3, 6; Req 7 AC 1, 4.

- [x] 5. Movement primitives

  - Each sub-task is a separate pure file with its own tests; they depend only on Tasks 3 and 4 and on the skeleton helpers from Task 1.

  - [x] 5.1 Pixel and degree geometry.
    - Write `src/geometry.ts`: `toPx`, `toPose`, `poseAtPx`, `clampToHeadRange` and `angularWidth` through `pointToRotation` and `rotationToPoint` only (design §4.1).
    - Write `test/geometry.test.ts` and `test/geometry.props.test.ts`: head-range clamping per direction for any pose; `angularWidth` is positive for any rectangle; `toPx(toPose(p))` is within 1 px of `p` for reachable points.
    - _Requirements: 1.1, 2.4, 9.1_

  - [x] 5.2 Reachable pixel rectangle.
    - Write `src/reachable.ts`: the pixel rectangle `[xMin, xMax] × [yMin, yMax]` from `rotationToPoint` at the extreme head-range rotations with the effective profile, and `isTargetReachable(rect)`.
    - Write `test/reachable.test.ts` and `test/reachable.props.test.ts`: with no calibration range larger than the head range the reachable rectangle is the whole screen (Req 11 AC 12); with a larger calibration range a target beyond the rectangle is unreachable and a target inside it is reachable.
    - _Requirements: 6.3, 11.2, 11.12_

  - [x] 5.3 Scatter sampler.
    - Write `src/scatter.ts`: `probit` (Acklam), truncated normal `ttn` on (−3, 3) and `sampleAim` with SD = min(W / 4.133, SDcap) per axis, exactly two uniforms per aim (design §4.4). `probit` uses the Acklam breakpoints and coefficients exactly as listed in design §4.4 (`p_low = 0.02425`; lower, central and upper regions).
    - Write `test/scatter.test.ts` (fixed values, `Φ(−3)` and `Φ(3)` constants, aim at the centre when u is 0.5; `probit` quantiles with relative tolerance 1.2e-9 and absolute 1e-12 at 0.5: 0.975 → 1.959963984540054, 0.995 → 2.5758293035489004, 0.9 → 1.2815515655446004, 0.01 → −2.3263478740408408 (lower tail branch), 0.5 → 0; clamp check: `ttn(0)` and `ttn(1 − 2^-53)` stay within ±(3 − 1e-9)) and `test/scatter.props.test.ts`: max relative error of `probit` is at most 1.135e-9 over [Φ(−3), Φ(3)] against an independent Newton-refined inverse (the test refines it itself and does not call `probit`); `|z| < 3` for every u in [0, 1); the draw count is always exactly 2 per aim (count keys read with a spy stream); aim offsets are independent between axes.
    - _Requirements: 2.1, 11.4_

  - [x] 5.4 Tremor and drift.
    - Write `src/tremor.ts`: `tremorOffset(t, params, streams)` with the random phase and the smoothstep drift over 5 s knots (design §4.5). φ and the drift knots are computed directly from `u01` on every call (three hashes per call); the function is pure and keeps no cache.
    - Write `test/tremor.test.ts` and `test/tremor.props.test.ts`: `|offset| ≤ 0.6 × a0`; the size `a(t)` stays within [0.8, 1.2] × a0 for any t; tremor off (size 0 or frequency 0) gives exactly 0; the value at a given t is the same whatever sampling rate asks for it.
    - _Requirements: 2.3, 11.5_

  - [x] 5.5 Minimum-jerk path.
    - Write `src/min-jerk.ts`: `minJerk(τ)` and `poseOnSegment` (design §4.3).
    - Write `test/min-jerk.test.ts` and `test/min-jerk.props.test.ts`: `s(0) = 0`, `s(1) = 1`, `s(0.5) = 0.5`; `s` is monotone and in [0, 1] for τ in [0, 1] and clamped outside it; position equals start + (aim − start) × s.
    - _Requirements: 2.2_

  - [x] 5.6 Fitts movement time.
    - Write `src/fitts.ts`: `movementTimeMs(A, W, TP)` with Shannon ID, projected width along the movement direction and the `MT_MIN` of 150 ms (design §4.2).
    - Write `test/fitts.test.ts` and `test/fitts.props.test.ts`: the formula for fixed values (for example A = 400, W = 100, TP = 1.42); MT is non-decreasing in A and non-increasing in W and in TP; MT is never below `MT_MIN`; no movement (MT 0, no segment) when A < 0.5 px.
    - _Requirements: 2.1_

  - [x] 5.7 Task expansion.
    - Write `src/task.ts` with `expandTask(layout, spec, seed)` (design §4.8). An explicit id list passes through. `{ eachTarget: n }` with more than one selectable target becomes n rounds over the selectable ids sorted by UTF-16 order, each round a Fisher–Yates shuffle with `j = floor(u01(taskOrder, r, i) × (i + 1))` where `taskOrder = stream(seed, 0, 0, Purpose.TaskOrder)` (userKey 0, trialIndex 0: the task is built once per request, before any user is resolved, and `compare` needs the same task in both configurations), then repaired at round boundaries: when the first id of round r equals the last id of round r−1, swap the first two ids of round r (the repair draws nothing). With exactly one selectable target that has `autoRepeat`, the result is n copies, not shuffled. Rest-area targets are never selectable. Cases that cannot be expanded are reported by 5.8.
    - Write `test/task.test.ts` and `test/task.props.test.ts`: every selectable id appears exactly n times; the same id never appears twice in a row when more than one selectable target exists (include two selectable targets and many rounds, where the repair is used most); the same seed gives the same list and another seed a different one; the list does not depend on registration order; rest-area ids never appear; one selectable `autoRepeat` target gives n unshuffled copies.
    - _Requirements: 4.1, 4.27, 4.29, 7.1_

  - [x] 5.8 Task validation (`ADJACENT_REPEAT`).
    - Extend `src/task.ts` so `expandTask` returns either the list or an error `{ code: 'ADJACENT_REPEAT', index, targetId }` (design §4.8). An explicit list with the same id at positions i−1 and i, where the target has no `autoRepeat`, is an error naming i (the zero-based index of the second entry) and the id; the first such pair in list order is reported. The same pair on an `autoRepeat` target is allowed. `{ eachTarget: n }` with n > 1 and exactly one selectable target without `autoRepeat` is an error naming position 1 and the id; with n = 1 the list is that one id.
    - Write `test/task-validation.test.ts` and `test/task-validation.props.test.ts`: one example per case above; for any explicit list an error is returned exactly when an adjacent same-id pair on a non-`autoRepeat` target exists, and it names the second index of the first such pair; lists without such a pair expand without error.
    - _Requirements: 4.26, 4.28, 4.29_

  - **Covers:** Req 2 AC 1–4; Req 4 AC 26–29; Req 6 AC 3; Req 11 AC 2, 4, 5, 12.

- [x] 6. Head path planning and the head function

  - [x] 6.1 Plan one task entry, with reading pauses.
    - Write `src/plan-entry.ts`: `planEntry(ctx, entry, tEntry, p0)` returning segments, pauses, aim and deadline: reaction wait, aim point, Fitts movement time, minimum-jerk pieces, reading pauses on crossed non-intended targets (never the aimed target, never a target containing the start point), final hold to the deadline (design §4.7).
    - Write `test/plan-entry.test.ts`: reaction wait is the first segment (Req 11 AC 3); a pause piece starts the next move from rest; start-on-aim gives a single hold; deadline equals `tMove0 + analysisWindow`; the aim is clamped to the head range.
    - Write `test/plan-entry.props.test.ts`: pauses occur only on crossed non-intended targets; there are none with chance 0 % and one on every crossed non-intended target at 100 %; each pause length is within [min, max]; no pause is on the intended target; the chance and length draws depend only on the entry index and layout target index, not on the profile.
    - _Requirements: 2.1, 2.2, 11.3, 11.6, 11.7, 11.13_

  - [x] 6.2 The head function, a pure function of time.
    - Write `src/head-model.ts`: `head(plan, t)` (accepts any plan with `segments`: an entry plan or the start plan from 6.3) with a forward-only cursor over the segments, plus tremor, plus tracking noise (uniform in [−n, +n] per axis, keyed by `round(t × 1000)`), then `clampToHeadRange` (design §4.6). `basePose(plan, t)` returns the pose without tremor and noise. No allocation per call.
    - Write `test/head-model.test.ts` and `test/head-model.props.test.ts`: for any t the result is inside the head range; noise is within ±n per axis; the same t gives the same pose however the earlier t values were visited; with tremor and noise off the result equals `basePose`.
    - _Requirements: 2.2, 2.3, 2.4, 11.8_

  - [x] 6.3 Plan the start of session.
    - Write `src/plan-start.ts` (design §4.7a): `planStart(ctx, tBegin)` returns `StartPlan { tBegin, tEnd, segments, endPose, restId, clamped }`. With a rest-area target (the first in layout order): a reaction wait at the centre pose (phase `start-of-session`, sub `reaction`), an aim inside the rest area from the §4.4 sampler with the draws `u01(start, 0, 0)` and `u01(start, 0, 1)` (`Purpose.Start`), then a minimum-jerk move at the user's throughput (sub `moving`), with no reading pauses. `clamped` is true when the rest point is outside the head range. Without a rest area: no segments, `tEnd = tBegin`, `endPose` is the centre pose. It reuses `geometry.ts`, `scatter.ts`, `fitts.ts` and `min-jerk.ts`, so there is no start-only movement code.
    - Write `test/plan-start.test.ts` and `test/plan-start.props.test.ts`: reaction first, then the move; the end pose is inside the rest rectangle when the rest area is reachable; no reading pause even at a 100 % chance; no segments and `tEnd = tBegin` without a rest area; `clamped` when the rest point is out of range; the start draws use only `Purpose.Start` and do not change any entry's aim draws; entry 0 can start at `tEnd` (the start of session is in no time-to-select).
    - _Requirements: 4.11, 11.9, 11.10_

  - **Covers:** Req 2 AC 1–4; Req 4 AC 11; Req 11 AC 3, 6, 7, 8, 9, 10, 13.

- [x] 7. Classification

  - [x] 7.1 Classify events as intended or accidental.
    - Write `src/classify.ts` (it may import `ampPx` from a small `src/amp-px.ts`; either way `ampPx` is exported so it can be unit tested): `phaseAt` (the plan in force is the start plan while `now < tEnd`, including the warm-up, otherwise the active entry plan), the activity label table (phase `start-of-session` and `waiting` both give `waiting`), the intended rule (never intended in the start of session; cancel-role aim matched by `targetId`), the start-of-session category (an event before the start plan's `tEnd` is a start-of-session event, activity `waiting`, cause `start`, checked before intended and accidental) and the seven accidental causes in the design's precedence order (`repeat`, `waiting`, `reading-pause` with the 500 ms lag allowance, `tremor-at-edge`, `early-on-intended-target`, `pass-over`, `other`) and the miss causes (`unreachable`, `tremor-at-edge`, `other`) (design §6).
    - Write `test/classify.test.ts`: one example for every cause and every activity label; an event during the warm-up, the reaction wait at the centre or the start movement is a start-of-session event (activity `waiting`, cause `start`) and never accidental, whatever else would match; `repeat` wins over `waiting`; an unattributed cancel (no `targetId`) is never intended and never `tremor-at-edge`; an event on the aimed target while the planned position is still outside it is accidental with cause `early-on-intended-target` or `tremor-at-edge`; an event during an entry's reaction wait is accidental with label `waiting` and cause `waiting`.
    - Write `test/amp-px.test.ts` for `ampPx` (design §6: degrees first, max over the four sign corners, Euclidean, plus 1 px): tremor only; noise only; both together; the yaw axis versus the pitch axis (tremor adds only on `tremorAxis`, noise on both); at the screen edge, where the clamp makes it smaller; in the dead zone.
    - Extend `test/classify.test.ts` for decisions 5 to 10 of design §6: tremor-or-noise-on is `(a0 > 0 && f > 0) || n > 0` (a0 > 0 with f = 0 and n = 0 is off, and `aT` is 0 then); with no `pointer-move` seen yet the `P` half of `tremor-at-edge` is skipped; the miss cause `tremor-at-edge` uses `edgeDist(aimPx, rect) ≤ ampPx(aim pose)`; the `intended` inside test is half-open (`x` is inside, `x + w` is outside, same for `y`) and agrees with the helper in `plan-entry.ts`; `edgeDist` is 0 on the boundary and continuous across it; `repeat` state resets at the start plan's `tEnd` and a start-of-session event is never the previous event; an event with no `targetId` is never `repeat` and never `tremor-at-edge`.
    - Write `test/classify.props.test.ts`: for random events and random plans (including start plans and unattributed cancels) the classifier returns exactly one of start-of-session, intended or accidental, and an accidental result has exactly one label from the four and exactly one cause from the seven accidental causes.
    - _Requirements: 4.9, 4.10, 4.11_

  - **Covers:** Req 4 AC 9–11.

- [x] 8. Trial driver and its properties

  - [x] 8.1 Shared test arbitraries.
    - Write `test/arbitraries.ts`: `layoutArb` (jittered grid, rectangles inside the screen, no overlaps by construction, one rest area, optional cancel target), `presetArb`, `customUserArb` (values within `CUSTOM_RANGES`, boundaries included), `profileArb`, `taskArb(layout)`. Layouts shrink toward fewer targets, users toward `steady`, tasks toward length 1.
    - Write `test/arbitraries.test.ts`: generated layouts are inside the screen and have no overlap; custom users are within their ranges; tasks name only ids in the layout.
    - _Requirements: 3.2, 4.1_

  - [x] 8.2 Trial driver, part 1: instance and warm-up.
    - Write `src/run-trial.ts` (first part): create a new `createPlanchette` per trial with `inputs: false` and `trackingIndicator: false`; set the effective profile (calibration ranges from the user's head range for each field the caller did not set, then `setProfile` and `getProfile()`); register targets; attach the listeners (select, cancel, pointer-move, calibration-step) before the first sample; feed the warm-up (still head at the centre, tremor and noise on) with a reused sample and one-element batch until the `calibration-step` `centre`/`done` event, bounded by `calibrationStepTimeout + 1000 ms` (warning `centre-step-cap`); exclude the warm-up time from the result. Events during the warm-up are queued and classified in 8.3.
    - Write `test/run-trial-warmup.test.ts`: the first `calibration-step` centre/done event ends the warm-up; no instance or state is shared between two trials; caller-set calibration ranges win over the user's head range; the effective profile is echoed clamped.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 11.1_

  - [x] 8.3 Trial driver, part 2: start of session.
    - Extend `src/run-trial.ts`: after the centre step call `planStart` (6.3) with the frame time of the `calibration-step` event and feed `head(startPlan, now)` until `startPlan.tEnd`. Every `select` or `cancel` from the start of session (`now` before `startPlan.tEnd`) is classified (7.1) as a start-of-session event with activity `waiting` and cause `start`, not as an accidental selection. Warm-up events are start-of-session events by definition, so the driver records them directly as start events (activity `waiting`, cause `start`) and does not call `classify` for them, with a code comment citing design §5/§6; there is no classify-context copy with `tEnd = +Infinity` and `classify.ts` stays untouched. The `start-clamped` warning comes from `startPlan.clamped`. Without a rest area the start of session has zero length and the user stays at the screen centre. The first entry starts at `tEnd` from `endPose`. The warm-up and the start of session are in no time-to-select.
    - Write `test/run-trial-start.test.ts`: with and without a rest area; the end pose is inside the rest area; a select while waiting at the centre, during the reaction wait and during the start movement (a selectable target between the centre and the rest area) is recorded as a start-of-session event with label `waiting` and cause `start`, and not as an accidental selection; a warm-up event pushed at `tDone`, with and without a rest area, is recorded as a start event (with no rest area `tEnd = tDone`, so the event has `now == tEnd`, which is why it is recorded directly and not classified); `start-clamped`; entry 0 starts at `tEnd`.
    - _Requirements: 4.11, 11.9, 11.10_

  - [x] 8.4 Trial driver, part 3: the entry loop and miss handling.
    - Extend `src/run-trial.ts`: for each task entry plan with `planEntry`, feed `head(plan, now)` once per frame at `now = k × 1000 / fps`, drain queued events through `classify`, resolve the entry on its first intended event or at its deadline frame (the first frame with `now >= deadline`; it is fed, its events are classified under the old plan, an intended event on it wins, then the miss is recorded; `timeToSelectMs` can exceed the analysis window by less than one frame). §6 wins: after the first intended event in a frame, plan entry k+1 immediately inside the drain loop, at that frame's `now`, from `basePose(plan, now)`, and classify the remaining events of that frame under the new plan with entry = k+1 (design §5 pseudocode). Same-frame events after the last entry resolves are classified under the just-resolved plan and recorded with that entry's index; nothing is dropped, and no frame is fed after the last entry resolves. If such an event classifies as `intended`, record it as an accidental selection with cause `other`, the activity label from `phaseAt` and the resolved entry's index (count it once, never resolve the entry twice), so Properties 4 and 8 both hold. The first entry starts at the start plan's `tEnd`. Record `TrialResult` (entries with `timeToSelectMs = event.now − tMove0`, `missCause`, accidental records, warnings, effective profile). No `await` and no allocation per frame in the driver. Call `destroy()` at the end.
    - Deadline rule: `planEntry` skips the final hold when moves and pauses overrun the deadline, so the last segment can end after the deadline. The driver ends each entry at its deadline (`tMove0 + analysisWindow`) regardless of where the last segment ends. The entry resolves as a miss at the deadline frame, the next entry starts at that frame from the base pose at that time, and nothing after the deadline frame is fed or classified for that entry.
    - Write `test/run-trial-entries.test.ts`: one intended target gets selected; a miss moves on to the next entry (Req 11 AC 11); an unreachable target is a miss with cause `unreachable`; time-to-select is measured from `tMove0`; the next entry's first pose is the previous base pose; `observers.onEvent` sees every engine event; a plan whose last segment ends after the deadline still resolves as a miss at the deadline frame, the next entry starts at that frame from the base pose at that time, and no sample or event after the deadline frame is fed or classified for the first entry; an intended event on the deadline frame wins; two events in one frame where the first is intended give the second a classification under plan k+1 with entry = k+1; events in the final frame after the last entry resolves are recorded with the last entry's index and no later frame is fed; a second event pushed by hand into the queue in the final frame, which would classify as intended, is counted once, as accidental with cause `other`, with the resolved entry's index, and the entry is not resolved twice (intended + misses still equals the task length).
    - _Requirements: 1.2, 4.9, 4.12, 11.3, 11.11_

  - [x] 8.5 Write property test for Property 4: every event is accounted for.
    - In `test/property-4-every-event.props.test.ts` (200 runs): attach a second, independent listener to the same planchette (through `observers.onEvent`) and assert intended + accidental + `startOfSession.count` = the number of `select` and `cancel` events it counted (three categories that do not overlap; the accidental count excludes start-of-session events); the `accidentalSelections` list length equals `accidental`; every accidental record has one of the four labels and one of the seven accidental causes. The generator mixes layouts with and without a rest area and puts selectable targets between the screen centre and the rest area, so start-of-session events occur. Also assert: every event before the start plan's `tEnd` is a start-of-session event (label `waiting`, cause `start`) and is in no accidental record; `startOfSession.byTarget` counts sum to `startOfSession.count`; `accidentalPer100Intended = accidental / intended × 100`, and `null` when `intended = 0`. Tag: `Feature: dwell-sim-mcp, Property 4: Every event is accounted for`.
    - **Property 4: Every event is accounted for**
    - **Validates: Requirements 4.3, 4.9, 4.10, 4.11, 4.25**

  - [x] 8.6 Write property test for Property 3: unreachable means miss.
    - In `test/property-3-unreachable.props.test.ts`: users with a 3–10° head range and profile calibration ranges 1.5 to 3 times larger; place one target fully outside the reachable rectangle from `reachable.ts` (build the case by moving the target, do not discard it); assert the event listener sees no `select` or `cancel` for that id and every entry for it is a miss. A partly reachable target is not generated.
    - **Property 3: Unreachable means miss**
    - **Validates: Requirements 11.1, 11.2, 11.11, 11.12**

  - [x] 8.7 Write property test for Property 2: clean run, no accidents, no misses.
    - In `test/property-2-clean-run.props.test.ts`: generate by construction tremor 0, noise 0, reading-pause chance 0, no `autoRepeat` target; draw the user's scatter cap first, then size every target at least 6 × SDcap in degrees on both axes plus a 2 px margin (so SD = SDcap); the screen centre is outside every selectable target; `dwellTime` is at least the longest planned crossing time of any non-intended target plus `margin = L + F(fps) = 150 + 1000 / fps` ms of the run (L: smoother arrival-lag limit at smoothingStrength 0.5, `LAG_LIMIT_MS` in `skeleton/test/smoother.test.ts`; F: one frame, because the dwell timer in `skeleton/src/engine/dwell.ts` counts whole frames; derivation in design Property 2), computed from the entry plans and from the start plan (the start path crosses targets without a reading pause); an analysis window of reaction + movement + dwell + post-selection pause + 1000 ms (movement from the slowest throughput in range, capped at 120 s); all targets reachable. Keep `smoothingStrength` at the default 0.5 (do not generate it). Keep crossing + margin ≤ 3000 ms (the dwell clamp) by construction where possible; use `fc.pre` only if the discard rate is rare, and print the discard rate. Assert each intended target is selected exactly once, accidental = 0 and misses = 0 (start-of-session events are not accidental and are not asserted on). Bias the generator so that at least 50 % of the runs contain a non-intended stay on a selectable target: use `selectableBetweenCentreAndRest` and place targets lying between consecutive task targets. Measure the share of runs with a non-intended stay (from the `pointer-move` events), the smallest observed margin `dwellTime − (longest actual pointer stay on a non-intended target)` over the runs, and the discard rate; print all three, and assert share ≥ 50 % and smallest margin > 0.
    - **Property 2: Clean run, no accidents, no misses**
    - **Validates: Requirements 4.2, 4.9, 4.10, 4.12, 11.3, 11.4**

  - [x] 8.8 Write property test for Property 8: each task entry resolves once.
    - In `test/property-8-entry-resolves-once.props.test.ts` (200 runs): any request from the shared arbitraries with a mix of reachable and unreachable targets and a short window (2–10 s) so misses are common. For every trial assert intended + misses = task length, and that the entry indices of the results are exactly 0 to n−1 with no duplicates.
    - **Property 8: Each task entry resolves once**
    - **Validates: Requirements 4.12, 11.11**

  - [x] 8.9 Write property test for Property 7: frame rate.
    - In `test/property-7-frame-rate.props.test.ts` (100 runs): tremor, noise, reading pauses and `autoRepeat` off; B1 by stays shorter than `dwellTime − 67 ms` or longer than `dwellTime + postSelectionPause + 134 ms`; B2 by every target at least 6 SDcap in px + 40 px wide; B4 by construction: draw `postSelectionPause` first, then `reactionTimeMs` from `[max(150, postSelectionPause), 1500]` in the custom user, and add a test line that asserts `reactionTimeMs ≥ postSelectionPause` for every generated request; B5 by `autoRepeat` false. Keep `smoothingStrength` fixed at the default 0.5 (do not generate it). Run the same request at 15 and 60 fps and assert: (1) the same ordered `(entry, targetId)` list of intended selections; (2) for every selected entry at both fps, `tts − arrival = ceil(dwellTime / F) × F` within 1e-6 ms, with F = 1000 / fps and `arrival = max(first frame on which the pointer is inside the target in the unbroken run ending at the select (from `pointer-move`), first frame at or after the end of the preceding post-selection pause)` (the dwell timer counts only after the pause ends: `dwell.ts`, `from = max(prevNow, pauseEnd)`). Do not assert a bound on time-to-select across frame rates. Print the largest `|tts15 − tts60|` and the largest single-entry `D = |(arrival15 − tMove0_15) − (arrival60 − tMove0_60)|` (design Property 7 explains why they are reported, not bounded).
    - **Property 7: Frame rate**
    - **Validates: Requirements 2.2, 2.3, 7.4**

  - [x] 8.10 Write property test for Property 6: longer dwell, fewer reading-pause accidents.
    - In `test/property-6-longer-dwell.props.test.ts`: part (a), a stay shorter than `dwellTime` never produces a `select` on the target (stream through the real engine with a lost-face frame before each stay and gap so the pointer jumps onto the pose, no `autoRepeat`); part (b), with non-intended stays at least d_new + `postSelectionPause` apart by construction, raising `dwellTime` from d_old to d_new never increases the accident count, and the set of accident stays under d_new is a subset of those under d_old (map each select to the stay that contains its `now`).
    - **Property 6: Longer dwell, fewer reading-pause accidents**
    - **Validates: Requirements 6.1**

  - [x] 8.11 Pin the known Property 6 counterexample as a named example test.
    - In `test/property-6-counterexample.test.ts`: replay d1 = 1000 ms, d2 = 1200 ms, `postSelectionPause` 500 ms, S1 from 0 to 1000 ms, S2 from 1100 to 2400 ms with a 900 ms reading pause inside it. Assert S1 selects under d1 and starts a pause to 1500 ms, S2 does not select under d1, S2 selects at 2300 ms under d2, and that this stream breaks the restriction in part (b) (the gap between stays is less than d_new + `postSelectionPause`), so the property test excludes it.
    - **Validates: Requirements 6.1**

  - **Covers:** Req 1 AC 1–5; Req 4 AC 2, 3, 9–12, 25; Req 11 AC 1–4, 9–12; P2, P3, P4, P6, P7, P8.

- [x] 9. Metrics, warnings, runner and `simulate` core

  - [x] 9.1 Metrics and aggregation.
    - Write `src/metrics.ts` (design §7): nearest-rank percentile `sorted[ceil(p × n) − 1]` (null when n = 0), with the median as the nearest-rank p50 `sorted[ceil(0.5 × n) − 1]` (lower middle value for an even count, not the mean of the two middle values) and p90 as `sorted[ceil(0.9 × n) − 1]`; rate per 100 intended at full precision (`accidental / intended × 100`, null when no intended); per-target and per-user aggregation through the entry point `aggregateUser(userName: string, trials: readonly TrialResult[], layout: Layout): UserMetrics` (counts summed, time samples pooled, `null` bucket for an unattributed cancel). `UserMetrics` is `Omit<TargetMetrics, 'targetId'>` plus the user fields, so a user row has no `targetId`. Counting rules: a `selected` entry counts as intended on its aimed target; a `miss` counts toward `misses` (and its miss cause) on its aimed target; a time-to-select sample is taken only when `timeToSelectMs` is non-null; accidental records count on their `targetId` (`null` bucket when absent); start events count as `startCount` on their `targetId` and in the user's `startOfSession`. Each target and user carries `startCount` (start-of-session events, kept separate from `accidental`) and each user a `startOfSession: { count, byTarget }` line (targets sorted by id, `null` last). `accidental` excludes start-of-session events. `perTarget` is ordered by id in UTF-16 order with the `null` bucket last; it has one row for every selectable layout target (any role except `rest-area`) even with all counts zero, a `rest-area` row only if it has events, and the `null` row only if it has events ("has events" means any non-zero count in the row: intended, misses, accidental or `startCount`). `causes` and `activities` always contain all keys (the seven accidental causes and the four activity labels), zeros included, on users and on targets.
    - Export the rounding helper `round1(x: number | null): number | null` (one decimal, `null` stays `null`) from `metrics.ts`. `simulate` (9.4) applies it to every `accidentalPer100Intended` in the tool output; `metrics.ts` itself keeps full precision. `round1` is tested here, in 9.1.
    - Write `test/metrics.test.ts` and `test/metrics.props.test.ts`: null rules (no intended, nothing selected); nearest-rank percentile values for fixed samples, including the median of an even count (`[1, 2, 3, 4]` gives 2, not 2.5) and a single sample (n = 1); p90 for fixed samples; for any trial results the per-target counts sum to the per-user counts; `startOfSession.byTarget` counts sum to `startOfSession.count` and equal the user's `startCount`; `accidental` and the rate never include start-of-session events (4 accidental, 1 start-of-session event and 38 intended gives a full-precision rate of 10.526… in metrics, and `round1` of it is 10.5; `round1(null)` is `null`; `round1(75)` is 75); `perTarget` order (ids in UTF-16 order, `null` last) and membership (zero-count selectable target present, `rest-area` without events absent, `rest-area` with events present, `null` row absent without events); `causes` and `activities` have all 7 and all 4 keys with zeros on users and on targets; no NaN or Infinity in any output field.
    - _Requirements: 4.2, 4.13, 4.25_

  - [x] 9.2 Warnings and notes.
    - Write `src/warnings.ts` (design §7). Warnings and notes are `string[]`, and every string starts with its code and a colon. Export the codes as constants: `NO_REST_AREA`, `NO_CANCEL_TARGET`, `TREMOR_ABOVE_TUNED` from `warnings.ts`; the trial warning codes `start-clamped` and `centre-step-cap` are the existing constants `WARNING_START_CLAMPED` and `WARNING_CENTRE_STEP_CAP` in `src/run-trial.ts` (values unchanged; export them there if 8.2 or 8.3 did not).
      - `NO_REST_AREA` and `NO_CANCEL_TARGET` warnings (naming the missing target role and citing the accessibility rule), emitted only in `head + dwell` mode and never in scan mode (no head-mode warning in scan mode). Example texts: `"NO_REST_AREA: the layout has no rest-area target. Accessibility rule: every layout has a rest area."`, `"NO_CANCEL_TARGET: the layout has no cancel-role target. Accessibility rule: head-pointer layouts place a cancel target."`
      - The tremor note, emitted only in modes that use the head pointer (`head + dwell`; never in `scan`, because the note is about the head-pointer smoothing): one note per user whose `tremorPeakToPeakDeg` is strictly above 1° (exactly 1° gives none), naming the user and the amount, for example `"TREMOR_ABOVE_TUNED: user strong-head-tremor has tremor 1.6° peak to peak, above the 1° the smoothing is tuned for."`
      - Trial warnings aggregated to one entry per user and warning code, with the number of trials that raised it, for example `"start-clamped: user small-range, 10 of 10 trials"`. Entries are in first-occurrence order: users in request order and, for each user, codes in the order `start-clamped`, `centre-step-cap`.
    - Write `test/warnings.test.ts`: tests assert the code prefix and the facts in the string (user name, amount, trial counts, missing target role), not the full sentence, and use the exported constants. Each layout warning appears exactly when its condition holds in `head + dwell` and never in `scan`; tremor of exactly 1° gives no note, above 1° gives one note per such user naming the user and the amount in `head + dwell`, and scan mode gives no tremor note even for a user above 1°; trial warnings: counts per user and code (for example 10 of 10 trials), first-occurrence order across users and codes, no entry for a user without that warning; warnings and notes are always arrays of strings, each starting with its code and a colon.
    - _Requirements: 4.14, 4.15, 4.16_

  - [x] 9.3 Run all users and trials.
    - Write `src/run-user.ts`: for each resolved user and each trial index run `runTrial` (head + dwell) and aggregate with `metrics.ts`; trial index and user key feed the streams.
    - Write `test/run-user.test.ts`: the trial count per user; results do not change when another user is added or removed (uses Task 4's keys); each trial has a new engine instance.
    - _Requirements: 1.4, 4.2, 7.1_

  - [x] 9.4 The `simulate` core function.
    - Write `src/simulate.ts`: `simulate(request)` taking a validated `SimulateRequest` with defaults already applied (it applies no defaults itself), running `runUser` for every user, and building the result with `startOfSession` per user, the echo of the seed, the full parameters after defaults, and the resolved users, the accidental selections list (start-of-session events are not in it; they appear only in each user's `startOfSession` line, and `accidental` and the rate exclude them), warnings, notes and the disclaimer. No wall-clock field anywhere.
    - Effective profile echo: `parameters.profile` is the request profile as given. Each entry of `parameters.users[]` is `{ name, params, effectiveProfile }`, where `effectiveProfile` is that user's `getProfile()` after the per-user calibration-range fill and clamping, identical across that user's trials. There is no top-level `parameters.effectiveProfile` (design §7, §11).
    - `suggestions`: this task returns `suggestions: []`; the key is always present. Task 10.3 fills it.
    - Temporary rule: until Task 12 wires the scan driver, `simulate` throws a clear error for `mode: 'scan'`. Task 12.2 replaces this rule.
    - Write `test/simulate.test.ts`: the result has every field from the design §11 example, with `suggestions` equal to `[]`; the seed given in the request is echoed in the result; each `parameters.users[]` entry has `effectiveProfile`, it differs between two users with different head ranges, and `parameters` has no top-level `effectiveProfile`; `mode: 'scan'` throws the clear error; rates and percentiles are `null` with no data; the disclaimer is present.
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.13, 7.2_

  - [x] 9.5 Write property test for Property 1: deterministic.
    - In `test/property-1-deterministic.props.test.ts` (200 runs): generate a full request (layout, users, task, fps, window, seed, 1 to 3 trials), run `simulate` twice and assert `toEqual`; walk the JSON and assert no `Date`-like value and no NaN; run once with the users in reverse order and assert each user's result is unchanged.
    - **Property 1: Deterministic**
    - **Validates: Requirements 4.4, 7.1, 7.2, 7.4**

  - **Covers:** Req 4 AC 2–5, 13–16, 25; Req 7 AC 1, 2, 4; P1.

- [ ] 10. Suggestions and follow-up runs

  - [ ] 10.1 Suggestion rules.
    - Write `src/suggest.ts`: events per target, the reading-pause share (above 50 %: longer dwell, or move the target when it is on the path of a commonly used target of at least 20 % of entries), the tremor-at-edge share (above 50 %: larger target or more spacing), the unreachable rule (uses `reachable.ts`), the minimum of 3 events, and the metric and user names in every suggestion (design §8). Start-of-session events (not accidental selections) are left out of the reading-pause share, the tremor-at-edge share and the 3-event count.
    - Write `test/suggest.test.ts` and `test/suggest.props.test.ts`: a suggestion appears exactly when the share is above 50 % and there are at least 3 events; no suggestion otherwise (also with exactly 50 %); start-of-session events do not count towards the shares or the threshold; each suggestion names the metric and the users; the "on the path" check with a segment-to-rectangle distance fixture.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6, 6.7_

  - [ ] 10.2 Follow-up runs.
    - Write `src/follow-up.ts`: for a tremor-at-edge suggestion try 1.25, 1.5 and 2 times the target size (scaled about the centre, clipped to the screen), rerun only the users that had events on the target with the same seed and task, stop at the first run with zero accidental selections and zero misses on it, and report overlaps with other targets.
    - Write `test/follow-up.test.ts` with a stubbed runner: stops at the first zero run; at most 3 extra runs; no follow-up size when none reaches zero; the multiple is stated in the suggestion.
    - _Requirements: 6.5, 6.8, 6.9_

  - [ ] 10.3 Wire suggestions into `simulate`.
    - Edit `src/simulate.ts` to add `suggestions` to the result (rules from 10.1, follow-up from 10.2, the real runner).
    - Write `test/simulate-suggestions.test.ts`: a layout with a small target and a `strong-head-tremor` user gives a tremor-at-edge suggestion; a clean layout gives none; `test/property-1-deterministic.props.test.ts` still passes.
    - _Requirements: 6.1, 6.2, 6.5, 6.6, 6.8_

  - [ ] 10.4 Suggest keeping the screen centre empty.
    - Extend `src/suggest.ts` with the centre-hit rule (design §8): let `C = (floor(width / 2), floor(height / 2))`; for every selectable target (role not `rest-area`) whose rectangle contains `C`, add one suggestion with `metric: 'screen-centre-hit'`, `users: []` and no follow-up, telling the developer to keep the centre empty or put the rest area there. It applies with or without a rest-area target and is not limited by the 3-event threshold.
    - Write `test/suggest-centre.test.ts` and `test/suggest-centre.props.test.ts`: a suggestion appears exactly when `C` is inside a non-rest-area target, with and without a rest area and with zero events; a rest-area target containing `C` gives none; edge pixels (`x ≤ C.x < x + width`) are decided as in the design; `simulate` returns the suggestion for a layout with a centred target.
    - _Requirements: 6.10_

  - **Covers:** Req 6 AC 1–10.

- [ ] 11. Compare

  - [ ] 11.1 Paired metrics and verdicts.
    - Write `src/pairing.ts`: per-trial pairs of accidental count, miss count and median time-to-select (only entries selected in both, only when at least one such entry exists), wins, ties and the verdict (more wins did better, equal wins is a tie).
    - Write `test/pairing.test.ts` and `test/pairing.props.test.ts`: the verdict follows the win counts for any counts; time-to-select is paired only when both selected; wins + losses + ties equals the number of pairs.
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ] 11.2 The `compare` core function.
    - Write `src/compare.ts`: two configurations with the same users, seed, user keys and trial indices; the layout target index in draw keys is the index in the sorted id order; same-id-set check; the "not a test of statistical significance" statement.
    - Write `test/compare.test.ts`: identical configurations give all ties; differing dwell time gives different results; the statement is present; paired pairs list per user and trial.
    - _Requirements: 5.1, 5.2, 5.6_

  - [ ] 11.3 Write property test for Property 5: same random draws when comparing.
    - In `test/property-5-same-draws.props.test.ts`: configurations differing only in any non-empty subset of the five timing fields. Record the head samples with an `observers.onSample` hook in both runs and assert they are equal element by element up to the sample after the first event whose `(kind, targetId, now)` differs, and that the aim offsets `(zx, zy)` per entry are equal. A second property changes gain, dead zone or screen size and asserts only that the draw keys and `(zx, zy)` are equal, not the samples.
    - **Property 5: Same random draws when comparing**
    - **Validates: Requirements 5.1, 5.7, 5.8**

  - **Covers:** Req 5 AC 1–8; P5.

- [ ] 12. Scan mode (optional, lower priority)

  - [ ]* 12.1 Scan trial driver.
    - Write `src/run-scan-trial.ts`: profile `mode: 'scan'`, no warm-up, no centre step and no start of session (Req 1 AC 6), `source: 'synthetic'` ticks, watching `highlight` events, the right highlight (an item with the aimed id, or a row that contains it), a press after `scanReactionTime`, a late press one item later with the late-press chance (`ScanLatePress` stream), a press held for `scanPressDurationMs` (below `cancelHoldTime`), the `'none'` highlight answered with one press that resumes and selects nothing, `$back` and `$cancel` never pressed, resolution and miss as in head mode, phases `waiting` and `holding` only.
    - Write `test/run-scan-trial.test.ts`: the right item is selected; a late press with chance 100 selects the next item; a resume press selects nothing; a deadline gives a miss; time-to-select starts at `tEntry`; a press shorter than `cancelHoldTime` never produces a cancel.
    - _Requirements: 1.6, 4.7, 4.8, 4.24_

  - [ ]* 12.2 Wire scan mode into the runner and the result.
    - Edit `src/run-user.ts` and `src/simulate.ts` to dispatch `scan` to `run-scan-trial.ts` (this removes the temporary scan error from Task 9.4); reading-pause and tremor-at-edge suggestions are skipped in scan mode (they need head movement); the missing rest area and cancel target warnings apply to `head + dwell` only.
    - Write `test/simulate-scan.test.ts`: a scan request returns the same result shape; the suggestions skip rules apply; `compare` works in scan mode; the head-mode tests still pass.
    - _Requirements: 4.1, 4.7, 4.8, 4.24_

  - **Covers:** Req 1 AC 6; Req 4 AC 7, 8, 24.

- [ ] 13. Checkpoint - core model complete
  - Run `npm test` at the repo root (typecheck, skeleton tests, simulator tests so far). Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Input validation and error codes

  - [ ] 14.1 Tool input schemas.
    - Write `src/tool-schemas.ts`: the zod shapes for `simulate`, `compare` and `list_users` (structure and types only; ranges and caps described in `.describe()` text; design §11) and the output shapes used as `outputSchema`: per-user `startCount` and `startOfSession: { count, byTarget: { targetId: string | null, count }[] }`, the seven-value accidental cause enum (no `start`), and suggestions `{ targetId, metric, users, text, followUp?: { factor, overlaps } }` (`users` may be empty).
    - Write `test/tool-schemas.test.ts`: valid requests parse; a request without `seed` gets seed 1 from the schema default and the `simulate` result echoes 1 (defaults are applied here, not in `simulate`); wrong types are rejected; `list_users` has an empty input shape; every schema field has a description; a `simulate` result example from design §11 (with a non-zero `startOfSession` line and a `screen-centre-hit` suggestion) parses against the output shape.
    - _Requirements: 3.4, 4.1, 4.25_

  - [ ] 14.2 Request validation with stable error codes.
    - Write `src/validate-request.ts`: the checks in the fixed order mode → users count (≤ 12) → preset names and custom ranges → layout (≤ 100 targets, ids, rects, selectable targets) → task (≤ 500 entries, known ids, `ADJACENT_REPEAT` from `expandTask`, `eachTarget` range) → trials (≤ 50) → fps (15, 30, 60) → analysis window (2–120 s) → seed, returning `{ code, parameter, message, allowed? }` for every code in design §11 (`UNKNOWN_PRESET`, `OUT_OF_RANGE`, `CAP_EXCEEDED`, `NOT_ALLOWED_VALUE`, `UNSUPPORTED_MODE`, `NO_SELECTABLE_TARGETS`, `UNKNOWN_TARGET`, `INVALID_LAYOUT`, `ADJACENT_REPEAT`, `LAYOUT_MISMATCH`, `UNKNOWN_PARAMETER`); it resolves valid users with `resolve-user.ts`.
    - The simulator relies on `W > 0` and `TP > 0` (design §4.2), so this task enforces them: a target whose width or height is zero, negative or not finite is `INVALID_LAYOUT` with a message naming the target id and the field (for example `targets["menu"].rect.width`); a throughput (`throughputBitsPerS`) that is zero, negative or not finite is `OUT_OF_RANGE` with a message naming the parameter path and the allowed range.
    - Write `test/validate-request.test.ts`: one example per error code and message (`ADJACENT_REPEAT` names the zero-based index of the second entry and the id, for an explicit list and for a single non-`autoRepeat` target with `eachTarget` above 1, position 1); every cap boundary (accepted 12 users, 50 trials, 100 targets, 500 entries, fps 15/30/60, window 2 and 120; rejected 13, 51, 101, 501, fps 24, window 1 and 121); the unsupported modes `head + gesture`, `gesture scan`, `mouse` name the mode and list the supported ones; the first problem in the fixed order is the one reported; a target with width 0, height 0, a negative side, `NaN` or `Infinity` gives `INVALID_LAYOUT` naming the target id and field; `throughputBitsPerS` of 0, a negative value, `NaN` and `Infinity` gives `OUT_OF_RANGE` naming the parameter.
    - Write `test/validate-request.props.test.ts`: every custom parameter inside its range is accepted and just outside it is rejected with the path and the range in the message; `readingPauseLengthMs.min > max` is `OUT_OF_RANGE`.
    - _Requirements: 3.2, 3.3, 3.6, 4.6, 4.17, 4.18, 4.19, 4.20, 4.21, 4.22, 4.23, 4.26, 4.28_

  - **Covers:** Req 3 AC 2, 3, 6; Req 4 AC 6, 17–23, 26, 28.

- [ ] 15. MCP tools and server entry

  - [ ] 15.1 Tool handlers.
    - Write `src/tool-handlers.ts`: `handleListUsers`, `handleSimulate`, `handleCompare` validate, call the core functions and return `structuredContent` plus one text item with the same JSON; validation errors return `isError: true` with the error object; any exception becomes `INTERNAL_ERROR` and is written to stderr with the seed. This is the one code path used by the server and by the demo run script (Task 20).
    - Write `test/tool-handlers.test.ts`: the disclaimer is in all three tools; each error code comes back as an `isError` result with `structuredContent` equal to the text JSON; an exception gives `INTERNAL_ERROR`; `null` fields stay `null`.
    - _Requirements: 3.4, 3.5, 4.1, 4.5, 5.1_

  - [ ] 15.2 Server entry and build check.
    - Write `src/server.ts` (`#!/usr/bin/env node`): redirect `console.log` to `console.error`, create `McpServer`, register the three tools with `registerTool` and `outputSchema`, connect `StdioServerTransport`; exit with code 1 and the "build the skeleton first" message on stderr when `@planchette/skeleton` cannot be resolved. Import only the `server/mcp.js` and `server/stdio.js` subpaths.
    - Write `test/server.test.ts` using the SDK's in-memory transport pair in the test only: the three tools are listed; an `isError` result passes without output-schema validation; nothing is written to stdout by the handlers. Write `test/build-output.test.ts`: after `npm run build:sim`, `dist/server.js` exists and starts with the shebang (skipped with a stderr note when `dist` is missing).
    - _Requirements: 8.1, 8.2, 8.3, 10.4_

  - **Covers:** Req 8 AC 1–3; Req 4 AC 1.

- [ ] 16. Performance benchmark

  - [ ] 16.1 Benchmark test and recorded measurement.
    - Write `test/performance.test.ts`: 6 presets × 10 trials × 20 entries at 30 fps on a fixed 9-target layout with a rest area, measured with `performance.now()` in the test only, asserting `elapsed < 10 000 ms`, printing the measurement. Append a dated entry with the measured time to `docs/kiro-journal.md`.
    - _Requirements: 7.3_

  - **Covers:** Req 7 AC 3.

- [ ] 17. METHODOLOGY.md

  - [ ] 17.1 Generate the table sections.
    - Write `tools/dwell-sim-mcp/scripts/generate-methodology-tables.ts`: prints the Figures table (with links) and the References from `FIGURES` and `REFERENCES`, and the chosen-values table from the preset data.
    - Write `test/generate-methodology-tables.test.ts`: the output has every `FIGURES` row and every reference link, and every `chosen` reason found in `PRESETS`.
    - _Requirements: 2.5, 2.6_

  - [ ] 17.2 Write METHODOLOGY.md.
    - Write `tools/dwell-sim-mcp/METHODOLOGY.md` in the design §13 order: purpose and disclaimer; the movement model with the formulas of design §4; the generated Figures table with source links; each derived value worked out (scatter SD 72 / 4.133 = 17.4 px and 2.5° / 4.133 = 0.6°; tremor size 12.3 / (2π × 4.25) = 0.46° and 7.77 / (2π × 4.37) = 0.28°; "ET mean + 2 SD = 1.6°" as chosen, not a percentile); the chosen values with reasons (reading pauses, reaction time, noise 0, drift, `MT_MIN`, `READING_DEPTH`, `SETTLE_MS`, `LAG_ALLOWANCE_MS`, noise as uniform peak, scan parameters); the limits, including every Out of scope item, the caveat that tremor is a pure sinusoid while real tremor is less regular (in cervical dystonia often irregular), the open-loop model and engine-level rotation; how determinism works; the start of session (the start path, the cause `start` carried only by start-of-session events, and that they are counted in neither the accidental count nor the rate); and the decision that an event on the aimed target counts as intended once the planned position is inside it; and the frame-rate note: "Frame rate: at 15 fps the smoothed pointer arrives later than at 60 fps (median +70 ms, up to about 270 ms in the measured sample); time-to-select at low fps includes this."
    - Write `test/methodology.test.ts`: the document mentions every `FIGURES` row label, every reference number with its link, every `chosen` parameter's reason in the preset data, every Out of scope item, the sinusoid caveat and the three derived values.
    - _Requirements: 2.5, 2.6_

  - **Covers:** Req 2 AC 5, 6.

- [ ] 18. README

  - [ ] 18.1 Write README.md.
    - Write `tools/dwell-sim-mcp/README.md`: what it is; Node requirement; that a built skeleton is required and the command that builds it (`npm run build --workspace=skeleton`, or `npm run build:sim`); the start commands (`npx dwell-sim-mcp`, `npm run sim --silent`, `node …/dist/server.js`); the Kiro MCP configuration snippet with an absolute path; the warning that stdout is the protocol channel, so clients should launch with `node …/dist/server.js` (npm prints a banner without `--silent`); the tool reference with the three examples from design §11; the limits and the disclaimer.
    - Write `test/readme.test.ts`: the configuration snippet parses as JSON; its `command` is `node` and its last `args` entry ends with the path in the package `bin` (`dist/server.js`); the README contains the skeleton build command, the start command and the stdout warning.
    - _Requirements: 8.2, 8.4, 8.6, 10.4, 10.6_

  - **Covers:** Req 8 AC 2, 4, 6; Req 10 AC 4, 6.

- [ ] 19. MCP end-to-end test

  - [ ] 19.1 Test the built server over stdio.
    - Write `test/server.stdio.test.ts`: start `dist/server.js` as a child process with the SDK's client and `StdioClientTransport` (no network; skipped with a stderr note when `dist/server.js` is missing, and the root `test` script builds first); list the tools; call `list_users`; call `simulate` with a small layout (a few targets, one rest area, one cancel target, one preset, 1 trial); call `compare` with two dwell times; call `simulate` with 13 users and check the `CAP_EXCEEDED` error result; check that nothing but JSON-RPC appears on stdout and the process opens no network connection.
    - _Requirements: 4.1, 4.20, 5.1, 8.1, 8.2_

  - **Covers:** Req 8 AC 1, 2; Req 4 AC 1, 20; Req 5 AC 1.

- [ ] 20. Demo-layout run (Requirement 12)

  - This task depends on `npm run build:sim` and on `npm run build` (the demo page). The two scripts are dev tools: they use the already approved `@playwright/test` from the repo root and are not imported by `src/` (Requirement 8.3 limits the server's runtime imports only). They are compiled by `tsconfig.scripts.json` (Task 2.1) to `dist-scripts/*.js` and run with plain `node`, never with Node's TypeScript support. They import the built simulator from `../dist/*.js`. No new dependency is added.

  - [ ] 20.1 Export the demo layout.
    - Write `tools/dwell-sim-mcp/scripts/export-demo-layout.ts`: serve the built demo page (`vite preview`), open `/` at 1920 × 1080 and again at 1366 × 768, read `window.planchetteDemo.planchette.getTargets()` and the viewport, and write `tools/dwell-sim-mcp/demo-layout-1920x1080.json` and `demo-layout-1366x768.json` as `{ screen, targets }`. The pure conversion is an exported function `toLayoutJson`. Add the workspace script `demo:export` (runs `build`, then `node dist-scripts/export-demo-layout.js`) and the root script of the same name if needed.
    - Write `test/export-demo-layout.test.ts` for `toLayoutJson`: the output has `screen` and `targets` with `id`, `rect`, `autoRepeat` and `role`, and passes `validate-request.ts` layout checks.
    - _Requirements: 12.1_

  - [ ] 20.2 Run the six presets and format the journal entries.
    - Write `tools/dwell-sim-mcp/scripts/run-demo-presets.ts`: call `handleSimulate` from the built `dist/tool-handlers.js` (the same code path as the `simulate` tool) once per preset (`steady`, `slow`, `head-tremor`, `strong-head-tremor`, `small-range`, `reads-while-pointing`, each exactly once) on the 1920 × 1080 layout with the default profile, `{ eachTarget: 3 }` and seed 1, and run the same on the 1366 × 768 layout; format one journal entry per preset (six in total) in the tech.md format (date, what Kiro did, what went wrong or surprised us, what we changed, links to commits or counterexamples) with intended, accidental (per 100), misses, time-to-select median and p90, top causes and suggestions; the 1366 × 768 result is a second line inside the same preset entry. Add the workspace script `demo:run` (runs `build`, then `node dist-scripts/run-demo-presets.js`).
    - Write `test/run-demo-presets.test.ts` for the formatter with a stub result: six entries for six presets, each preset named exactly once, each entry has all the tech.md fields, and the run calls the handler with exactly the six preset names.
    - _Requirements: 12.1, 12.2_

  - [ ] 20.3 Run the scripts and record the results.
    - After `npm run build` and `npm run build:sim`, run `npm run demo:export` and `npm run demo:run` (from `dist-scripts/*.js` with `node`), commit the two JSON layouts, and append the six preset entries to `docs/kiro-journal.md`. Note in the entries anything that went wrong or surprised us.
    - _Requirements: 12.1, 12.2_

  - **Covers:** Req 12 AC 1, 2.

- [ ] 21. Final checkpoint
  - Run `npm test` and `npm run build` at the repo root. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` (scan mode, Task 12) are optional and can be skipped for a first version. All property tests, including the eight numbered properties, are required.
- **Counterexample policy (ongoing, applies to every task):** when a property test finds a counterexample, keep the shrunk case as a named fixed example test in the same area (for example `test/property-N-counterexample.test.ts`) and log it in `docs/kiro-journal.md` with the date, the property number, the counterexample values, the root cause and the fix (tech.md). Property 6's known counterexample is already pinned in 8.11.
- **Note for input-core (not edited by this spec):** the API list in input-core `design.md` §6 should add `pointToRotation(profile, screen, centre, rotation)`, `rotationToPoint(profile, screen, centre, rotation)` and the extended `cancel` event detail `{ targetId?: string; now: number }`. Task 1.7 records this proposal in `docs/kiro-journal.md`.
- No camera or microphone is used in any test. Every sample is synthetic.
- Each task references specific requirements for traceability. Checkpoints (1.8, 13, 21) ensure incremental validation.
- Run order matters: Task 1 before everything, because the simulator imports the helpers and the `cancel` payload.
- Scripts under `scripts/` run from compiler output (`dist-scripts/*.js`) with `node`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "1.5"] },
    { "id": 3, "tasks": ["1.4", "1.6"] },
    { "id": 4, "tasks": ["1.7"] },
    { "id": 5, "tasks": ["1.8"] },
    { "id": 6, "tasks": ["2.1"] },
    { "id": 7, "tasks": ["2.2"] },
    { "id": 8, "tasks": ["2.3", "2.4", "3.1", "4.1"] },
    { "id": 9, "tasks": ["3.2", "5.1", "5.4", "5.5", "5.7"] },
    { "id": 10, "tasks": ["3.3", "4.2", "5.2", "5.3", "5.6", "5.8"] },
    { "id": 11, "tasks": ["6.1"] },
    { "id": 12, "tasks": ["6.2", "6.3"] },
    { "id": 13, "tasks": ["7.1", "8.1"] },
    { "id": 14, "tasks": ["8.2"] },
    { "id": 15, "tasks": ["8.3"] },
    { "id": 16, "tasks": ["8.4"] },
    { "id": 17, "tasks": ["8.5", "8.6", "8.7", "8.8", "8.9", "8.10", "8.11"] },
    { "id": 18, "tasks": ["9.1", "9.2"] },
    { "id": 19, "tasks": ["9.3"] },
    { "id": 20, "tasks": ["9.4"] },
    { "id": 21, "tasks": ["9.5", "10.1", "11.1"] },
    { "id": 22, "tasks": ["10.2", "11.2"] },
    { "id": 23, "tasks": ["10.3", "11.3", "12.1"] },
    { "id": 24, "tasks": ["10.4", "12.2"] },
    { "id": 25, "tasks": ["13"] },
    { "id": 26, "tasks": ["14.1"] },
    { "id": 27, "tasks": ["14.2"] },
    { "id": 28, "tasks": ["15.1"] },
    { "id": 29, "tasks": ["15.2"] },
    { "id": 30, "tasks": ["16.1", "17.1"] },
    { "id": 31, "tasks": ["17.2", "18.1"] },
    { "id": 32, "tasks": ["19.1"] },
    { "id": 33, "tasks": ["20.1", "20.2"] },
    { "id": 34, "tasks": ["20.3"] },
    { "id": 35, "tasks": ["21"] }
  ]
}
```
