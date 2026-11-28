---
inclusion: fileMatch
fileMatchPattern: ["apps/**", "skeleton/src/ui/**"]
---

# Accessibility rules

These rules ship with the template. Any layout built on Planchette Kit must follow
them. This file covers layout and interface. All timing values, sizes, defaults and
ranges come from the Profile fields table in the input-core spec, the single source of
truth: #[[file:.kiro/specs/input-core/requirements.md]]

## Targets
- Head-pointer and dwell targets: at least the profile's target size (default 96 x 96
  CSS px, well above the WCAG 2.2 minimum, because head pointing is less precise than
  a mouse).
- At least the profile's target spacing (default 16 CSS px) between dwell targets.
- Every layout has a **rest area**: a screen area with no targets where the pointer can
  sit while the person rests, so looking at the screen does not start a selection.
  (The rest area is a screen area. The head dead zone is a profile value for ignoring
  small head movement. Do not mix them up.)
- Calibration maps the person's own range of head movement, down to the minimum
  supported range, to the whole screen. No target may be unreachable. Below that range,
  suggest a scanning mode.
- Targets that should repeat when held (for example backspace) must opt in to
  auto-repeat. Everything else selects once per stay.

## Communication board
- Core-vocabulary buttons keep fixed positions. Never reorder, hide or move them based
  on prediction or use. Prediction appears in its own strip.

## Timing
- Every timing is adjustable through the profile. No fixed time limits (WCAG 2.2.1).

## Feedback
- Dwell progress is always visible (a filling ring or bar) and also shown by more than
  colour.
- Scan highlight is a thick outline plus a fill change, not colour alone.
- Every selection gives feedback: visual, plus an optional sound or spoken word.
- Tracking status is always visible: show clearly when the face is lost or tracking
  confidence is low.

## Visual
- Text contrast at least 4.5:1, UI parts at least 3:1.
- Respect `prefers-reduced-motion`.
- Nothing flashes more than 3 times a second (WCAG 2.3.1). This applies to every app and
  every theme.
- Text at least 24 CSS px on the communication board.

## Control
- Cancel and undo are reachable in every input mode (see the spec for the cancel input
  per mode). Every scan cycle includes a cancel item; head-pointer layouts place a
  cancel target.
- Losing the face resets dwell progress and selects nothing. It is a reset, not a cancel.
- Camera and tracking failures are three distinct cases, each handled the same way:
  - **Permission denied**: the browser rejects `getUserMedia`.
  - **MediaPipe load failure**: the WASM or model file fails to fetch or initialise.
  - **No face detected**: tracking starts but no face is found within the profile's
    no-face time limit (default 10 s, range 3–60 s).
  For every case: show a clear plain-language message that names the problem, emit a
  `tracking-status` event so the app layer can respond, and offer switch scanning and
  mouse mode as alternatives. Every mode except head pointing works without a camera.
- The camera starts after a start action from any available input (switch key, mouse
  or carer), or on page load if the person has turned that on in their profile. The
  "camera on" indicator is always visible while it runs, and it can be stopped at any time.
- Carers can use keyboard and screen reader: real buttons, labels and visible focus.
