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
