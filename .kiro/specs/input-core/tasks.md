# Tasks: input core

## Overview

Tasks are ordered so each one builds on a stable, tested foundation. The workspace
and tooling come first, then the pure-logic modules with their property tests, then
the engines from simplest to most complex, then adapters and UI last. No task touches
the camera, the DOM or any adapter until task 14.

Each task references the requirements (Req N AC M) and properties (P N) it covers.

---

## Task 1: Workspace and tooling scaffold

Set up the npm workspace, Vite multi-page build, Vitest and fast-check so every later
task has a working test runner from the start.

- [x] 1.1 Create root `package.json` with `workspaces: ["skeleton"]` and scripts: `test`, `test:e2e`, `build`, `dev`. (Other packages are added in their own specs.)
- [x] 1.2 Create `skeleton/package.json` with `name: "@planchette/skeleton"`, devDependencies: `vitest` (pinned), `fast-check` (pinned), `typescript` (pinned). Add `tsconfig.json` with `strict: true`, `noImplicitAny: true`.
- [x] 1.3 Create `vite.config.ts` at root with multi-page entries: `/` → `skeleton/demo/index.html`, `/board/` → `apps/board/index.html`, `/game/` → `apps/game/index.html`.
- [x] 1.3a Create placeholder `apps/board/index.html` and `apps/game/index.html` (minimal valid HTML, "coming soon" text) so the multi-page build and `npm run dev` work immediately without the app specs being complete.
- [x] 1.4 Create `skeleton/vitest.config.ts`. Confirm `npm test` runs and exits cleanly (zero tests, zero failures).
- [x] 1.5 Create stub `THIRD_PARTY.md` listing `vitest` (MIT), `fast-check` (MIT), `vite` (MIT), `typescript` (Apache-2.0).
- [x] 1.6 Append a dated entry to the existing `docs/kiro-journal.md` describing the scaffolding step (what was set up, any decisions made). Do not recreate the file.

**Covers:** Req 9 (deterministic engine infrastructure); tech.md build/test commands.

---

## Task 2: Profile type, defaults, clamping and import/export

Implement `skeleton/src/engine/profile.ts` — the single source of truth for every
profile field — with no dependencies on other engine files.

- [x] 2.1 Define the `Profile` TypeScript interface with all 30 fields from the requirements' Profile fields table. No `any`; every field has an explicit type.
- [x] 2.2 Implement `defaultProfile: Profile` with all defaults from the table.
- [x] 2.3 Implement `clampProfile(partial: Partial<Profile>, base?: Profile): Profile` applying the clamping order: calibration ranges → dead zone (≤ 0.5 × min range) → cancel hold time → both acceptance times → gesture threshold → release threshold.
- [x] 2.4 Implement `exportProfile(p: Profile): string` (JSON serialisation).
- [x] 2.5 Implement `importProfile(json: string): ImportResult` reading each field by name explicitly, never spreading the parsed object. `ImportResult = { profile: Profile; changes: string[] }`.
- [x] 2.6 Write `skeleton/test/profile.test.ts` with example tests: defaults round-trip, clamping order enforced, `__proto__` key ignored, missing field gets default, dependent clamping (release threshold below gesture threshold). Include a test that enumerates the keys of `defaultProfile` and asserts the count equals 30, cross-checking against the requirements table.
- [x] 2.7 Write `skeleton/test/profile.props.test.ts` implementing **P17** in full: (a) `importProfile(exportProfile(p))` equals `p`; (b) every field of any import result is in range; (c) the result has exactly the known fields — no `__proto__`, no unknown keys — for arbitrary JSON input including injected `__proto__` and out-of-order fields.

**Covers:** Req 7 AC 3–7; P17.

---

## Task 3: Press machine with property tests

Implement `skeleton/src/engine/press-machine.ts` — the shared state machine for
switch and gesture activation — before any engine that depends on it.

