# Requirements Document
## Introduction
Séance is the second app on the Planchette Kit template (the Board is the first) and is App B:
it replaces the earlier `apps/game` stub (Requirement 18). It is a short, spooky head-pointer
practice game that teaches head-pointer and dwell use. A friendly spirit
spells a message on an Ouija-style board (letters, YES, NO, GOODBYE) and the player
follows it, one target at a time, with the kit's dwell or with any other kit input mode
(face gesture, switch scanning, mouse). A round is one short message. The game adapts
gently: after repeated misses it shows the next target more strongly and suggests a longer
dwell. It never punishes: no score to lose, no lives, no timer. At the end of a round a
calm summary shows letters, time and accidental selections, and offers to carry the dwell
time the person used into the Board's saved settings, only when the person presses for it.
Séance is built on the skeleton's public API only. It runs fully on the device, with
original art drawn in CSS and SVG and optional sound made with Web Audio synthesis (off by
default). It is a practice game. It is not a medical device, not therapy, and not a
replacement for an assessment by a speech-language therapist; the app says so.
Scope: this spec describes the app at `apps/seance`, served at `/seance/`; the shared input
controls it uses, which move into the skeleton's `./ui` entry point (Requirement 17); and the
removal of the `apps/game` stub with the matching steering and README changes (Requirement 18).
## Glossary
- **Séance**: this app, served at `/seance/index.html`, entry script `apps/seance/src/main.ts`.
  Identifiers, paths and storage keys use the ASCII spelling `seance`.
- **Planchette**: the skeleton instance (`createPlanchette`) that Séance drives through
  its public API only (`@planchette/skeleton`, `@planchette/skeleton/ui`).
- **Spirit**: the game's character. It "spells" by marking the next target. It is gentle
  and never scary.
- **Message**: the short sequence of steps the spirit spells in one round. Bundled in
  Séance; never typed by the player (Requirement 14).
- **Step**: one board target the player has to select, in order. A letter, YES, NO or
  GOODBYE.
- **Round**: one Message, from the first Step to the round's end (complete or stopped).
- **Board target**: one of the 29 selectable targets of the game board: the letters A to Z,
  YES, NO and GOODBYE. Control targets (Stop, Undo, Cancel, Sound, camera toggle, rest area,
  suggestion targets, summary targets) are not Board targets.
- **Hit**: a selection of the current Step's Board target.
- **Miss** (also called an **accidental selection** in the summary): a selection of any
  other Board target while a round is playing.
- **Taken back**: a Hit that the player reversed with Undo.
- **Support level**: 0, 1 or 2. How strongly the game shows the next target (Requirement 3).
- **Suggestion**: the offer to try a longer dwell time. Never applied unless the player
  presses Apply.
- **Summary**: the calm screen shown after a round ends (Requirement 4).
- **Carry**: writing the dwell time used in a round into the Board's saved settings
  (Requirement 5).
- **Board key**: the browser storage key `planchette-board:settings`, owned by the Board.
- **Séance key**: the browser storage key `planchette-seance:settings`, owned by Séance.
- **Board app**: the communication board (`apps/board`). Séance does not import from it.
- **Dwell time**: the Profile's `dwellTime` field, in ms (range 400 to 3000, step 50 in
  Settings), as defined in the input-core spec.
- **Rest area**: a screen area with no selectable content where the pointer can sit
  (accessibility.md).
- **Arrival guard**: the rule in Requirement 4 AC 7 that holds back a target the pointer is
  already inside when a view changes.
- **Seance default dwell**: 2100 ms, the Board's default, applied only when no Séance
  Profile was saved (Requirement 8). It is confirmed by the layout gate (Requirement 15).
