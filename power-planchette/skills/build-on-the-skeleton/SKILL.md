---
name: build-on-the-skeleton
description: Build a hands-free web app (head pointer, dwell, switch scanning, mouse fallback) on the Planchette Kit skeleton. Use when someone wants to add head pointing, dwell selection or single-switch scanning to a web page, mark dwell targets, mount the input controls, or make a layout fit a screen without scrolling.
---

# Build an app on the Planchette Kit skeleton

The skeleton (`skeleton/` in https://github.com/4KInc/planchette-kit) turns a body signal the person can
still control into pointing and selection in the browser: head pointer, dwell, a face-gesture switch,
single-switch scanning, and a mouse fallback for carers and testing. It is framework-free TypeScript and
plain DOM. Tools such as Project Gameface, Camera Mouse and built-in operating system head tracking
already turn head movement into a cursor, so do not describe the input layer as new. What the kit adds is
an app built so these inputs work, and a way to test its layout.

The rules a layout must follow are in `references/accessibility-rules.md`. The exact names and signatures
are in `references/api-cheatsheet.md`. Read both before step 1.

## Step 1: Add the skeleton
Use only the public entry points, `@planchette/skeleton` and `@planchette/skeleton/ui`. Never import
internal paths. The skeleton is a template until it is published to npm: copy `skeleton/` into your
repository as a package, or alias the two names in your bundler (see the cheat sheet). Serve the
face-tracking files (`assetsUrl`) from your own site, not a CDN, so nothing leaves the device.

## Step 2: Lay out the page
1. Mark every selectable element with `data-planchette-target="<unique id>"`.
2. Add a **rest area**: a screen area with no target, `data-planchette-target="rest"` and
   `data-role="rest-area"`, where the pointer can sit while the person rests.
3. Add a **cancel** target (`data-role="cancel"`) and, where the app has an action to reverse, an **undo**
   target (`data-role="undo"`). In scanning, every cycle must include a cancel item.
4. Size targets at least the profile's target size (default 96 × 96 CSS px) with at least the profile's
   spacing (default 16 px) between them. For an auto-repeat target such as backspace, register it with
   `{ autoRepeat: true }`. Everything else selects once per stay.
5. Keep fixed things fixed. A button the person has learned stays where it is.

## Step 3: Create the instance and the profile
`createPlanchette({ screen, assetsUrl, trackingIndicator })`, then `setProfile(saved or default)`. Save
with `exportProfile()` when the person changes a setting. Do not hard-code a timing in your own code: every
timing and size comes from the profile and is adjustable. Pick the default dwell time with the
`check-dwell-layout` skill, in step 8.

## Step 4: Register targets and follow the viewport
`createTargetRegistry(planchette)`: call `register(el)` for each marked element, `update()` after any
layout change, and `planchette.setScreen({ width: innerWidth, height: innerHeight })` on resize.

## Step 5: One handler for every input mode
Listen to `select`, `cancel` and `tracking-status` on the planchette. Head pointing, scanning, gesture and
mouse all raise the same events. Act on `event.detail.targetId`. Give feedback for every selection (visual,
plus an optional sound or spoken word). Never select on pointer movement alone.

## Step 6: The settings dialog and the stale select
`createSettingsGate(document)` listens to the `close` event of `<dialog id="settings">`. A `select` arrives on the next animation
frame, so one made while the dialog was open can arrive after it closed. Ignore every `select` while the
dialog is open, and any select for which `gate.isStale(event.detail.now)` is true.

## Step 7: Input controls and the camera
`mountInputControls({ host: planchette, document, text, saveProfile, firstRun })`. It expects the page
elements listed in the cheat sheet, and every string comes from your own `text` object (keep user-facing
text in one file so it can be reviewed and translated). Also add `createDwellRing` and
`createScanHighlight`. Then:
- The camera starts only after a press (the `camera-toggle` target, a switch key, a mouse or a carer), or
  on page load if the person has turned on `startCameraOnLoad` in their profile. Never by itself.
- A "camera on" indicator is visible while it runs, and the person can stop it at any time.
- If permission is denied, the model fails to load, or no face is found, show a plain message and offer
  scanning and mouse mode. Everything except head pointing works without a camera.

## Step 8: Check the layout and the page
1. Open the app at **1366×768** and at **1920×1080**, in every view and with every dialog open. The page
   must not scroll and every target must lie fully inside the viewport. For the repository's two-column
   page, `renderedCellSize` computes the fit. Otherwise measure.
2. Text contrast 4.5:1, UI parts 3:1, in every state. Respect `prefers-reduced-motion`. Nothing flashes
   more than 3 times a second. Sound is off until the person turns it on.
3. Show the not-a-medical-device notice.
4. Run the `check-dwell-layout` skill on the result, and fix the layout or the dwell time until it passes.
5. Use `compare-dwell-settings` to state what the chosen dwell time costs per selection.

## Rules
- Do not claim eye tracking. This is head and switch input.
- Do not claim the app is a medical device, therapy, or a replacement for an assessment by a
  speech-language therapist.
- Do not add analytics, accounts or any network call that carries camera, landmark, typed or profile data.
- Ask the user before adding a dependency.