- [x] 3.1 Define `PressMachineState = { state: PressState; t_down: number; t_last: number }` and `PressState` enum (`IDLE | PENDING_ACCEPT | ARMED | ARMED_HOLD_WAIT | COOLDOWN`).
- [x] 3.2 Implement `stepPress(state: PressMachineState, signal: boolean, now: number, profile: Profile, acceptanceTime: number): PressEvent[]` following the transition table in design §3 exactly. `acceptanceTime` is required, with no default: the switch engine passes `profile.switchAcceptanceTime` and the gesture engine passes `profile.gestureAcceptanceTime`.
- [x] 3.3 Implement `clonePressMachineState`.
- [x] 3.4 Write `skeleton/test/press-machine.test.ts` with example tests covering every row of the transition table: acceptance time gating, cancel-by-hold on/off paths, cooldown, input timeout reset, the 2000 ms hold / 2000 ms timeout example from the design.
- [x] 3.5 Write `skeleton/test/press-machine.props.test.ts` implementing:
  - **P7** short presses ignored (hold < acceptanceTime → no press);
  - **P18** cancel hold never selects (hold ≥ cancelHoldTime, cancel-by-hold ON → one cancel, no press);
  - **P5** (partial) no stuck state: after silence ≥ inputTimeout the machine is IDLE.

**Covers:** Req 4 AC 5–7, Req 5 AC 2–3, Req 6 AC 2–3; P5 (partial), P7, P18.

---

## Task 4: Dwell engine with property tests

Implement `skeleton/src/engine/dwell.ts`. Depends on `profile.ts` and `targets.ts` (shared target types).

- [x] 4.1 Define `DwellState` (current target id, accumulated time, last-on-target timestamp, selected-this-stay flag, post-selection pause end time).
- [x] 4.2 Implement `stepDwell(state, { pointer, targets }, now, profile): DwellEvent[]` covering: accumulation only while on-target, grace-time pause without reset, reset after grace time expires, one select per stay (no auto-repeat), auto-repeat with effective interval, post-selection pause, no select in rest area.
- [x] 4.3 Implement `cloneDwellState`.
- [x] 4.4 Write `skeleton/test/dwell.test.ts` with example tests: basic dwell-to-select, grace time preserves progress, gap beyond grace resets, post-selection pause suppresses re-select, auto-repeat fires at correct interval, pointer in rest area emits nothing, `updateTarget` with pointer inside keeps progress.
- [x] 4.5 Write `skeleton/test/dwell.props.test.ts` implementing:
  - **P1** no quick-pass selection;
  - **P2** one selection per stay (no auto-repeat);
  - **P8** pause respected between consecutive selects;
  - **P14** moving targets keep progress;
  - **P19** auto-repeat respects the larger of interval and pause.

**Covers:** Req 3 AC 1–7; P1, P2, P8, P14, P19.

---

## Task 5: Scan engine with property tests

Implement `skeleton/src/engine/scan.ts`. Depends on `press-machine.ts` and
`profile.ts`.

- [ ] 5.1 Define `ScanState` (current index, loop count, row-scan sub-state, paused flag, post-selection pause end time).
- [ ] 5.2 Implement `stepScan(state, { press, targets }, now, profile): ScanEvent[]` covering: advance-on-interval, row-then-item mode, back item, cancel item in every cycle, post-selection pause, ignore-press-during-pause, loops-without-press → pause, resume-without-select, custom target order.
- [ ] 5.3 Implement `cloneScanState`.
- [ ] 5.4 Write `skeleton/test/scan.test.ts` with example tests: advance order, row entry and back-item, cancel item present, press during pause ignored, loops-to-pause, resume press highlights not selects.
- [ ] 5.5 Write `skeleton/test/scan.props.test.ts` implementing:
  - **P6** scan coverage (every item highlighted once per loop, in order, with no presses);
  - **P9** resume does not select;
  - **P8** pause respected (no two selects closer than postSelectionPause).

**Covers:** Req 4 AC 1–9; P6, P8 (scan path), P9.

---

## Task 6: One Euro smoother with tuning test

Implement `skeleton/src/engine/smoother.ts` and run the tuning test that sets the
final filter parameters.