## Game board (fixed layout)
The board has 7 columns and 6 rows of cells. Cell height is the Profile's target size (96
CSS px by default). Columns share the grid width equally. At 1366×768 the grid is 848 px
wide, so a cell is about 107 × 96 px with 16 px gaps. Every Board target keeps its cell for
the life of the page.
| Row | Content |
| --- | --- |
| 0 | YES (columns 0 to 2), a decorative cell (column 3), NO (columns 4 to 6) |
| 1 | A B C D E F G |
| 2 | H I J K L M N |
| 3 | O P Q R S T U |
| 4 | V W X Y Z (columns 0 to 4), two decorative cells (columns 5 and 6) |
| 5 | GOODBYE (columns 1 to 5) |
Letters are in alphabetical order, on purpose: a new player looks for a letter, and
alphabetical order is the order people already know.
## Requirements
### Requirement 1: Rounds and messages
**User Story:** As a player, I want the spirit to spell a short message one target at a
time, so that I practise pointing and selecting at my own pace.
#### Acceptance Criteria
1. A Round SHALL consist of exactly one Message. Each Message SHALL be one of three kinds:
   a **word** (3 to 6 letters, one Step per letter), an **answer** (one Step, YES or NO), or
   the **farewell** (one Step, GOODBYE).
2. THE Séance SHALL show the current Step by marking its Board target (Requirement 3 sets
   how strongly). Exactly one Board target SHALL be marked as the next target at any time
   while a Round is playing.
3. WHEN a Hit occurs, THE Séance SHALL move to the next Step and show the letter in the
   spelled-so-far line. WHEN the last Step is hit, THE Round SHALL end as complete.
4. WHEN a Miss occurs, THE Séance SHALL keep the same Step, add the Miss to the Round's
   count, and give no other consequence: no lost progress, no penalty, no sound, no
   message that says the player was wrong.
5. THE Séance SHALL impose no time limit on a Step or a Round and SHALL show no countdown
   (WCAG 2.2.1).
6. THE Séance SHALL offer a Stop target in every input mode. WHEN it is selected, THE Round
   SHALL end as stopped and the Summary SHALL show.
7. THE Round SHALL always be able to end: from any state, Stop ends it, and selecting each
   remaining Step's target in turn ends it as complete (Property 1).
8. WHEN a Round has ended, THE Séance SHALL ignore further Board-target selections for that
   Round.
9. THE first Round after the page loads SHALL be a word of 3 letters. After that, every
   fourth Round (the 4th, 8th, 12th, and so on) SHALL be an answer or the farewell, in the
   repeating order YES, NO, GOODBYE; every other Round SHALL be a word of 3 to 6 letters
   that is not the previous Round's word. The choice SHALL be a pure function of a seed and
   the Round number (Requirement 14 AC 5).
10. THE spelled-so-far line SHALL show the letters hit so far and one placeholder mark for
    each Step still to come, so the player can see how far the Round has gone.
11. THE Séance SHALL announce progress to screen readers through a polite live region: the
    letters spelled so far and which target the spirit points to next.
### Requirement 2: Counting selections
**User Story:** As a player and as a carer reading the Summary, I want the counts to be
true, so that I can trust them.
#### Acceptance Criteria
1. THE Séance SHALL classify every Board-target selection that arrives while a Round is
   playing as exactly one of Hit or Miss, and SHALL count it once. A selection SHALL NOT be
   counted twice (Property 2).
2. THE Round SHALL ignore a selection whose timestamp is not later than the previous
   accepted selection's timestamp (the skeleton's rule: time is measured, never counted in
   frames).
3. Selections of control targets (Stop, Undo, Cancel, Sound, camera toggle, suggestion
   targets, summary targets) SHALL NOT be counted as Hits or Misses.
4. WHEN Undo is selected during a Round and at least one Hit stands, THE Round SHALL step
   back one Step, remove that letter from the spelled-so-far line, and add one to Taken
   back. Undo SHALL NOT change the Miss count and SHALL NOT remove the original selection
   from the counts. WHEN no Hit stands, Undo SHALL do nothing. The final Hit ends the Round at once (Requirement 1
   AC 3), so Undo cannot take back the last letter; a one-step Message has nothing to undo.
5. THE Round SHALL measure time only from timestamps passed in. It SHALL record, for each
   Step, the time from when the Step became the next target to the Hit. It SHALL NOT read a
   clock.
6. THE number of Hits standing SHALL never exceed the number of Steps, and the spelled-so-far
   letters SHALL always be a prefix of the Message (Property 3).
### Requirement 3: Gentle adaptation
**User Story:** As a player who is having trouble, I want the game to help me without
making me feel I failed, so that I can keep practising.
#### Acceptance Criteria
1. THE Séance SHALL keep a Support level of 0, 1 or 2. It starts at 0 when the page loads.
2. AT level 0, THE next target SHALL be marked with the spirit's marker: a lantern-coloured
   outline and a small planchette glyph. THE marker SHALL differ from unmarked targets by
   shape (outline weight and glyph) as well as colour.
