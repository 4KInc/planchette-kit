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

---

## 19 Nov 2026 (Task 1: workspace and tooling scaffold)

### What Kiro did

Executed Task 1 (workspace and tooling scaffold) of the input-core spec.

**Files created:**

- `package.json` (root) — npm workspace pointing at `skeleton`; scripts: `test`, `test:e2e`, `build`, `dev`; `"type": "module"` so Vite's native config loader works without warnings.
- `skeleton/package.json` — workspace package `@planchette/skeleton`; `"type": "module"`; `vitest run --passWithNoTests` as the test script (exits 0 when no test files exist yet).
- `skeleton/tsconfig.json` — `strict: true`, `noImplicitAny: true`, `moduleResolution: bundler`, target ES2022.
- `skeleton/vitest.config.ts` — includes `test/**/*.test.ts`.
- `skeleton/src/index.ts` — empty stub export.
- `skeleton/demo/index.html` — placeholder Vite entry point for `/`.
- `apps/board/index.html` — placeholder for `/board/`.
- `apps/game/index.html` — placeholder for `/game/`.
- `vite.config.ts` (root) — multi-page build using `build.rollupOptions.input` with `import.meta.dirname` (not `__dirname`, which is unavailable in native ESM).
- `THIRD_PARTY.md` — lists vite 8.3.8 (MIT), vitest 5.1.1 (MIT), fast-check 4.10.3 (MIT), typescript 7.0.2 (Apache-2.0).
- `.gitignore` — ignores `node_modules/`, `dist/`, `.cache/`.

**Decisions made:**

- Pinned exact versions: vite 8.3.8, vitest 5.1.1, fast-check 4.10.3, typescript 7.0.2 (latest stable at time of writing).
- Added `--passWithNoTests` to the vitest invocation so `npm test` exits 0 before any test files exist. This is the correct baseline for the scaffold task; real tests are added per subsequent tasks.
- Used `import.meta.dirname` instead of `__dirname` in `vite.config.ts` to stay compatible with Vite 8's native ESM config loader.
- `vite` is a root devDependency (the build runs from the root). `vitest`, `fast-check` and `typescript` are skeleton devDependencies because they are only needed to build and test that package.
- `npm run test:e2e` delegates to Playwright (not installed yet; added in task 14 when the camera adapter and e2e tests are written).

**Validation:**

- `npm install` — 91 packages added, 0 vulnerabilities.
- `npm test` — exits 0, zero tests, zero failures.
- `npm run build` — all three HTML entry points built cleanly, 0 warnings.


### Bugfix: Vite build output paths (Task 1 follow-up)

The initial scaffold used `rollupOptions.input` paths pointing at
`skeleton/demo/index.html`, `apps/board/index.html` and `apps/game/index.html`.
Vite mirrors source directory structure into `dist/`, so the build produced
`dist/skeleton/demo/index.html`, `dist/apps/board/index.html` and
`dist/apps/game/index.html` — not the required `dist/index.html`,
`dist/board/index.html`, `dist/game/index.html`.

**Fix:** Added root-level `index.html`, `board/index.html` and `game/index.html` as
the actual Vite entry points. `skeleton/demo/` and `apps/*/` remain the source
directories for each app; the root-level HTML files are the Vite entry points with
`root: "."` in `vite.config.ts`. Added a test (`skeleton/test/build-output.test.ts`)
that asserts the three correct output paths exist and the two wrong paths do not,
so this regression cannot recur silently.

---

## 19 Nov 2026 (Task 1 follow-up: single entry points, self-contained build test)

### What Kiro did

Fixed two issues left over from the path-fix commit.

**Issue 1 — duplicate HTML files.** `skeleton/demo/index.html`, `apps/board/index.html`
and `apps/game/index.html` were left alongside the root-level entry pages, creating two
HTML files per page. Deleted the three source-directory copies. Updated the three root
entry pages (`index.html`, `board/index.html`, `game/index.html`) to load their
respective scripts via `<script type="module">`:

- `index.html` → `skeleton/demo/main.ts`
- `board/index.html` → `../apps/board/src/main.ts`
- `game/index.html` → `../apps/game/src/main.ts`

Created placeholder entry scripts at those three paths (single comment lines) so
Vite resolves them immediately without the app specs being complete.

Updated `structure.md` to list the three root entry pages and show `demo/main.ts`,
`apps/board/src/main.ts` and `apps/game/src/main.ts` as the script homes. Updated
tasks 17.1 and 17.3 to reflect that the demo shell is `index.html` and the script
target is `skeleton/demo/main.ts`.

**Issue 2 — `build-output.test.ts` required a pre-existing `dist/`.** The test
asserted `existsSync` paths under a hard-coded `dist/` directory, so it always failed
on a clean checkout. Rewrote the test to call Vite's `build()` programmatically into
a `mkdtempSync` temporary directory (using the same `rollupOptions.input` as
`vite.config.ts`), check output paths there, and clean up in `afterAll`. The test is
now fully self-contained: `npm test` passes from a fresh clone with no prior build.