- [ ] 6.1 Implement `SmootherState` and `stepSmoother(state, { angle, dt }): number` following the One Euro internals in design §2 exactly (`fC_deriv = 1 Hz` fixed, `fC_min` and `beta` from `smoothingStrength` via the formula).
- [ ] 6.2 Implement `cloneSmootherState`.
- [ ] 6.3 Write `skeleton/test/smoother.test.ts` as the **tuning test**: simulate a 1° sinusoid at 4 Hz, 8 Hz and 12 Hz at the reference calibration (±15°, 1920 × 1080) on synthetic timestamped samples; simulate a 20° step. Measure residual amplitude and 90 %-distance time. Log the actual measured values. Assert:
  - default preset (`s = 0.5`): 90 %-distance ≤ 150 ms;
  - high-tremor preset (`s = 0.9`): residual < 8 px at 4–12 Hz.
  If the hand-calculated formula does not meet either target, adjust `fC_min`/`beta` within the formula until it does, update the parameter table in design.md §2 to reflect the actual values, and document the change in `docs/kiro-journal.md`.
- [ ] 6.4 Write `skeleton/test/smoother.props.test.ts`: verify the filter output is always finite (no NaN or Inf) for any finite angle input and any `dt > 0`; verify `cloneSmootherState` produces identical subsequent output.

**Covers:** Req 2 AC 4; design §2 tuning obligation.

---

## Task 7: Head-pointer mapping and face-lock engine

Implement `skeleton/src/engine/head-pointer.ts`. Depends on `smoother.ts` and
`profile.ts`.

- [ ] 7.1 Implement the asymmetric four-range mapping formula from design §1: filter on raw centred angle → dead zone → mapping with `R_eff = R_direction − D` → screen pixel clamp.
- [ ] 7.2 Implement the face-lock rule from design §4: initial lock (largest area), frame-to-frame continuity score, one-face immediate lock, lost/re-acquire, `relockFace`. Implement the no-face timeout: track `t_face_lost` using `now` on each sample; emit `tracking-status: no-face-timeout` once when `now − t_face_lost ≥ profile.noFaceTimeout`, then clear the counter.
- [ ] 7.3 Implement the gesture-induced pointer freeze (head + gesture mode): freeze starts at release threshold crossing, expiry at `gestureAcceptanceTime + 300 ms`, unfreeze on score drop below release threshold.
- [ ] 7.4 Implement `cloneHeadPointerState`.
- [ ] 7.5 Write `skeleton/test/head-pointer.test.ts` with example tests: pointer at centre with zero deflection, pointer at screen edge with full range, dead zone leaves pointer centred, gain doubles reachable speed, face lost freezes pointer and emits tracking-status, re-acquire re-locks closest face, freeze starts at release threshold, expiry unfreezes without press.
- [ ] 7.6 Write `skeleton/test/head-pointer.props.test.ts` implementing:
  - **P10** pointer bounded (all inputs including extremes and ±Inf);
  - **P11** every target reachable (analytical inverse for all R ≥ MIN_RANGE, D clamped, G ∈ [1.0, 2.0]);
  - **P13** gesture does not drift the selection (freeze_pos at release-threshold crossing);
  - **P20** talking does not freeze pointer in head + dwell mode;
  - **P16** per-source timestamp ordering: interleaved camera and switch streams with 20–80 ms camera delay never drop valid camera samples.

**Covers:** Req 2 AC 3–10; Req 5 AC 4; Req 9 AC 4–5; P10, P11, P13, P16, P20.

---

## Task 8: Gesture engine

Implement `skeleton/src/engine/gesture.ts`. Depends on `press-machine.ts` and
`profile.ts`.

- [ ] 8.1 Implement `stepGesture(state, { gestureScores }, now, profile): GestureEvent[]`. Select the score for `profile.switchGesture` by name; derive `signal` from gesture/release thresholds; delegate press/cancel logic to `press-machine.ts`.
- [ ] 8.2 Implement `cloneGestureState`.
- [ ] 8.3 Write `skeleton/test/gesture.test.ts`: jaw-open activates at threshold, brow-raise activates at threshold, score below release threshold = signal inactive, face-not-detected = no press.
- [ ] 8.4 Write `skeleton/test/gesture.props.test.ts` implementing:
  - **P12** one gesture, one press (score crosses threshold once, stays up for any duration → one press);
  - **P3** (partial) face lost means no press: lost periods in an interleaved stream produce no presses.