3. AT level 1 or higher, THE Séance SHALL show the next target more strongly: a thicker
   outline, a larger glyph, and a callout in the spelled-so-far line that names the target
   ("Next: L"). AT level 2, THE other Board targets SHALL also be drawn with lower emphasis.
   Lower emphasis SHALL keep every text at 4.5:1 contrast or better and every target
   outline at 3:1 or better, and SHALL NOT change any target's position, size or whether it
   can be selected.
4. THE Séance SHALL raise the Support level to at least 1 after `strongCueAfterMisses`
   Misses in a row (Misses with no Hit between them), and to 2 after `suggestAfterMisses`
   Misses in a row. Both values are in the single `SEANCE_CONFIG` object (defaults 2 and 4).
5. A Miss SHALL NEVER lower the Support level (Property 4).
6. THE Support level SHALL fall by one only after `calmAfterHits` Hits in a row (default 3),
   and never below 0 (Property 5). The level SHALL carry from one Round to the next.
7. WHEN the level reaches 2 and no Suggestion has been shown in this Round and the Dwell
   time is below its maximum, THE Séance SHALL offer a Suggestion: a longer dwell time equal
   to the current Dwell time plus `suggestedDwellStepMs` (default 300), kept inside 400 to
   3000 ms and on a 50 ms step. The Suggestion SHALL never be lower than the current Dwell
   time (Property 6).
