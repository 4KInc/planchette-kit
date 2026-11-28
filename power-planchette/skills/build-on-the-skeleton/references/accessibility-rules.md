# Accessibility rules for apps built on the skeleton
Copied on 28 Nov 2026 from `.kiro/steering/accessibility.md` of https://github.com/4KInc/planchette-kit,
because steering files cannot ship in a power. Part 1 is that file's body, with one line changed (the
`#[[file:...]]` include is replaced by the note in brackets). Part 2 adds rules that the Board and
Seance specs of the same repository state and that the steering file does not, each with its source.
Check a new app against both parts.

## Part 1: the steering file
# Accessibility rules

These rules ship with the template. Any layout built on Planchette Kit must follow
them. This file covers layout and interface. All timing values, sizes, defaults and
ranges come from the Profile fields table in the input-core spec, the single source of
truth: (In the Planchette Kit repository: `.kiro/specs/input-core/requirements.md`. In your app, read the live values with `planchette.getProfile()`. Defaults named below: target size 96 x 96 CSS px, target spacing 16 CSS px, no-face time limit 10 s with a range of 3 to 60 s.)

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

## Part 2: rules from the app specs
These hold for every app built on the skeleton. Each line names where this repository states it.
- **The page does not scroll at 1366x768 and at 1920x1080**, and every target lies fully inside the
  viewport, in every view. People who point with their head cannot scroll. (`.kiro/specs/board/requirements.md`,
  Requirement 14, "the page SHALL NOT scroll"; `.kiro/specs/seance/requirements.md`, Requirement 9, and its
  end-to-end checks at both sizes in Requirement 16.) Test it in a browser at both sizes, for every view and dialog.
- **No camera until a press.** The camera starts after a start action from any available input
  (switch key, mouse or a carer), or on page load only if the person has turned that on in their profile
  (`startCameraOnLoad`). The skeleton never starts it by itself. Show an indicator while it runs, and
  let the person stop it at any time. (Part 1, "Control"; product.md principle 5.)
- **Nothing leaves the device.** No camera frame, landmark, typed word or profile is sent anywhere. No
  accounts, no analytics. Serve the face-tracking files from your own site, not a CDN. (product.md, principle 2.)
- **Say what the app is not.** Show a notice that the app is not a medical device and not a replacement
  for an AAC system or an assessment by a speech-language therapist. (Board Requirement 9, criterion 10; the Seance spec's introduction.)
- **Do not claim eye tracking.** The input is head and switch input.
- **Do not call the input layer new.** Tools such as Project Gameface, Camera Mouse and built-in operating
  system head tracking already turn head movement into a cursor. The point of the kit is that the *app* is
  usable with these inputs. (product.md.)
- **Never select something the person did not mean.** Prefer slower and correct over faster and wrong.
  Check dwell settings with the `check-dwell-layout` skill. (product.md, principle 1.)
- **Adapt to the person.** Every timing and size is adjustable and saved in their profile. No fixed
  time limits. (product.md, principle 4; Part 1, "Timing".)
- **Cancel and undo are reachable in every input mode**, including scanning. (Part 1, "Control".)
- **Motion:** respect `prefers-reduced-motion`; nothing flashes more than 3 times a second; sound is off
  until the person turns it on. (Part 1, "Visual"; product.md theme rules.)
- **Contrast:** text 4.5:1 or better, UI parts (borders, focus, progress) 3:1 or better, in every state of
  a target. (Part 1, "Visual"; Board Requirement 9, criterion 4.)