**Covers:** Req 5 AC 1–7; P3 (partial), P12.

---

## Task 9: Calibration engine

Implement `skeleton/src/engine/calibration.ts`. Depends on `profile.ts`.

- [ ] 9.1 Define `CalibrationState` (current step, accumulated rotations, stillness window, tremor std-dev accumulator).
- [ ] 9.2 Implement `stepCalibration(state, { rotation }, now, profile): CalibrationEvent[]` covering: five steps (centre, left, right, up, down), stillness-time advance, step-timeout advance, rejection when any measured range < MIN_RANGE, tremor std-dev measurement, `suggestHighTremor` flag in the done event.
- [ ] 9.3 Implement `cloneCalibrationState`.
- [ ] 9.4 Write `skeleton/test/calibration.test.ts`: stillness advance, timeout advance, range-too-small rejection, tremor std-dev above 0.5° sets flag, symmetric and asymmetric ranges stored correctly.

**Covers:** Req 7 AC 1–2; Req 2 AC 6.

---

## Task 10: Cancel/undo wiring and input-timeout integration

Wire cancel and undo across all engines and verify the full cancel path end-to-end
using the public `feedSamples` API.

- [ ] 10.1 Ensure `stepDwell` recognises the `cancel` role target and emits `cancel` on dwell-select of a cancel-role target.
- [ ] 10.2 Ensure `stepScan` emits `cancel` when the cancel item is selected.
- [ ] 10.3 Confirm the press machine's hold-to-cancel path emits `cancel` (covered by press machine, but verify end-to-end via `feedSamples`).
- [ ] 10.4 Write `skeleton/test/cancel.test.ts` with example tests for each cancel path: dwell cancel target, scan cancel item, hold-to-cancel (switch and gesture), Escape key, input timeout reset.
- [ ] 10.5 Write `skeleton/test/cancel.props.test.ts` implementing **P4** cancel always works: from any reachable engine state, a cancel input returns to idle in one step and emits exactly one `cancel`.

**Covers:** Req 6 AC 1–6; P4.

---

## Task 11: `createPlanchette` factory and public API

Assemble all engines into the `Planchette` instance behind the factory function.

- [ ] 11.1 Implement `createPlanchette(options)` in `skeleton/src/index.ts`. Wire engines together: `feedSamples` fans samples to the correct engine by `source` (`'camera'`, `'keyboard'`, `'gamepad'`, `'mouse'`, `'synthetic'`); handles `cancel: true` on any sample by immediately emitting `cancel` and resetting to idle; events bubble out as DOM `CustomEvent`s via `EventTarget`.
- [ ] 11.2 Implement `registerTarget`, `updateTarget`, `unregisterTarget`, `getTargets` with the `role` and `autoRepeat` fields.
- [ ] 11.3 Implement `setMode` and `mode-change` emission.
- [ ] 11.4 Implement `setProfile` (clamps before applying), `getProfile`, `exportProfile`, `importProfile`.
- [ ] 11.5 Implement `setScreen` and resize handling (re-clamp pointer on next sample).
- [ ] 11.6 Implement `startCalibration`, `cancelCalibration`, `calibration-step` events.
- [ ] 11.7 Write `skeleton/test/api.test.ts`: register/update/unregister targets, mode switch without re-registration, profile round-trip via API, `setScreen` updates pointer bounds, calibration events.
- [ ] 11.8 Write `skeleton/test/api.props.test.ts` implementing **P5** (full): after any input sequence followed by silence ≥ `inputTimeout + 1 ms` fed via `feedSamples`, the engine is idle (no pending dwell, no scan highlight, press machine IDLE).

**Covers:** Req 1 AC 1–5; Req 9 AC 2–3, AC 6; P5 (full).

---

## Task 12: Frame-rate independence and bad-timestamp properties

Write the cross-cutting property tests that require the full pipeline assembled in
task 11.