8. THE Suggestion SHALL show as two targets in a fixed place in the side column ("Hold
   longer: N ms" and "Not now"), with a status message in plain language. WHEN the person
   selects "Hold longer", THE Séance SHALL set the Profile's Dwell time to the suggested
   value through `setProfile` and save the Séance Profile. WHEN the person selects "Not now",
   or Cancel, THE Séance SHALL close the Suggestion and change nothing. THE Suggestion SHALL
   never be applied by any other route, and it SHALL show at most once per Round.
9. THE adaptation SHALL NOT affect the Message, the Step order, the board layout, or any
   count.
10. THE Séance SHALL use no word in any adaptation text that judges the player (no "wrong",
    "failed", "bad", "try harder"). Text names what to do next ("Next: L", "A longer hold may
    help").
### Requirement 4: Summary
**User Story:** As a player, a carer or a therapist, I want a calm summary at the end of a
round, so that I can see how it went.
#### Acceptance Criteria
1. WHEN a Round ends, THE Séance SHALL show the Summary in place of the board, with: the
   Message spelled so far (and the whole Message if the Round completed), the number of
   letters hit out of the Steps, the Round's time in seconds, the number of accidental
   selections (Misses), and the number Taken back.
2. THE Summary SHALL state what an accidental selection is: "a letter or word that was not
   the one the spirit pointed to".
3. THE Summary SHALL show the Dwell time and input mode in force at the end of the Round.
4. THE Summary SHALL give no score, grade, star rating or comparison with other Rounds or
   people, and SHALL use only calm wording.
5. THE Summary SHALL offer "Another round" as a target. It SHALL start the next Round with
   the Support level carried over.
6. WHEN the Round was stopped, THE Summary SHALL say so in plain words ("You stopped this
   round") and SHALL NOT offer Carry.
7. WHEN the view changes (board to Summary, or Summary to board), THE Séance SHALL apply the
   **arrival guard**: a target of the new view that contains the pointer's last known position
   SHALL stay unregistered, drawn dashed, until a `pointer-move` places the pointer outside
   it. This stops a pointer resting where the person just pressed "Another round" from
   starting a dwell on the GOODBYE target under it (Property 17). In scanning modes and
   whenever no pointer position is known, targets register at once.
8. A `select` stamped at or before the moment the view changed from the board to the Summary
   SHALL be ignored (the same reasoning as the Board's `settings-gate.ts`).
9. THE Summary SHALL fit without page scroll at 1366×768 and 1920×1080 (Requirement 9).
### Requirement 5: Carrying the dwell time to the Board
**User Story:** As a person or carer, I want to take the dwell time that worked in practice
into the Board, so that the Board starts at a setting I have tried, and I want nothing to
change in the Board unless I say so.
#### Acceptance Criteria
1. THE Summary SHALL offer the Carry target only when all of these hold: the Round completed,
   the input mode at the end of the Round was head + dwell, the mode did not change during
   the Round, and the Board key can be read or does not exist.
2. THE Carry target SHALL show the value, for example "Use 2100 ms on the Board", and the
   Summary SHALL state the Board's current dwell time ("The Board now uses 2100 ms") or that
   the Board has no saved settings yet. WHEN the Board already uses that value, THE Séance
   SHALL show a text saying so instead of the target.
3. THE Séance SHALL write the Board key only when the Carry target is selected. THE Séance
   SHALL NOT write the Board key on load, on Round end, on Settings change, on accepting a
   Suggestion, or by any other route (Property 11).
4. WHEN the Board key holds a valid Board settings record, THE Carry SHALL change only
   `profile.dwellTime` and SHALL keep every other stored field exactly as it was.
5. WHEN the Board key does not exist, THE Carry SHALL write a complete record the Board
   accepts: `{ version: 1, profile: { dwellTime }, board: <the Board's four default
   fields> }`, so the Board neither discards it nor loses its own defaults.
6. WHEN the Board key exists but cannot be read as a valid record (not JSON, wrong version,
   wrong shape), THE Carry SHALL write nothing, and the Summary SHALL say that the Board's
   settings could not be read and nothing was changed.
7. THE written dwell time SHALL be a whole number of ms, kept inside 400 to 3000, on a 50 ms
   step.
8. AFTER a Carry, THE Summary SHALL show "The Board now uses N ms" and the Undo target SHALL
   put back what was there before (the previous value, or no key if there was none).
   WHEN no Carry has happened, Undo in the Summary SHALL do nothing.
9. THE Carry SHALL never write `startCameraOnLoad`, `mode`, calibration or any other Profile
   field, and SHALL never write a Round's counts, times or messages anywhere.
10. THE Carry's storage access SHALL be wrapped so a storage failure (unavailable, quota)
    shows a plain message and throws nothing.
### Requirement 6: Fixed board layout
**User Story:** As a player building motor memory, I want every target to stay where it is,
so that I can learn the board.
#### Acceptance Criteria
1. THE Séance SHALL lay out the board as in the "Game board" table, with every Board target
   at its cell for the life of the page.
2. THE position and size of every Board target SHALL NOT change with the Support level, the
   Round, the Suggestion, the input mode, the Sound setting, or the view shown in the side
   column (Property 16). Switching to the Summary replaces the board's targets with the
   Summary's targets and is the only change of the board's target set.
3. EVERY Board target SHALL be at least the Profile's target size (96 × 96 CSS px by default)
   and every gap between targets at least the Profile's target spacing (16 CSS px by default).
4. EVERY label SHALL fit its target at 24 CSS px or larger with no overflow. A letter SHALL be
   drawn large (at least 40 CSS px).
5. THE decorative cells SHALL be neither targets nor focusable, and SHALL be hidden from
   screen readers.
6. THE board SHALL be in reading order for scanning (top to bottom, left to right), and the
   Séance SHALL pass no scan order to the skeleton.
### Requirement 7: Input modes and controls
**User Story:** As a person with a specific combination of abilities, I want to use the mode
that fits my body, and as a carer I want the same controls as the Board, so that setup is
the same.
#### Acceptance Criteria
1. THE Séance SHALL support every skeleton input mode: head + dwell, head + gesture, gesture
   scanning, switch scanning, and mouse.
2. THE Séance SHALL reuse the skeleton's calibration, Profile and scanning engine unchanged.
   It SHALL NOT implement a second calibration, Profile or scanning mechanism. It SHALL build its
   input controls (mode selector, camera toggle, message line, first-run hint, Calibrate, settings
   gate, role wiring of the rest-area and Cancel targets) with the skeleton's `./ui` exports from
   Requirement 17, not with a copy.
3. THE Séance SHALL show a Controls row with a mode selector and a Settings button, a Camera
   row with a camera toggle ("Start camera" / "Stop camera"), a Status panel with the
   tracking-status indicator and a message line, and a rest area. They SHALL work as in the
   Board (Board spec Requirement 13).
4. THE mode selector and Settings button SHALL be ordinary labelled form controls and not
   Planchette targets. THE camera toggle SHALL also be a Planchette target of role `default`
   (id `camera-toggle`).
5. THE Séance SHALL register a Cancel-role target (id `cancel`) and an Undo-role target (id
   `undo`) in every view, and a rest-area target (id `rest-area`) in every view. In scanning
   modes the skeleton's own cancel item in every scan cycle applies.
6. THE Séance SHALL start the camera only when the camera toggle is selected while the camera
   is off, or on page load when the saved Séance Profile's `startCameraOnLoad` is on (default
   off). Loading the page with the default Profile, changing the mode, starting a Round, or
   any other action SHALL NOT start the camera.
7. WHEN tracking reports a failure (permission denied, load failure, no face), THE Séance SHALL
   show the toggle as "Start camera" again, and the Status panel SHALL show the plain-language
   message and the alternatives (switch scanning and mouse). Rounds SHALL keep working in
   scanning and mouse modes (Property 13).
8. WHILE no saved Séance Profile existed at load, AND no `select` has occurred, AND the camera
   has not been started, THE Séance SHALL show the first-run hint "Choose an input mode, or
   press Start camera" in the Status panel's message line. It SHALL replace it when the first
   `select` occurs or the camera starts, and SHALL NOT show it again until the page is loaded
   again with no saved Profile. Showing or removing it SHALL NOT move any element.
9. THE Séance's automated tests SHALL never start a real camera. They use a fake Planchette
   whose `startCamera` is a spy, or assert that `getUserMedia` is not called.
10. THE Séance SHALL save the chosen mode with the rest of its Profile (Requirement 8).
11. THE Séance SHALL import the skeleton only as `@planchette/skeleton` and
    `@planchette/skeleton/ui`, never from a path into `skeleton/` (import-boundary test and
    the package-build test enforce this). It SHALL NOT import from the Board app's source.
### Requirement 8: Settings and Profile
**User Story:** As a person or carer, I want to set the dwell time and the camera start
option, and calibrate, so that the game fits me.
#### Acceptance Criteria
1. THE Séance SHALL provide a Settings dialog, opened from the Settings button, with: Dwell
   time (400 to 3000 ms, step 50), "Start camera when the page opens", a Calibrate button
   (it works only while the camera is on, and says so otherwise, as in the Board), and a
   short About text (what Séance is, the not-a-medical-device notice, the version).
2. THE Séance SHALL reuse the skeleton Profile fields as defined in input-core. It SHALL
   define no Séance-only Profile field.
3. THE Séance SHALL save the Profile (as exported by the skeleton) to the Séance key as
   `{ version: 1, profile }` whenever it changes (mode selector, calibration, Settings,
   accepted Suggestion).
4. WHEN the page loads and no valid saved Séance Profile exists, THE Séance SHALL set the
   Dwell time to 2100 ms through `setProfile`. WHEN one exists, THE Séance SHALL keep its
   Dwell time, whatever its value.
5. IF the Séance key is missing, corrupt or fails to parse, THEN THE Séance SHALL fall back
   to the defaults without throwing, and SHALL continue to work (Property 12).
6. WHILE the Settings dialog is open, THE Séance SHALL ignore Board-target selections, and a
   `select` stamped at or before the dialog's last close SHALL be ignored (as in the Board's
   `settings-gate.ts`).
7. THE Séance SHALL NOT store Round counts, times, Support level, Messages or any other
   record of play. The Séance key holds the Profile only.
### Requirement 9: Fit to the viewport
**User Story:** As a head-pointer user who cannot scroll, I want everything on one screen.
#### Acceptance Criteria
1. WITH the default Profile sizes, THE Séance SHALL show the spelled-so-far line, the board
   (or the Summary), the side column (suggestion targets, action targets, camera row,
   Controls row, Status panel) and the notice entirely inside a 1366×768 and a 1920×1080
   viewport, with no page scroll in either axis, in the playing view, the Summary (completed
   and stopped), and with the Suggestion open.
2. EVERY registered Planchette target's rectangle SHALL lie fully inside the viewport in all
   views, at both sizes.
3. THE spelled-so-far line SHALL stay in the same place and the same size in every view. A
   longer line SHALL never scroll the page.
4. THE side column SHALL be 478 CSS px wide at 1366×768 (as in the Board) with three equal
   columns of targets, and SHALL hold: suggestion row, action row (Stop, Undo, Cancel),
   camera row (camera toggle, Sound, rest area), Controls row, Status panel, notice.
5. AT 1920×1080, THE page MAY stay centred at its 1366-wide size (scaling to the viewport is
   optional, Task O1). WHEN scaling is built, every figure in Requirements 6 and 9 SHALL hold
   at the scaled size.
### Requirement 10: Accessibility
**User Story:** As a person with low vision, motion sensitivity or a screen reader, and as a
carer, I want Séance to follow the accessibility rules.
#### Acceptance Criteria
1. THE Séance SHALL meet every rule in `accessibility.md` that applies to a layout: target
   size and spacing, a rest area, Cancel and Undo in every mode, dwell progress shown by
   shape as well as colour, scan highlight shown by a thick outline plus a fill change,
   visible tracking status, and the camera rules.
2. THE Séance SHALL draw dwell progress as an outline on the target's own edge, with the
   skeleton's `createDwellRing` using the `outline` shape, and the scan highlight with
   `createScanHighlight`, as in the Board.
3. THE Séance SHALL keep text contrast at 4.5:1 or better and UI-part contrast (borders,
   focus rings, outlines, the marker) at 3:1 or better, against the surface each sits on,
   including at Support level 2 (lower emphasis) and in the Summary.
4. THE Séance SHALL show text at 24 CSS px or larger everywhere, except the decorative
   planchette glyph, which has no text.
5. EVERY interactive element SHALL be a real focusable element with an accessible name and a
   visible focus indicator, so a carer can operate Séance by keyboard and screen reader.
6. THE Séance SHALL follow `prefers-reduced-motion`: no animation at all under it, and the
   dwell outline in quarter steps.
7. NOTHING SHALL flash more than three times per second, and Séance SHALL have no flash at
   all: no jump scare, no sudden full-screen change, no strobing.
8. THE decorative art SHALL be hidden from assistive technology.
9. axe-core SHALL report no violation on every view (Requirement 16 AC 4).
### Requirement 11: Theme and art
**User Story:** As a player, I want it to feel like a spooky game, so that practice is fun,
and as a person who may be anxious, I want it never to be frightening.
#### Acceptance Criteria
1. THE Séance SHALL carry the Halloween theme of the skeleton demo and App B: a dark,
   candle-lit board with a moon and fog, drawn in CSS and inline SVG only.
2. THE Séance SHALL use no image file, no web font and no third-party asset. Fonts are the
   system's. No licence entry is needed; if a later change adds one, `THIRD_PARTY.md` gets
   an entry.
3. THE spirit SHALL be gentle: wording is friendly ("The spirit is spelling…"), and no
   Message, label or sound refers to death, harm or fear.
4. THE Séance SHALL have no jump scare, no sudden movement, no flashing and no loud sound.
5. THE Séance SHALL define every colour once, as a CSS custom property, in `seance.css`
   (a file, not inline styles, because the page's Content-Security-Policy allows same-origin
   styles only). Each text and surface pair SHALL be checked against Requirement 10 AC 3 by a
   test.
6. THE slow glow around the marker MAY change opacity by at most 15 % over at least 3 s. It
   SHALL be off under reduced motion.
### Requirement 12: Sound
**User Story:** As a player who likes sound, I want soft sounds I can switch on and off, and
as a person who does not, I want silence.
#### Acceptance Criteria
1. THE Séance SHALL be silent when the page loads. It SHALL create no `AudioContext` until
   the person selects the Sound target to turn sound on.
2. THE Sound target (id `sound-toggle`, `aria-pressed`) SHALL be a Planchette target in every
   view. It SHALL toggle sound on and off, and SHALL read "Sound off" / "Sound on" so that the
   same target is the mute control. Turning sound off SHALL silence any tone at once.
3. THE sounds SHALL be made with Web Audio oscillators: a soft tone for a Hit, a gentle
   two-note phrase for a completed Round, and nothing for a Miss, Undo or Stop.
4. EVERY tone SHALL have a peak gain no higher than `maxGain` (0.12), a fade-in and fade-out
   of at least 20 ms, a length of at most 600 ms, and SHALL start no sooner than 150 ms after
   the previous tone (Property 15).
5. THE sound setting SHALL NOT be saved. Sound is off on every page load.
6. THE Séance's automated tests SHALL never make a sound: unit tests use a fake audio context;
   end-to-end tests assert that no `AudioContext` is created until Sound is pressed.
7. EVERY selection SHALL still give visual feedback; sound is never the only signal.
### Requirement 13: Local-only operation
**User Story:** As a person using Séance, I want nothing to leave my device.
#### Acceptance Criteria
1. THE Séance SHALL make no network request of any kind, and SHALL load no remote script,
   style, font, image or sound (Property 14).
2. THE Séance's page SHALL carry the same Content-Security-Policy as the Board and the
   skeleton demo (`default-src 'self'; connect-src 'self'; script-src 'self'
   'wasm-unsafe-eval'`).
3. THE Séance SHALL use browser storage only for two keys: its own Séance key (Requirement 8)
   and, only on a Carry, the Board key (Requirement 5).
4. THE Séance SHALL accept no free text from the player. The only inputs are target
   selections, the mode selector, and the Settings fields.
### Requirement 14: Messages
**User Story:** As the maintainer, I want a small, safe, original list of messages.
#### Acceptance Criteria
1. THE Séance SHALL bundle its Messages in one source file, written for this project. They
   are single common English words chosen by hand, with no text taken from any book, game,
   film or word list, so there is nothing to attribute.
2. EVERY word Message SHALL be 3 to 6 letters, all in A to Z, unique in the list, and SHALL
   have no two identical letters next to each other. (A selection happens once per stay on a
   target, so a double letter would need the pointer to leave and come back, which the Board's
   spelling practice covers but a first game should not demand.)
3. THE list SHALL contain every letter A to Z in at least one word, so practice reaches the
   whole board.
4. NO Message SHALL appear in the Board's offensive-word list (`apps/board/data/offensive-words.json`;
   a test reads it as data, and it is the only place a test touches the Board's files).
5. THE choice of the next Message SHALL be a pure function of `(seed, round number, previous
   Message)`, using no clock and no `Math.random`. The page supplies the seed once on load.
### Requirement 15: Layout validation with the dwell simulator
**User Story:** As the maintainer, I want the same evidence as the Board that the layout is
safe under dwell before calling it done (product.md Principle 1).
#### Acceptance Criteria
1. THE project SHALL export the Séance's layouts for the simulator: the playing view and the
   Summary at 1366×768 and 1920×1080, four files
   (`seance-layout-play-<size>.json`, `seance-layout-summary-<size>.json`), read from
   `planchette.getTargets()` of the built page.
2. THE project SHALL run the six presets (`steady`, `slow`, `head-tremor`,
   `strong-head-tremor`, `small-range`, `reads-while-pointing`) on all four layouts at the
   Séance default dwell time (2100 ms), with the task `{ eachTarget: 2 }` over each layout's
   selectable targets, and seed 1.
3. THE gate: `reads-while-pointing`'s `accidentalPer100Intended` SHALL be at or below 10 on
   every layout, at 2100 ms, for the worst of seeds 1 to 10 (the rule the Board's default
   was chosen by, which includes seed 1).
4. IF the gate is missed, THEN the work SHALL stop and report the numbers (preset, layout,
   seed, `accidentalPer100Intended`, the causes found) with options, as the Board did. The
   target SHALL NOT be loosened, the default dwell SHALL NOT be changed, and the layout
   SHALL NOT be changed without the user's approval.
5. THE results SHALL be appended to `docs/kiro-journal.md` and written to
   `docs/seance-gate.md`, in the format the Board's runs use.
### Requirement 16: Tests
**User Story:** As the maintainer, I want the behaviour proved, not assumed.
#### Acceptance Criteria
1. EVERY pure module's behaviour in these requirements SHALL have a unit test, and every
   invariant listed in "Properties for property-based tests" SHALL have a fast-check test
   (100 runs or more), tagged `Feature: seance, Property N: <text>`.
2. THE end-to-end suite SHALL play a full Round in mouse mode and in switch-scan mode (Space as
   the switch), and cover Stop, Undo, the Suggestion, the Summary, Carry (including that the
   Board key is untouched until the press) and Carry's Undo.
3. THE end-to-end suite SHALL check at 1366×768 and 1920×1080 that the page does not scroll
   and every target lies inside the viewport, in every view.
4. THE end-to-end suite SHALL run axe-core on every view: the playing view at Support level 0
   and at level 2 with the Suggestion open, the Summary after a completed Round and after a
   stopped one, and the Settings dialog; also with a camera failure message showing.
5. NO automated test SHALL start a real camera or make a sound.
6. WHEN a property test finds a counterexample, it SHALL be kept as a fixed regression test and
   logged in `docs/kiro-journal.md`.
### Requirement 17: Shared input controls in the skeleton
**User Story:** As an app developer, I want the input controls in the kit, so that every app has
the same ones without copying them.
#### Acceptance Criteria
1. THE skeleton's `./ui` entry point SHALL export `mountInputControls` (the mode selector, camera
   toggle, tracking-indicator visibility, message line, first-run hint, Calibrate handling and
   camera start/stop rules now in `apps/board/src/board-controls.ts`), `createSettingsGate` (now
   `apps/board/src/settings-gate.ts`), and the DOM-target helpers `elementRect`, `roleOptionsOf`
   and `createTargetRegistry` (the registration of `data-planchette-target` elements with their
   `data-role`, now inline in `board-dom.ts`), with their types.
2. THE controls SHALL take every user-facing string from the app (a `text` option), so the skeleton
   holds no app wording, and SHALL expect only the element ids and `data-planchette-target` ids the
   Board's page already uses, documented in the skeleton's `README`/docs.
3. THE Board SHALL use the skeleton's exports. THE Board's behaviour SHALL NOT change: every Board
   unit, property, end-to-end and viewport test passes unchanged and unedited. The Board keeps
   `board-controls.ts` and `settings-gate.ts` as thin wrappers that pass the Board's strings and
   re-export the same names, so the tests' imports are unchanged.
4. THE skeleton's public-API tests SHALL be updated for the new `./ui` names, and the skeleton SHALL
   still do nothing when imported (no global added, no DOM needed to import).
5. THE skeleton demo and App B SHALL be unaffected. The input-core design's "UI helpers" paragraph
   SHALL get a one-sentence amendment naming the new exports (reported to the user, as the Board's
   Task 30 amendment was).
### Requirement 18: Séance is App B
**User Story:** As a maintainer, I want the repo to describe the two apps it really has.
#### Acceptance Criteria
1. THE `apps/game` stub, `game/index.html` and the `game` entry of `vite.config.ts` SHALL be removed,
   and a `seance` entry SHALL be present. No other file SHALL still refer to `/game/` or `apps/game`.
2. `product.md`, `structure.md`, `tech.md` and `README.md` SHALL describe App B as Séance, a spooky
   head-pointer practice game, at `/seance/`, with its sources in `apps/seance`. The "no text" and the
   "deferred App B game design" statements SHALL be replaced by this spec.
3. `accessibility.md`'s no-flashing rule SHALL stay general (it applies to every app and theme), and
   its wording SHALL NOT name a specific app.
4. THE theme rule SHALL say that App A is calm and unthemed, and that App B (Séance) and the skeleton
   demo carry the Halloween theme.
## Properties for property-based tests
Detailed in design.md. In short:
1. A Round always ends, and an ended Round is absorbing.
2. No selection is counted twice; counts partition the accepted selections.
3. Progress is a prefix of the Message; Hits never exceed Steps.
4. A Miss never lowers the Support level.
5. The Support level falls only after `calmAfterHits` Hits in a row, by one, never below 0.
6. A Suggestion is never below the current Dwell time, is on range and step, shows at most
   once per Round, and is never applied without an accept input.
7. Undo: a Hit then Undo restores the progress; Undo with no Hit is a no-op; Undo never changes
   the Miss count.
8. Time values are non-negative, depend only on timestamps, and do not change with frame rate.
9. Message choice is deterministic, in the list, and never repeats the previous word.
10. The message list is valid (length, letters, no doubles, covers A to Z, no offensive word).
11. Carry writes only when called, keeps every other stored field, clamps and rounds, refuses an
    unreadable record, writes a record the Board's reader accepts, and Undo restores exactly.
12. Corrupt Séance storage never throws and falls back to the defaults.
13. With the camera unavailable, mouse and scan selections still complete a Round without error.
14. No network call anywhere in the pure layer.
15. Sound plans stay inside the gain, length, fade and spacing limits.
16. Board-target positions and sizes never change with Support level, Round, mode or Sound.
17. The arrival guard never registers a target that contains the pointer at the moment the view changes.
