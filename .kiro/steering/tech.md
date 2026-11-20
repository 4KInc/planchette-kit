---
inclusion: always
---

# Tech

## Stack
- TypeScript (strict, no `any`), Vite, npm workspaces.
- No UI framework anywhere in the repo. The skeleton and both apps use plain DOM and
  TypeScript only.
- Face tracking: MediaPipe Tasks Vision `FaceLandmarker` (Apache-2.0). Serve the
  WASM and model files from this site, not a third-party CDN, so nothing leaves the
  device and it works offline after first load. The same model's blendshape scores
  (for example `jawOpen`, `browInnerUp`) drive the face-gesture switch, so no second
  model is needed.
- Speech output: the browser `speechSynthesis` API. Prefer voices with
  `localService === true`.
- Tests: Vitest for unit tests, **fast-check** for property-based tests, Playwright
  for end-to-end tests.
- The skeleton is an npm workspace package consumed by the apps. It is not published to
  npm during the hackathon; the plan to publish it afterwards is in
  `docs/npm-package-plan.md`. `skeleton/src/index.ts` is its only public entry point:
  anything not exported there is private and may change.
  One Vite multi-page build serves the skeleton demo at `/`, App A at `/board/` and
  App B at `/game/`, so `npm run dev` runs all three and judges get one URL. Deploy as a static site.

## Architecture rules
- **Engines never hard-code timings or thresholds.** Every value comes from the profile.
  This is what satisfies WCAG 2.2.1 (no fixed time limits) and is why `accessibility.md`
  does not need to load for engine files — the constraint is enforced here, not there.
  Profile fields defined here (single source of truth):
  - `noFaceTimeoutMs`: how long to wait for a face before emitting a `tracking-status`
    failure event and offering alternative modes. Default 10 000 ms, range 3 000–60 000 ms.
- **The engines are deterministic.** Dwell, scanning, gesture, smoothing and
  calibration logic take timestamped input samples and return events. They never read
  `Date.now()`, `performance.now()`, the DOM or the camera. Time is passed in. This is
  what makes property-based tests and the dwell simulator possible.
- **Engine state choice:** each engine is `step(state, input, now)` that updates a small
  state object in place and returns events, plus `cloneState` for tests. Deterministic
  without allocating every frame. Do not switch to immutable state without asking.
- **Measure time, never count frames.** Webcams drop frames; behaviour must not change
  with frame rate. Ignore samples whose timestamp is not later than the previous one.
- Input adapters (camera, keyboard, mouse, gamepad) are thin and live separately.
  They turn device events into timestamped samples and do nothing else.
- One input interface for every mode. Apps listen for the same events whether the
  person uses head pointing, scanning or a mouse.
- No allocation-heavy work per frame in the tracking loop; reuse objects.

## Testing rules
- Every engine behaviour in a spec's acceptance criteria gets a test. Invariants get a
  **property-based test**, not just examples. Required property: with the camera
  unavailable (permission denied, load failure, or no face detected), scanning and mouse
  modes still produce selections without error.
- Simulator properties that compare two simulated users must use the same random
  seed and the same movement path, changing only the parameter under test, so the
  test is not flaky.
- When a property test finds a counterexample, keep it as a fixed regression test and
  log it in `docs/kiro-journal.md`. Journal entries are dated and each records: what
  Kiro did, what went wrong or surprised us, what we changed, and links to the relevant
  commits or test counterexamples.
- **Never turn on a real camera or microphone in automated tests.** Use recorded or
  synthetic landmark streams, and Chromium's fake media devices for end-to-end tests,
  fed from our own face recordings. Never use downloaded face videos.
- `pretest:e2e` runs ffmpeg for each clip in `/test-media/`:
  `ffmpeg -y -i test-media/<clip>.mp4 -pix_fmt yuv420p .cache/test-media/<clip>.y4m`.
  The `.cache/` directory is gitignored. Playwright launches Chromium with
  `--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream` and
  `--use-file-for-fake-video-capture=<path to the .y4m>`.
- Commit only short, low-resolution MP4 clips (about 320 x 240, under 10 seconds) in
  `/test-media/`. A `pretest:e2e` script converts them to `.y4m` with ffmpeg into a
  gitignored cache folder. Never commit `.y4m` files (about 14 MB per second at 640 x 480)
  and do not use Git LFS: judges clone this repo.
- Never add `.kiro/` or anything inside it to `.gitignore`.

## Dependencies
- Ask before adding any dependency. Only MIT, Apache-2.0, BSD or ISC licences. Record
  each one and its licence in `THIRD_PARTY.md`.
  Exception: `@axe-core/playwright` and `axe-core` (MPL-2.0), dev only, for the
  accessibility tests; never bundled.
- Pin exact versions.
- Already approved: `@mediapipe/tasks-vision` (Apache-2.0; pinned to 0.10.35, because 1.0.0
  and later send usage statistics to a Google endpoint), `fast-check` (MIT),
  `vitest` (MIT), `@playwright/test` (Apache-2.0), `@modelcontextprotocol/sdk` (MIT)
  for the dwell simulator.
- CI runs that use the Kiro CLI spend credits: run them on demand, not on every push.

## Commands (keep these working)
- `npm run dev`: start the demo site.
- `npm test`: unit and property tests.
- `npm run test:e2e`: Playwright with fake camera.
- `npm run build`: production build of the skeleton and both apps.