- [ ] 12.1 Write `skeleton/test/frame-rate.props.test.ts` implementing **P15**: same pointer path at 15 fps and 60 fps (same fast-check seed) produces the same `select` events, each within 67 ms of its counterpart, for paths satisfying the boundary conditions.
- [ ] 12.2 Write `skeleton/test/timestamps.props.test.ts` implementing **P16** in full: interleaved camera and switch streams with 20–80 ms camera delay, with duplicate/backwards timestamps injected independently per source, never drop valid camera frames due to switch timestamps.
- [ ] 12.3 Write example tests for the boundary conditions excluded from P15 (stays within 67 ms of dwell time, pointer within 20 px of target edge) to document the expected behaviour at the edge.

**Covers:** Req 9 AC 4–5; P15, P16.

---

## Task 13: Integration example and line-count test

Write the 15-line integration example and the test that verifies the line count.

- [ ] 13.1 Write `skeleton/examples/minimal.ts`: a complete working integration of `createPlanchette` in 15 lines or fewer (imports excluded from the count per the convention used in the test).
- [ ] 13.2 Write `skeleton/test/example.test.ts` that reads `minimal.ts`, counts non-blank non-import lines, and asserts the count ≤ 15.

**Covers:** Req 1 AC 6.

---

## Task 14: Camera and tracking-failure handling

Implement the camera adapter and all three tracking-failure paths. First task to touch
the DOM or the camera.

- [ ] 14.1 Implement `skeleton/src/adapters/camera-adapter.ts`: initialise MediaPipe `FaceLandmarker` (numFaces = 2, WASM served locally), start/stop `getUserMedia`, emit `{ now, source: 'camera', faces, gestureScores }` samples on each processed frame.
- [ ] 14.2 Handle permission-denied: catch the `getUserMedia` rejection, emit `tracking-status: permission-denied`, show the plain-language message, offer switch/mouse mode.
- [ ] 14.3 Handle load-failed: catch MediaPipe initialisation failure, emit `tracking-status: load-failed`.
- [ ] 14.4 No-face timeout is handled by the head-pointer engine (task 7), not the camera adapter. The adapter passes frames; the engine tracks `t_face_lost` using `now` and emits `tracking-status: no-face-timeout` once when `now − t_face_lost ≥ profile.noFaceTimeout`. Verify this path with a synthetic stream of frameless camera samples in `camera-failure.test.ts`.
- [ ] 14.5 Implement retry: `startCamera()` can be called again after any failure without reloading the page; re-initialise MediaPipe and restart the timeout.
- [ ] 14.6 Implement `skeleton/src/adapters/keyboard-adapter.ts`, `mouse-adapter.ts`, `gamepad-adapter.ts` following the design §7 spec (one sample per rAF, granular `source` field: `'keyboard'`, `'mouse'`, `'gamepad'`; per-adapter `lastNow`). Keyboard adapter sets `cancel: true` on Escape keydown samples.
- [ ] 14.7 Write `skeleton/test/camera-failure.test.ts` using synthetic landmark streams (no real camera): simulate each failure case and assert the correct `tracking-status` value and that scanning and mouse modes produce selections during and after the failure.
- [ ] 14.8 Write `skeleton/test/camera-failure.props.test.ts` implementing **P21**: with camera state set to each failure reason before any input sequence, scanning and mouse modes still produce selections; `tracking-status` carries the correct reason.
- [ ] 14.9 Write `skeleton/test/camera-real.e2e.ts` (Playwright, runs under `npm run test:e2e`): launch Chromium with `--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream`, and `--use-file-for-fake-video-capture=<.cache path>` pointing at a clip from `test-media/` converted by `pretest:e2e`. Assert the page emits `tracking-status: found` within 5 s of `startCamera()` being called.

**Covers:** Req 2 AC 1–2, AC 11–12; Req 8 AC 1–4; P3 (full, with real lost periods from failure), P21.

---

## Task 15: `tracking-status` and face-lost property tests

Complete the remaining cross-cutting properties that require the camera adapter.

- [ ] 15.1 Write `skeleton/test/face-lost.props.test.ts` implementing **P3** in full: interleaved found/lost landmark streams (random period lengths, including failure-reason lost periods) produce no `select` or press events during any lost period.
- [ ] 15.2 Write example tests for the low-confidence case: tracking continues but `tracking-status: low-confidence` is emitted.