**Issue 3 — `build-output.test.ts` duplicated `rollupOptions.input` from `vite.config.ts`.**
The test built from its own hardcoded input list, so a misconfigured `vite.config.ts`
would not be caught. Switched to `build({ configFile: <repo root>/vite.config.ts, ... })`
so the test drives the real config. Removed the duplicated `rollupOptions.input` from
the test.

Vite 8 (rolldown) requires the `outDir` to be a path relative to `root`, not an
absolute path outside it; rolldown computes HTML output `fileName`s as
`relative(outDir, inputFile)` and rejects any result starting with `../`. Passing
`root` explicitly alongside `configFile` ensures the relative `outDir` resolves
correctly regardless of the process cwd when vitest runs. The temp dir lives under
`.build-test-tmp/` (gitignored) and is removed in `afterAll`.

**Validation:**

- `npm test` from clean checkout (no dist/) — 5/5 pass.

---

## 19 Nov 2026 (Task 2: Profile type, defaults, clamping, import/export)

### What Kiro did

Implemented `skeleton/src/engine/profile.ts` with all 30 fields from the Profile fields table in requirements.md. Cross-checked count: the requirements table has exactly 30 data rows (confirmed by extracting all pipe-delimited rows from the `## Profile fields` section and counting them). Task 2.6 includes a test that enumerates `Object.keys(defaultProfile)` and asserts the count is 30.

**Files created:**

- `skeleton/src/engine/profile.ts` — `Profile` interface (30 fields, no `any`), `defaultProfile`, `clampProfile`, `exportProfile`, `importProfile`.
- `skeleton/test/profile.test.ts` — 15 example tests covering defaults round-trip, field count, clamping order, `__proto__` ignored, missing field defaults, dependent clamping.
- `skeleton/test/profile.props.test.ts` — P17 in full: (a) round-trip for any valid profile; (b) every field in range for any arbitrary JSON input; (c) exactly 30 known fields regardless of input, including `__proto__` injection.

**Clamping order implemented (Req 7 AC 5):**
1. Calibration ranges (3–90 deg each)
2. Dead zone (0 to 0.5 × min range)
3. Cancel hold time (1000–5000 ms)
4. Both acceptance times (must be < cancelHoldTime)
5. Gesture threshold (0.1–0.95)
6. Release threshold (0.05 to gestureThreshold − 0.05)

**`importProfile` reads each of the 30 fields by name explicitly — never spreads the parsed object — so `__proto__` and unknown keys are silently ignored (Req 7 AC 6).**

**One implementation note:** `fc.float` in fast-check requires `Math.fround`-rounded bounds (32-bit float values). Applied `Math.fround` to all float min/max values in the property test arbitraries.

**Validation:**

- `npm test` — 25/25 pass (5 existing + 15 example + 5 property).

19 Nov 2026: Task 2 review fixes: clampProfile falls back (and clamps the fallback) on NaN, Infinity and wrong types; import reports missing fields; scanLoopsBeforePause rounded; unused variable removed; __proto__ test uses a raw JSON string.

19 Nov 2026: Task 3: press machine with example and property tests (P7, P18, P5 partial); build-output test now deletes only its own temp folder.

19 Nov 2026: Task 4: dwell engine with example and property tests (P1, P2, P8, P14, P19); added @types/node and a typecheck step to npm test; stepPress acceptanceTime now required.
19 Nov 2026: Task 4 review fixes: dwell caps one sample gap at 100 ms, no dwell time counts during the post-selection pause, stay end and pointer loss emit progress 0; shared target types moved to targets.ts; design.md and tasks.md updated; Tasks 2 to 4 ticked.

