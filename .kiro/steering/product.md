---
inclusion: always
---

# Product: Planchette Kit

## What it is
Planchette Kit helps developers make web apps **hands-free by construction**. It has
three parts, in order of importance:

1. **A dwell simulator**: simulated users with tremor, slow movement or a small range
   of head movement try any layout and report accidental selections and
   time-to-select. Its movement models use published figures (Fitts' law for head
   pointing, tremor frequency and size ranges), cited in the docs.
2. **A Kiro power, "Make this app hands-free"**: steering rules, hooks and the
   simulator bundled so any Kiro user can apply them to their own app.
3. **An input layer** that turns a body signal the person can still control into
   pointing and selection in the browser:
   - **Head pointer**: the webcam follows head movement and moves a pointer.
   - **Dwell**: holding the pointer on a target for a set time selects it.
   - **Face-gesture switch**: a jaw open or brow raise acts as a single switch.
   - **Single-switch scanning**: the app highlights options one at a time and the
     switch (face gesture, key, click or assistive switch) selects the highlighted one.
   - **Mouse fallback**: for carers, setup and testing.

## How it differs from existing tools
Tools such as Google's Project Gameface, Camera Mouse and built-in OS head tracking
already turn head movement into a cursor for one person's computer. Planchette Kit
is aimed at the app developer: it makes the app itself usable with these inputs, tests
layouts against simulated users, and enforces the accessibility rules through Kiro.
Never claim the input layer itself is new.

A planchette, the pointer on a Ouija board, is a dwell-select letter board. That is
the theme and the function at the same time.

## Who it is for
People who cannot use their hands or speak reliably, for example people living with
ALS, cerebral palsy, spinal cord injury or after a stroke, and the carers and
therapists who set things up for them. A secondary audience is web developers who want
to make their own app usable hands-free.

## What ships in this repo
- `/skeleton`: the template (input modes, dwell and scanning engines, calibration
  profile, layout helpers). Framework-free so it can be added to any web app.
  The skeleton is also published to npm later (see `docs/npm-package-plan.md`); until
  then it is a template.
- `/apps/board`: App A, a communication board (spell words, quick phrases, spoken output).
- `/apps/seance`: App B, Séance, a spooky head-pointer practice game. A friendly spirit spells a
  short message on an Ouija-style board and the player selects each letter, with head pointing and
  dwell or any other input mode. It teaches the input, adapts gently after misses, and offers to carry
  the dwell time that worked into the Board's settings, only when the person presses for it.
- `/tools/dwell-sim-mcp`: the dwell simulator as an MCP server.

Any demo of adding the kit to someone else's open-source app lives in a separate fork
linked from the README, never in this repo.

## Principles (in priority order)
1. **Never select something the person did not mean.** An accidental selection in a
   communication board says the wrong thing on someone's behalf. Prefer slower and
   correct over faster and wrong.
2. **Everything runs on the device.** No camera frame, landmark, typed word or profile
   leaves the browser. No accounts, no analytics, no cloud calls.
3. **The person can always stop or undo.** Cancel and undo are reachable in every
   input mode.
4. **Adapt to the person, not the other way round.** Every timing and size is
   adjustable and saved in their calibration profile.
5. **Setup must be possible hands-free**, even if a carer usually does it. The first
   start can come from any available input (a switch key, a mouse or a carer); after
   that, the person can choose to have the camera start on page load.
6. **Buttons stay where they are.** In the communication board, core-vocabulary
   buttons keep fixed positions so people build motor memory (the motor-planning
   principle used in AAC). Word prediction goes in a separate strip and never moves
   or reorders the core grid.

## Theme rules
- App A (communication board) is **calm and unthemed**. No spooky effects; it is a
  daily tool.
- App B (Séance) and the skeleton's demo page carry the Halloween theme.
- No flashing, no jump-scare flashes, sound off until the player turns it on.

## Non-goals
- Not a medical device and not a replacement for an AAC system assessed by a
  speech-language therapist. Say so in the app and README.
- No eye tracking claims. This is head and switch input.
- No server, database or login.