**Covers:** Req 2 AC 8–10; P3 (full).

---

## Task 16: Dwell-ring and scan-highlight UI helpers

Implement the optional UI helpers in `skeleton/src/ui/`. These are purely visual and
have no logic; they consume public API events only.

- [ ] 16.1 Implement `skeleton/src/ui/dwell-ring.ts`: listens for `dwell-progress` and `select`; renders a filling ring (SVG or Canvas, `prefers-reduced-motion` respected — static indicator at any progress level when motion is reduced).
- [ ] 16.2 Implement `skeleton/src/ui/scan-highlight.ts`: listens for `highlight`; applies a thick outline plus fill change to the highlighted element. Colour-independent (not colour alone).
- [ ] 16.3 Implement `skeleton/src/ui/tracking-indicator.ts`: listens for `tracking-status`; shows the camera-on indicator while running and the plain-language failure messages from Req 8.
- [ ] 16.4 Write Playwright end-to-end tests in `skeleton/test/ui.e2e.ts` using synthetic landmark streams fed via `feedSamples` (no real camera): confirm dwell ring reaches full at select, scan highlight moves with `highlight` events, tracking indicator shows correct message for each `tracking-status`. Use Playwright's `page.on('request')` to record all network requests and assert that none go to an origin other than `localhost` (Req 2 AC 11: nothing leaves the device).

**Covers:** Req 2 AC 2; Req 8 AC 2a; accessibility.md Feedback and Control sections.

---

## Task 17: Skeleton demo page

Wire all engines and UI helpers into the demo page at `skeleton/demo/`.

- [ ] 17.1 Build `skeleton/demo/main.ts`: implement the Halloween-themed demo page logic (3×3 grid of targets, a cancel target, an undo target, and a rest area). The shell HTML is the root `index.html`; add any needed markup there.
- [ ] 17.2 Integrate `createPlanchette` with head + dwell mode as default; expose a mode switcher, a calibration button and a profile import/export control.
- [ ] 17.3 Confirm `npm run dev` serves the demo at `/` (root `index.html` → `skeleton/demo/main.ts`) and both app stubs at `/board/` and `/game/`.

**Covers:** Req 1 AC 5; product.md demo requirements; structure.md `/skeleton/demo/` entry.

---

## Task 18: GitHub Actions deploy to GitHub Pages

Set up CI so judges always have a live URL.

- [ ] 18.1 Create `.github/workflows/deploy.yml`: on push to `main`, run `npm ci`, `npm run build`, upload the `dist/` output with `actions/upload-pages-artifact`, then deploy with `actions/deploy-pages`. No `gh-pages` branch.
- [ ] 18.2 In the same workflow, add a step that sets the repository's Pages source to "GitHub Actions" using the GitHub API (or document the one-time manual step in `README.md` if the API step is impractical).
- [ ] 18.3 Set `base` in `vite.config.ts` to the repository name (e.g. `/planchette-kit/`) so asset paths resolve correctly on GitHub Pages.
- [ ] 18.4 Add the live URL to `README.md` once the first deploy succeeds.

**Covers:** product.md hosting; structure.md deploy requirement; judges need one URL.

---

## Dependency graph

```
1 (tooling)
└── 2 (profile)
    ├── 3 (press machine) ──────────────────────────────┐
    │   ├── 4 (dwell)                                   │
    │   └── 5 (scan)                                    │
    ├── 6 (smoother)                                    │
    │   └── 7 (head-pointer mapping + face lock)        │
    │       └── 8 (gesture) ──────────────────(press machine)
    └── 9 (calibration)
        └── 10 (cancel/undo wiring)
            └── 11 (createPlanchette / public API)
                ├── 12 (frame-rate + timestamp properties)
                ├── 13 (integration example)
                ├── 14 (camera adapter + failure handling)
                │   └── 15 (face-lost properties)
                └── 16 (UI helpers)
                    └── 17 (demo page)
                        └── 18 (GitHub Pages deploy)
```