20 Nov 2026: Task 5: scan engine with example and property tests (P6, P8, P9); scan design written into design.md §5; Task 5 ticked.
20 Nov 2026: Task 6: the smoother tuning test caught that the design's starting values missed the tremor target (fC_min at s = 1 lowered from 0.3 to 0.2 Hz); the preset targets are now promised at 30 fps or more with up to ±20 % frame spacing, and 15 and 24 fps are measured and reported only, because below 30 fps the camera cannot capture fast tremor reliably.
20 Nov 2026: Task 7: head-pointer engine (mapping, face lock, no-face timeout, gesture freeze) with example and property tests (P10, P11 fed through the real engine, P13, P16, P20); P10 found that a freeze position was not clamped when the screen shrank (counterexample: 1 x 2 screen shrinking to 1 x 1 during a brow-raise freeze), fixed and pinned as an example test; open spec points decided in design.md §4.
20 Nov 2026: Calibrated centre made session state (centre step on camera start, recentre(), profile stays at 30 fields; Req 7 AC 2, design §1, §4, §6 and Tasks 9, 11, 14 updated). Task 8: gesture engine using gestureAcceptanceTime, with example and property tests (P12, P3 partial, P7 for gestures); a face loss drops a gesture without a press, and a head + gesture gesture whose freeze expired cannot press.
20 Nov 2026: Task 9: calibration engine (centre, four head ranges, tremor, hands-free gesture rest and deliberate step, centre-only run) with example tests; gesture step added to the spec first (Req 5 AC 5), thresholds = rest + 0.6 and 0.3 of the range, kept when the range is under 0.15; 21 deliberate engine breaks all caught by the tests.
20 Nov 2026: Fixes before Task 10: importProfile no longer throws on values that cannot become strings (describeValue: safe JSON.stringify, type-name fallback, truncated; fixed example test for {"mode":{"toString":null}}); calibration direction steps and the deliberate-gesture phase now count stillness only while the person is doing the step (head 3 deg from centre in the direction, score 0.15 above rest), so slow starters are measured correctly; 20 consecutive test runs passed.
20 Nov 2026: npm package decision recorded (docs/npm-package-plan.md, steering updated; nothing published, skeleton stays private at 0.0.0) and the build set up (tsconfig.build.json, exports, .js import extensions so dist loads in Node, TypeScript 7 emits .d.ts and maps, build test); Task 11: createPlanchette with all engines wired, per-source clocks, cancel routing, calibration and start-up centre step, plus example and property tests (P5 full); the Task 10 cancel-role wiring is still open.
20 Nov 2026: Task 10: a cancel-role target now cancels instead of selecting (dwell, scan item, gesture, mouse), once per stay with autoRepeat ignored; every cancel path tested end to end through createPlanchette and feedSamples, and P4 through the API (cancel input from any reachable state: one cancel, idle in one step; hold of any length gives one cancel or one press); 19 deliberate breaks caught.
20 Nov 2026: Tasks 12 and 13: P15 through the API at 15 and 60 fps (boundary conditions B1–B5 in design §9; with the smoother in the path select times differ by up to 133 ms at 15 fps, so paths reset the filter between moves and a second property checks dwell timing after arrival), P16 in full (per-source bad timestamps, camera delay, shared keyboard/gamepad frame times), edge-case examples recording measured behaviour including a float-sum quirk that makes a 15-frame stay select one frame late; minimal.ts head + dwell example in 11 lines, type-checked against the built package.
20 Nov 2026: P15 wording in requirements.md now matches the test (B1–B5, dwell timing frame-rate independent, pointer up to about 133 ms later at 15 fps from the smoother); dwell and auto-repeat comparisons get a 1e-6 ms float tolerance so an exact-length stay selects on its frame. Task 14 (14.1–14.8): camera adapter with MediaPipe FaceLandmarker served from the app's origin, keyboard, mouse and gamepad adapters, plain-language failure messages and a camera status box, retry, all tested with fakes (no real camera); @mediapipe/tasks-vision pinned to 0.10.35 because 1.x sends usage statistics to odml.pa.googleapis.com, guarded by a test.
20 Nov 2026: Tasks 15 and 16: P3 in full through the API (frameless, no-face-timeout and real permission-denied/load-failed lost periods, head + dwell and head + gesture); low confidence defined (heuristic from MediaPipe landmarks, one event per episode with hysteresis and a 1 s recovery); dwell ring, scan highlight and the single tracking indicator (moved from Task 14) under @planchette/skeleton/ui; Playwright e2e with synthetic samples, localhost-only and no-googleapis request checks, axe-core clean (fixed one region finding on the virtual scan item); axe is MPL-2.0, recorded as a dev-only exception.
21 Nov 2026: Task 17: Halloween demo page (3×3 grid, Cancel, Undo, rest area, mode switcher, Calibrate, profile export/import, camera only on the Start button) on the dwell ring, scan highlight and tracking indicator; the same Content-Security-Policy on all three pages (self only, plus 'wasm-unsafe-eval' for MediaPipe; no inline script or style), one inline style attribute in the tracking indicator moved to the DOM; e2e now also runs on the production build (44 tests: no CSP violations, nothing leaves localhost, dwell/scan/mouse selects, axe, WCAG AA colours); breaking it with a CDN script and with camera auto-start was caught by the tests. Task 18 not started.
21 Nov 2026: Short presses: the keyboard and mouse adapters now queue each switch press and release with the event's own timeStamp and send them before the next frame sample (0.001 ms nudge keeps per-source times increasing; down, up, down in one frame is one press, still held), so a 5 ms tap or click selects at switchAcceptanceTime 0 and is ignored at 100; gamepad stays polled, a sub-frame press can be missed (design §7 Short presses); 17 new unit tests and a real quick-click e2e test on the demo, all failing with edges switched off; the demo scan e2e test was flaky (listener attached after scanning began) and is fixed.
21 Nov 2026: dwell-sim-mcp Task 1: three public API additions, `pointToRotation` and `rotationToPoint`, and a `cancel` payload of `{ targetId?, now }`; the pointer mapping now lives once in `skeleton/src/engine/pointer-mapping.ts` and the head-pointer engine uses it; the round-trip and engine-agreement property tests passed with no counterexample; existing cancel tests changed from `{}` to `{ now }` / `{ now, targetId }`. Proposed edit for the input-core owner (this spec does not edit input-core files): add the two helpers and the extended `cancel` event to the API list in input-core design.md §6.
21 Nov 2026: dwell-sim-mcp Task 2: package `tools/dwell-sim-mcp` scaffolded and wired into the root workspaces (typecheck, build:sim, test); SDK 1.32.2 and zod 4.6.7 pinned, 86 production dependency rows added to THIRD_PARTY.md with a test that keeps it in sync, plus a static-rule test for src. Surprises: the existing skeleton test that scans apps/ and tools/ for skeleton-internal imports matched a fixture string in our static-rules test, so the fixture path is now built at runtime; the default npm cache had an EACCES problem, so install used a temporary cache. Also: input-core design §6 now lists the two helpers and the cancel payload (the Task 1 follow-up), and requirements 4.2 and 4.25 now leave start-of-session events out of both the accidental count and the rate.
21 Nov 2026: dwell-sim-mcp Task 3: preset data and `list_users`: 15 figure rows and 8 references as typed data, checked against requirements.md by a test; six presets with every value parsed from the Presets tables in the test; ranges; `listUsers()` with a golden file. Tracking noise stays 0 until input-core 14.9. The 0.90 bits/s pairing is a figure source with a "chosen pairing" note because the source type cannot carry both.
21 Nov 2026: dwell-sim-mcp Task 4: counter-based random draws (`hash32`, `stream`, `u01`, with pinned outputs) and `resolveUser` with typed errors; user keys depend only on the user, and a property test shows that adding, removing or reordering other users changes no key or draw. Two small fixes done first: the Task 2 entry was glued to the Task 1 line and is now on its own line, and `@types/node` 24.19.2 is a pinned devDependency of the package, with a test.
21 Nov 2026: dwell-sim-mcp Task 5: movement primitives: geometry through the skeleton helpers, reachable rectangle, Acklam probit with coefficients added to design §4.4 from the stackedboxes.org reproduction (independently checked: max relative error 1.135e-9) and a test against five exact quantiles plus the ttn clamp, truncated aim scatter with exactly two draws, tremor with no module cache (pure, three hashes per call), minimum-jerk, Fitts MT with W>0/TP>0 left to validation (Task 14 line added), task expansion with taskOrder = stream(seed, 0, 0, Purpose.TaskOrder) (design gap found and settled) and ADJACENT_REPEAT validation. Two design gaps stopped the run and were settled by the user: the task-order stream key and the probit coefficients.
21 Nov 2026: dwell-sim-mcp Task 6: head path planning: planEntry with reading pauses (reaction time is the fixed user value, pause at the midpoint of the crossing), head function as a pure function of time with a cursor (createHeadModel factory, no cache), planStart for the start of session (clamped refers to the rest rectangle's centre). Open interpretations for Task 7 review: PlanContext shape not in the design, pause of length 0 still emitted, final hold skipped when moves overrun the deadline, empty segments give pose (0,0).
21 Nov 2026: dwell-sim-mcp Task 7: classification: design §6 had gaps in the tremor-at-edge amplitude (ampPx) and nine boundary rules; the run stopped and the user settled them (one formula: tremor and noise added in degrees, max over the four sign corners, Euclidean in px, +1 px; tremor-or-noise rule; miss cause at the aim pose; half-open inside test; repeat state reset at the start plan's tEnd; unattributed events never repeat) and they are written into §6. `classify` takes a caller-owned ClassifyState (the driver must call notePointerMove on every pointer-move); `ampPx` unit tests cover edge clamping and the dead zone; a property test shows every event gets exactly one category; plan-entry now exports insideRect.
22 Nov 2026: dwell-sim-mcp Task 8 (except 8.9): trial driver (warm-up, start of session, entry loop with in-frame plan switch, deadline frame, last-entry rule; four ordering gaps settled by the user and written into design §5); properties 2, 3, 4, 6 (with the pinned counterexample) and 8 pass. Property 2's dwell margin is derived (L = 150 ms from smoother.test.ts plus one frame) and its generator now bridges consecutive task targets, so 54–68 % of runs have an entry stay (smallest margin about 125 ms). Found and fixed a generator bug: customUserArb made ranged fields optional, so narrowed ranges were often not applied (B4 in P7, coverage in P3/P8). Property 7 (8.9) still fails with the derived bound 283.33 ms (up to 550 ms observed); the exact dwell-part identity holds in every run and the cause is being measured; the P7 test file is not committed.
22 Nov 2026: dwell-sim-mcp Task 8.9: Property 7 narrowed (user decision) to the same ordered selection list at 15 and 60 fps and the exact dwell identity tts − arrival = ceil(dwellTime / F) × F; the derived bound L + 2 × F(15) = 283.33 ms was tried and does not hold, because the smoother's arrival lag for the simulator's slow movement depends on frame rate (seed 7001, 300 single-entry runs: 15 fps median 146 / p99 361 / max 549 ms, 60 fps median 75 / p99 201 / max 283 ms); |tts15 − tts60| is now printed, not asserted (up to 533 ms over seeds 1–6); recorded as a finding for METHODOLOGY.md. Also a generator bug found on the way: B4 was violated through optional ranged fields, fixed at source in customUserArb.
22 Nov 2026: dwell-sim-mcp Task 9: metrics (aggregateUser, nearest-rank median taken as the lower middle, round1 applied only in the output), warnings and notes as code-prefixed strings (tremor note only in head + dwell), runUser, simulate (per-user effectiveProfile echo, suggestions [] until Task 10, scan throws until Task 12, defaults applied by validation in Task 14); Property 1 deterministic (200 runs, reversed user order leaves each user unchanged). Three rounds of design gaps settled by the user (rounding, perTarget order and membership, breakdown keys, warning texts, user-row targetId, effective profile echo). The Property 2 coverage check was flaky (49 % once); its generator now builds the layout from the task so every run has an entry stay.
22 Nov 2026: dwell-sim-mcp Task 10: suggestions (reading-pause and tremor-at-edge shares above 50 % with at least 3 events, unreachable per target, screen-centre-hit last, bare metric names with a separate value, fixed text templates), follow-up runs at 1.25/1.5/2× with the same seed and a stubbed-runner test, wired into simulate. Req 6 AC 7 clarified to "event-based suggestions" (the unreachable rule, like the centre rule, comes from geometry, so the 3-event minimum does not apply to it). Eleven design gaps in §8 and seventeen in §9 were settled by the user before coding. Follow-ups: simulate now echoes the layout in parameters.layout, and Property 2 has a second test on general layouts beside the row-layout one.
22 Nov 2026: dwell-sim-mcp Task 11: observers.onSample hook in the driver (no call or allocation when unset; results identical with and without it), pairing (one pair per user and trial, median over entries selected in both, skipped trials for time-to-select), compare (shared task from layout A, A:/B: merge of warnings and notes, LAYOUT_MISMATCH with the sorted symmetric difference), Property 5 (100 + 100 runs; 52 of 100 part-1 runs had a differing event). Property 5's first counterexample showed that "up to and including the frame after the first differing event" was wrong, because an entry may resolve before its move ends, so the next frame can already be under a different entry; the cut-off is now inclusive of the event's frame only, and the counterexample is pinned as a named test (frames 0–127 equal, frame 128 differs). The unreachable suggestion rule is now head + dwell only (in scan, head range does not decide reachability).
23 Nov 2026: dwell-sim-mcp geometry uses the engine's captured centre: Property 3 found (seed −1448156187, about 16 % of seeds) that the simulator planned with a zero centre while the engine maps relative to the centre it captured at warm-up, so a constant warm-up offset (near-zero-frequency tremor) made an "unreachable" target selectable; the geometry now maps pixels ↔ head angles through `result.centre` of the calibration-step done event, headRangeDeg stays absolute and the clamp stays on the absolute pose; aims, the reachable rectangle, the start plan and classification use the same mapping; the unreachable suggestion requires the target to be outside the reachable rectangle in every trial; Property 3 keeps tremor and noise on and passes on 25 seeds; the case is pinned in property-3-regression.test.ts (with the captured centre the target is partly reachable and the entry is a tremor-at-edge miss).
23 Nov 2026: dwell-sim-mcp Task 14: tool schemas (zod 4 raw shapes and objects, accepted by SDK 1.32.2 registerTool; defaults seed 1, fps 30, window 10 s, 10 trials) and request validation with stable codes in a fixed order (paths from the request root, a./b. for compare sides; below a count's minimum OUT_OF_RANGE, above its cap CAP_EXCEEDED, both with the real range in `allowed`); custom tremor frequency is 0 (off) or 1–15 Hz, because a tiny non-zero frequency is a constant tilt, not tremor; a rest-area id in an explicit task is UNKNOWN_TARGET; scan mode is deferred to Task 12 and rejected with UNSUPPORTED_MODE listing head + dwell only. Property 7 now assumes each planned aim lies inside its target (fc.pre, 0 discards; B1/B2 discard about 77 % of generated cases) and sizes targets from the scatter cap in all four directions including the dead zone; seeds 199 and 295 are pinned in property-7-regression.test.ts; every property suite passed on 23 seeds (P7 on 25) before this commit.
23 Nov 2026: dwell-sim-mcp Property 7 models the engine's grace chaining: a pre-commit sweep found (seed 39595) that a stay on the intended target can continue across an off-target gap of at most graceTime, so the test's arrival (first frame of the last unbroken run) was too late; arrival is now the first frame of the earliest run the engine chains to the selecting run, the identity subtracts the sampled gap time, and the new B6 excludes gaps within one 15 fps frame of graceTime, because such a gap continued the stay at 60 fps (483.33 ms, graceTime 497 ms) and reset it at 15 fps (533.33 ms); the case is pinned in property-7-regression.test.ts; B6 discarded 0 of the cases that passed B1/B2 in seeds 1–25 (total discard still 75–82 %); 23 global seeds and P7_SEED 1..25 passed.
23 Nov 2026: dwell-sim-mcp Task 15: tool handlers (one code path for the server and the demo script; the success text is the compact JSON of structuredContent; validation errors come back as isError results; exceptions become INTERNAL_ERROR with a stderr line that carries the seed, never stdout; a trailing period is stripped so the message never ends in ".."), the server entry and a createServer factory registering list_users, simulate and compare with input and output schemas; the built dist/server.js lists the three tools over stdio with the SDK client; the tool package is now "private": true and nothing is published.
23 Nov 2026: Where the specs and tests surprised us:
23 Nov 2026: Property 3 found that the simulator planned with a zero centre while the engine maps relative to the centre it captures at warm-up; fixed in 0907ac5.
23 Nov 2026: Property 5's counterexample showed the planned cut-off rule ("compare up to the frame after") was wrong; the property now compares up to and including the cut-off frame.
23 Nov 2026: Measuring Property 7 at 15 fps disproved an assumed arrival-lag bound (283 ms tried and failed), so the property was narrowed to what is actually true: same selections at 15 and 60 fps, and the exact dwell identity.
23 Nov 2026: Property 7 found that a gap close to graceTime can continue a stay at 60 fps and reset it at 15 fps (seed 39595).
23 Nov 2026: Tooling: the seed sweep became a hook because it was being run by hand before every commit; `scripts/seed-sweep.sh` runs the dwell-sim-mcp suite under 23 fast-check global seeds (FC_SEED via `test/setup-fc-seed.ts`) and Property 7 with P7_SEED 1..25, behind a Manual hook `.kiro/hooks/seed-sweep.json` and the `/seed-sweep` manual steering file (new Manual hooks may not be creatable in IDE 1.x); an on-save hook runs `tsc --noEmit` and `vitest related` for saved `src/**/*.ts` files and reports failures only.
23 Nov 2026: Performance (design §12, Requirement 7 AC 3): 6 presets × 10 trials × 20 entries at 30 fps on a 9-target layout with a rest area, through `validateSimulateRequest` + `simulate`, took 133, 133 and 135 ms in three runs (min 133, median 133, max 135 ms; bound 10 000 ms; Node v24.6.0, Apple M1 Max).
23 Nov 2026: Tasks 17 and 18: METHODOLOGY.md (formulas, generated Figures/References/Chosen-values tables from the data, derived values worked out, constants taken from src, limits including the captured-centre, 15 fps arrival-lag and grace-chaining notes; a test checks every figure, reference link, chosen reason, Out of scope item and note) and README.md (build and start commands, the stdout warning, a Kiro `.kiro/settings/mcp.json` snippet checked against kiro.dev, tool reference with real example outputs validated against the output schemas; private package, scan deferred); scripts/placeholder.ts removed now that a real script exists. Seed sweep: 48 runs (23 FC_SEED + 25 P7_SEED), 0 failures, 111 s; `npm test`: skeleton 37 files / 704 tests, dwell-sim-mcp 78 files / 672 tests, all passed.
23 Nov 2026: Task 19: the stdio test from 15.2 now calls each tool once over stdio against the built server (list_users, one simulate, one compare), validates each result against its output schema, checks the CAP_EXCEEDED error result for 13 users, that stdout carries only JSON-RPC, and how the no-network check is done (the child runs with a test-only `--import` preload that records and throws on net/dgram connect, listen and send, and the test asserts the log stayed empty); no second stdio file.
23 Nov 2026: dwell-sim-mcp demo run: steady. What Kiro did: ran simulate through handleSimulate on the demo layout 1920x1080 and 1366x768 for the preset steady, default profile, task { eachTarget: 3 }, seed 1, fps 30, analysis window 10 s, 10 trials. Result (1920x1080): intended 300, accidental 2 (per 100 intended: 0.7), start-of-session 0, misses 30 (miss causes: aim-outside-target 30), time-to-select median 1833.3333333333285 ms and p90 2066.666666666668 ms, top causes: other 2, suggestions: none. Second line (1366x768): intended 315, accidental 0 (per 100 intended: 0), start-of-session 0, misses 15 (miss causes: aim-outside-target 15), time-to-select median 1833.3333333333358 ms and p90 2100 ms, top causes: none, suggestions: none. What went wrong or surprised us: 1920x1080: 2 accidental selections, both with cause other, no per-target detail or suggestion reported; 30 misses. 1366x768: 0 accidental, 15 misses. No start-of-session events at either size. The first run did not report a cause for misses; the rerun classifies all of them as aim-outside-target. The two layout files hold the same target rectangles and differ only in screen size. No warning printed. What we changed: nothing, measurement only. Links: tools/dwell-sim-mcp/demo-layout-1920x1080.json, tools/dwell-sim-mcp/demo-layout-1366x768.json, commit: the one that adds this entry.
23 Nov 2026: dwell-sim-mcp demo run: slow. What Kiro did: ran simulate through handleSimulate on the demo layout 1920x1080 and 1366x768 for the preset slow, default profile, task { eachTarget: 3 }, seed 1, fps 30, analysis window 10 s, 10 trials. Result (1920x1080): intended 308, accidental 4 (per 100 intended: 1.3), start-of-session 0, misses 22 (miss causes: aim-outside-target 22), time-to-select median 2766.6666666666715 ms and p90 3433.3333333333285 ms, top causes: early-on-intended-target 2, pass-over 2, suggestions: none. Second line (1366x768): intended 318, accidental 1 (per 100 intended: 0.3), start-of-session 0, misses 12 (miss causes: aim-outside-target 12), time-to-select median 2833.3333333333358 ms and p90 3433.333333333332 ms, top causes: early-on-intended-target 1, suggestions: none. What went wrong or surprised us: 1920x1080: 4 accidental selections (2 early-on-intended-target, 2 pass-over), 22 misses. 1366x768: 1 accidental (early-on-intended-target), 12 misses. No start-of-session events, no suggestions, no warning. Median time-to-select about 2.8 s at both sizes (steady: 1.8 s). What we changed: nothing, measurement only. Links: tools/dwell-sim-mcp/demo-layout-1920x1080.json, tools/dwell-sim-mcp/demo-layout-1366x768.json, commit: the one that adds this entry.
23 Nov 2026: dwell-sim-mcp demo run: head-tremor. What Kiro did: ran simulate through handleSimulate on the demo layout 1920x1080 and 1366x768 for the preset head-tremor, default profile, task { eachTarget: 3 }, seed 1, fps 30, analysis window 10 s, 10 trials. Result (1920x1080): intended 309, accidental 3 (per 100 intended: 1), start-of-session 0, misses 21 (miss causes: aim-outside-target 21), time-to-select median 2266.6666666666642 ms and p90 2666.6666666666715 ms, top causes: tremor-at-edge 3, suggestions: Target skull: 60 % of the events on it come from tremor at the target edge. Try a larger target or more spacing. Second line (1366x768): intended 318, accidental 1 (per 100 intended: 0.3), start-of-session 0, misses 12 (miss causes: aim-outside-target 12), time-to-select median 2266.6666666666715 ms and p90 2700 ms, top causes: tremor-at-edge 1, suggestions: none. What went wrong or surprised us: 1920x1080: 3 accidental selections, all tremor-at-edge, 21 misses; one suggestion, for skull (60 % of events on it from tremor at the edge). 1366x768: 1 accidental (tremor-at-edge), 12 misses; no suggestions. No start-of-session events, no warning. What we changed: nothing, measurement only. Links: tools/dwell-sim-mcp/demo-layout-1920x1080.json, tools/dwell-sim-mcp/demo-layout-1366x768.json, commit: the one that adds this entry.
23 Nov 2026: dwell-sim-mcp demo run: strong-head-tremor. What Kiro did: ran simulate through handleSimulate on the demo layout 1920x1080 and 1366x768 for the preset strong-head-tremor, default profile, task { eachTarget: 3 }, seed 1, fps 30, analysis window 10 s, 10 trials. Result (1920x1080): intended 317, accidental 3 (per 100 intended: 0.9), start-of-session 0, misses 13 (miss causes: aim-outside-target 12, tremor-at-edge 1), time-to-select median 2266.6666666666715 ms and p90 2800 ms, top causes: tremor-at-edge 3, suggestions: Target bat: 67 % of the events on it come from tremor at the target edge. Try a larger target or more spacing. Second line (1366x768): intended 325, accidental 0 (per 100 intended: 0), start-of-session 0, misses 5 (miss causes: aim-outside-target 4, tremor-at-edge 1), time-to-select median 2266.6666666666715 ms and p90 2766.666666666668 ms, top causes: none, suggestions: none. What went wrong or surprised us: 1920x1080: 3 accidental selections, all tremor-at-edge, 13 misses; one suggestion, for bat (67 %). 1366x768: 0 accidental, 5 misses, no suggestions. Fewer accidental selections and fewer misses than head-tremor at both sizes, which we did not expect. No start-of-session events, no warning. What we changed: nothing, measurement only. Links: tools/dwell-sim-mcp/demo-layout-1920x1080.json, tools/dwell-sim-mcp/demo-layout-1366x768.json, commit: the one that adds this entry.
23 Nov 2026: dwell-sim-mcp demo run: small-range. What Kiro did: ran simulate through handleSimulate on the demo layout 1920x1080 and 1366x768 for the preset small-range, default profile, task { eachTarget: 3 }, seed 1, fps 30, analysis window 10 s, 10 trials. Result (1920x1080): intended 300, accidental 3 (per 100 intended: 1), start-of-session 0, misses 30 (miss causes: aim-outside-target 30), time-to-select median 2233.3333333333358 ms and p90 2866.666666666666 ms, top causes: early-on-intended-target 2, pass-over 1, suggestions: none. Second line (1366x768): intended 314, accidental 0 (per 100 intended: 0), start-of-session 0, misses 16 (miss causes: aim-outside-target 16), time-to-select median 2366.6666666666642 ms and p90 2866.666666666657 ms, top causes: none, suggestions: none. What went wrong or surprised us: 1920x1080: 3 accidental selections (2 early-on-intended-target, 1 pass-over), 30 misses. 1366x768: 0 accidental, 16 misses. No start-of-session events, no suggestions, no warning. Median time-to-select 2.2 s and 2.4 s. What we changed: nothing, measurement only. Links: tools/dwell-sim-mcp/demo-layout-1920x1080.json, tools/dwell-sim-mcp/demo-layout-1366x768.json, commit: the one that adds this entry.
23 Nov 2026: dwell-sim-mcp demo run: reads-while-pointing. What Kiro did: ran simulate through handleSimulate on the demo layout 1920x1080 and 1366x768 for the preset reads-while-pointing, default profile, task { eachTarget: 3 }, seed 1, fps 30, analysis window 10 s, 10 trials. Result (1920x1080): intended 311, accidental 79 (per 100 intended: 25.4), start-of-session 0, misses 19 (miss causes: aim-outside-target 19), time-to-select median 2333.333333333332 ms and p90 3800 ms, top causes: reading-pause 79, suggestions: Target candle: 100 % of the selections on it happen during a reading pause. Try a longer dwell time. Target cauldron: 100 % of the selections on it happen during a reading pause. Try a longer dwell time. Target pumpkin: 100 % of the selections on it happen during a reading pause. Try a longer dwell time. Target skull: 100 % of the selections on it happen during a reading pause. Try a longer dwell time. Target spider: 100 % of the selections on it happen during a reading pause. Try a longer dwell time. Target witch: 100 % of the selections on it happen during a reading pause. Try a longer dwell time.. Second line (1366x768): intended 318, accidental 69 (per 100 intended: 21.7), start-of-session 0, misses 12 (miss causes: aim-outside-target 12), time-to-select median 2300 ms and p90 3833.3333333333285 ms, top causes: reading-pause 69, suggestions: Target candle: 100 % of the selections on it happen during a reading pause. Try a longer dwell time. Target cauldron: 100 % of the selections on it happen during a reading pause. Try a longer dwell time. Target pumpkin: 100 % of the selections on it happen during a reading pause. Try a longer dwell time. Target skull: 100 % of the selections on it happen during a reading pause. Try a longer dwell time. Target spider: 100 % of the selections on it happen during a reading pause. Try a longer dwell time. Target witch: 100 % of the selections on it happen during a reading pause. Try a longer dwell time.. What went wrong or surprised us: Largest accidental rate by far. 1920x1080: 79 accidental selections (25.4 per 100 intended), all reading-pause; 19 misses. 1366x768: 69 accidental (21.7 per 100), all reading-pause; 12 misses. Suggestions at both sizes name candle, cauldron, pumpkin, skull, spider and witch (100 % of selections on each during a reading pause) and propose a longer dwell time. p90 time-to-select 3.8 s at both sizes. No start-of-session events, no warning. What we changed: nothing, measurement only. Links: tools/dwell-sim-mcp/demo-layout-1920x1080.json, tools/dwell-sim-mcp/demo-layout-1366x768.json, commit: the one that adds this entry.
23 Nov 2026: Task 20: the demo layouts were exported from the built demo page with Playwright at 1920×1080 and 1366×768 and the six presets ran once each per layout through the `simulate` handler (eachTarget 3, seed 1, defaults fps 30, window 10 s, 10 trials); results are in the six entries above.
23 Nov 2026: Task 21 final checkpoint: `npm test` (skeleton 704 tests, dwell-sim-mcp 685 tests) and `npm run build` passed, and the seed sweep passed; a check of the demo run found that every miss (30 of 330 entries for steady at 1920×1080, 15 at 1366×768) is an aim point that the truncated scatter placed outside a 96 px target (no miss with the aim inside, no unreachable target, the 10 s window never binding), an expected result of the endpoint model with no corrective submovement, not a defect; the simulate output does not aggregate miss causes and all such misses carry cause `other`, so a miss cause for "aim outside the target" would make this visible.
24 Nov 2026: Post-release fixes: new miss cause aim-outside-target (planned aim outside the target's rect), aggregated as missCauses per user and per target with all four keys, in requirements, design, the output schema, the README examples and tests; the demo-run journal entries are now dated with the local day (a test runs the compiled script with TZ set); demo presets rerun: intended, accidental, per 100, start-of-session, misses, median, p90 and top causes unchanged at both layouts, but the suggestions changed (head-tremor 1920x1080 from five targets to skull 60 %, 1366x768 from two to none; strong-head-tremor 1920x1080 from bat and spider to bat 67 %; the other presets unchanged), so those two entries were corrected; miss-cause breakdown added to the six entries (e.g. all 45 steady misses are aim-outside-target, 30 at 1920x1080 and 15 at 1366x768).
