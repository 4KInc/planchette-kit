# Requirements Document

## Introduction

App A is the communication board: a hands-free augmentative and alternative
communication (AAC) tool built on the Planchette Kit skeleton. A person builds a
message word by word from a fixed core-vocabulary grid, a word-prediction strip, a
spell mode and an editable quick-phrases list, and speaks it with on-device text to
speech. It works with every skeleton input mode (head pointer with dwell, face-gesture
switch scanning, keyboard or switch scanning, gamepad switch scanning, and mouse),
reuses the skeleton's calibration and profile, and never sends anything off the
device. The board is calm and unthemed: no spooky effects, no flashing, nothing that
is not a daily, dependable tool.

The board is not a medical device and not a replacement for an AAC system assessed by
a speech-language therapist; this notice is shown in the app.

## Glossary

- **Board**: the communication board app (App A), served at `/board/index.html`,
  entry script `apps/board/src/main.ts`.
- **Planchette**: the skeleton instance (`createPlanchette`) the board drives through
  its public API only (`@planchette/skeleton`, `@planchette/skeleton/ui`).
- **Message**: the sequence of words and letters the person has built but not yet
  spoken, shown in the message bar.
- **Message bar**: the on-screen area that shows the current Message.
- **Action**: one change to the Message or to spoken output: Add word, Add letter,
  Add space, Backspace, Clear, Speak. Mode switches, settings changes and prediction
  updates are not Actions.
- **Undo**: reverses the most recent Action, including a Clear, restoring the Message
  (and, for a spoken Action, nothing is un-spoken; see Requirement 8).
- **Core-vocabulary grid**: the fixed set of buttons listed in the Core vocabulary
  table below. Every button's position and label are fixed for the lifetime of the
  session: they never move, reorder, resize relative to each other, appear or
  disappear because of prediction, mode, settings, spelling, or window size (window
  size may rescale the whole grid uniformly; it never changes which button is where
  relative to the others).
- **Prediction strip**: a fixed-position, fixed-count row of slots, separate from the
  core-vocabulary grid, that offers predicted next words. A slot's content updates
  only when the rules in Requirement 4 allow it.
- **Slot**: one position in the Prediction strip, numbered 0 to `predictionSlotCount -
  1` (default 4; see Requirement 11).
- **Spell mode**: a state of the Board in which the grid shown is the Letter board
  instead of the core-vocabulary grid.
- **Letter board**: the fixed-position grid of letters, space and backspace used in
  Spell mode (Requirement 3).
- **Quick phrase**: a complete, named phrase in the person's editable Quick-phrases
  list (Requirement 7), selectable as a single action that replaces the Message.
- **Core word list**: the fixed list of words shown in the Core-vocabulary grid, from
  the Universal Core vocabulary (Center for Literacy and Disability Studies, UNC
  Chapel Hill; CC BY 4.0; see Requirement 2).
- **Exclusion list**: the bundled list of single offensive words (from LDNOOBW) used
  to filter the Prediction word list when `filterOffensiveWords` is on (Requirement 4).
- **Prediction word list**: the bundled word-frequency data used, together with the
  person's spoken-word history, to rank predictions (Requirement 4).
- **Spoken-word history**: the list of words the person has spoken from the Board,
  stored locally, used as an input to prediction ranking.
- **Board profile**: the subset of the skeleton Profile fields the Board's Settings
  screen exposes, plus the Board-only settings (voice, rate) stored next to it
  (Requirement 10).
- **Local-service voice**: a `SpeechSynthesisVoice` whose `localService` property is
  `true`.
- **Partial word**: the letters the person has added in Spell mode since the last
  Add word, Add space, Clear, or Quick phrase Action, or since the start of the
  Message. It is empty when no letter is pending.
- **About screen**: the screen, reachable from Settings, that shows credits,
  licences, the not-a-medical-device notice, and the Board version (Requirement 12).
- **Carer**: a person who sets up or adjusts the Board on the person's behalf, by
  keyboard, mouse, or screen reader.
- **Controls row**: the group of input controls (mode selector, camera toggle,
  Calibrate button, and the status panel) described in Requirement 13.
- **Status panel**: the fixed area that holds the skeleton's tracking indicator
  (Requirement 13).
- **Viewport**: the browser window's visible area, in CSS px (Requirement 14).
- **Target**: as defined in the input-core spec: an element the Board registers with
  the Planchette by id and rectangle, selectable by every input mode.

## Core vocabulary (fixed grid)

Source: the Universal Core vocabulary, Center for Literacy and Disability Studies,
UNC Chapel Hill (<https://www.med.unc.edu/healthsciences/clds/universal-core-vocabulary/>),
licensed CC BY 4.0, verified on the page as fetched for this spec. It lists 36 single
words, chosen and prioritised by the Center for Literacy and Disability Studies from
existing core-vocabulary lists, speech-generating-device vocabularies and written- and
academic-language frequency, for communicating across the widest range of purposes and
partners with the fewest buttons. This matches product.md's motor-planning principle
(buttons stay where they are, so the person builds motor memory) better than a
frequency-only list would, because it was built for exactly that purpose, by
practitioners in literacy and disability studies, not statistically derived from
running text:

all, can, different, do, finished, get, go, good, he, help, here, I, in, it, like,
look, make, more, not, on, open, put, same, she, some, stop, that, turn, up, want,
what, when, where, who, why, you

36 buttons fit a 6×6 grid, which is small enough to keep every button reachable by
head pointing at the default target size and spacing (Requirement 11) on a 1366×768
screen, per the layout validation in design.md.

## Requirements

### Requirement 1: Message bar and core actions

**User Story:** As a person using the Board, I want to build a message and see it, so
that I can review it before I speak it.

#### Acceptance Criteria

1. THE Board SHALL show the current Message in the Message bar at all times.
2. WHEN the person selects a core-vocabulary button, a predicted word, or a Quick
   phrase, THE Board SHALL append the corresponding word or phrase text to the
   Message, with one space inserted between words where the existing Message does not
   already end in whitespace. A Letter-board letter follows Requirement 3 AC 4.
3. THE Board SHALL provide a Speak action target that sends the current Message to
   speech output (Requirement 9) without clearing the Message.
4. THE Board SHALL provide a Backspace action target that removes the last word, or,
   in Spell mode, the last character, from the Message.
5. WHEN the Message is empty, THE Board SHALL make Backspace, Speak, and Clear select
   with no effect on the Message and no call to speech output.
6. THE Board SHALL provide a Clear action target that empties the Message.
7. THE Board SHALL provide an Undo target that reverses the most recent Action
   (Backspace, Clear, Add word, Add letter, Add space), restoring the Message to its
   state immediately before that Action.
8. THE Board SHALL provide a Cancel target or input in every mode, per Requirement 5.
9. THE Message bar, Speak, Backspace, Clear, Undo, and Cancel SHALL be reachable in
   every input mode offered by Requirement 5.

### Requirement 2: Fixed core-vocabulary grid

**User Story:** As a person who relies on motor memory to find words quickly, I want
the core-vocabulary buttons to always be in the same place, so that pointing becomes
automatic and is never disrupted by what the Board is doing.

#### Acceptance Criteria

1. THE Core-vocabulary grid SHALL show exactly the 36 words of the Core word list
   above, one per button, arranged in a fixed 6×6 layout.
2. THE Board SHALL assign each core-vocabulary button a fixed row and column that
   does not change for the lifetime of the session.
3. WHILE the Board is in any state (any input mode, any Settings values, Spell mode on
   or off, any Prediction strip content, any window size), THE Core-vocabulary grid
   SHALL show every button at its assigned row and column, scaled uniformly with the
   grid and never reordered, hidden, replaced, or resized relative to the other
   buttons.
4. THE Board SHALL never choose a core-vocabulary button's position or presence from
   word frequency, prediction, or recency of use.
5. THE Board SHALL record the Core word list's source, licence (CC BY 4.0), and link
   in `THIRD_PARTY.md` and on the About screen (Requirement 12).

### Requirement 3: Spell mode

**User Story:** As a person who needs a word that is not in the core vocabulary or the
prediction strip, I want to spell it letter by letter, so that I can say anything.

#### Acceptance Criteria

1. THE Board SHALL provide a Spell-mode target that, when selected, shows the Letter
   board in place of the Core-vocabulary grid.
2. THE Board SHALL provide an exit-Spell-mode target that, when selected while in
   Spell mode, shows the Core-vocabulary grid in place of the Letter board.
3. THE Letter board SHALL be a fixed grid of 6 columns by 5 rows that shows the 26 English letters in frequency order (most
   frequent first: E, T, A, O, I, N, S, H, R, D, L, C, U, M, W, F, G, Y, P, B, V, K, J,
   X, Q, Z, per written-English single-letter frequency) in plain row-major order from row 0, column 0, so that row 4 holds Q, Z, then a Space button and a
   Backspace button in columns 0 to 3, with columns 4 and 5 of row 4 empty and carrying no target, and each key at a fixed row and column within the Letter board for the
   lifetime of the session. Frequency order is chosen over alphabetical order because
   every input mode here reaches letters by pointing, dwelling, or scanning in a fixed
   visiting order, so putting frequent letters earliest in that order (nearer the top
   of scan cycles, nearer typical gaze rest points for head pointing) shortens the
   average time and the average number of scan steps per letter; this trades off a
   carer's or typist's alphabetical expectation, which the Settings screen's text
   labels and screen-reader labels offset.
4. WHEN the person selects a letter in Spell mode, THE Board SHALL append that letter
   to the Message in lower case (the Letter board's labels stay upper case; the
   Message model lower-cases the letter). WHEN the Partial word is empty and the
   Message is not empty and does not end in whitespace, THE Board SHALL insert one
   space before the letter, so a new spelled word starts after the previous word
   ("I want" then H gives "I want h"). WHEN the Partial word is not empty, THE Board
   SHALL insert no space, so a spelled word continues ("I want h" then E gives
   "I want he").
5. WHEN the person selects Space in Spell mode, THE Board SHALL append one space
   character to the Message.
6. THE Letter board's Space and Backspace targets SHALL be the same Backspace and
   Add-space behaviour as Requirement 1, reachable at fixed positions within the
   Letter board.
7. THE Board SHALL never choose a Letter-board button's position from frequency of
   use, prediction, or recency.
8. WHEN the person selects Undo after a letter, THE Board SHALL restore the exact
   Message and Partial word that existed before that letter, including a space the
   letter inserted.

### Requirement 4: Word prediction strip

**User Story:** As a person who wants to build messages faster, I want predicted next
words offered separately from the core vocabulary, so that prediction never disrupts
the buttons I already know by position.

#### Acceptance Criteria

1. THE Prediction strip SHALL be a fixed-position row of exactly `predictionSlotCount`
   slots (Board profile field, Requirement 11), separate from the Core-vocabulary grid
   and the Letter board, at a position that does not change for the lifetime of the
   session.
2. WHEN the Message changes by an Add-word, Add-letter, Add-space, Backspace, or Clear
   Action, THE Board SHALL compute an ordered list of predicted next words from the
   Prediction word list and the Spoken-word history, ranked by combined frequency
   (Requirement 4 AC 7).
3. THE Board SHALL never show the core-vocabulary grid's 36 words in the Prediction
   strip to avoid two buttons for one word; the ranked list SHALL exclude every Core
   word list entry.
4. WHEN a predicted word is selected, THE Board SHALL perform the same Add-word Action
   as a core-vocabulary selection (Requirement 1 AC 2) and SHALL add the spoken word to
   the Spoken-word history only when it is later sent to speech output (Requirement 9).
5. WHILE a Slot has the pointer on it, or is the currently highlighted scan item, or is
   mid-press (a switch or gesture press in progress targeting it), THE Board SHALL NOT
   change that Slot's displayed word, so a prediction update never changes what is
   under a pointer about to be selected, under the scan highlight, or under a press in
   progress.
6. WHEN a Slot is free to update under Requirement 4 AC 5, THE Board SHALL fill it
   with the next-ranked predicted word not already shown in another Slot, or leave it
   empty and unselectable if the ranked list has fewer entries than
   `predictionSlotCount`.
7. WHEN there is no Partial word, THE Board SHALL rank a predicted word by the sum of
   its normalised frequency in the Prediction word list and a count-weighted score
   from the Spoken-word history, so that words the person has actually spoken before
   are favoured over the bundled list alone.
8. THE Board SHALL bundle the Prediction word list as its own data file, derived from
   the English OpenSubtitles 2018 frequency list of hermitdave/FrequencyWords (author
   Hermit Dave; subtitles from OpenSubtitles 2018 via OPUS; licence CC BY-SA 4.0 for
   the content), and SHALL record its source, size, licence, and the changes made
   (trimmed, lower-cased, filtered) in `THIRD_PARTY.md`, in a licence notice stored
   next to the data file, and on the About screen (Requirement 12).
9. THE Board SHALL store the Spoken-word history only in the browser's local storage
   on the person's device (each word lower-cased with surrounding punctuation removed;
   tokens with no letter are not added).
10. WHILE a Partial word is present, THE Board SHALL offer only predicted words that
    start with the Partial word (compared case-insensitively; a Slot locked under
    Requirement 4 AC 5 keeps its word), ranking words from the
    Spoken-word history before words only in the Prediction word list, and ranking
    within each group by the Requirement 4 AC 7 score.
11. WHEN the Partial word becomes empty, THE Board SHALL return to ranking by the
    whole-Message rule of Requirement 4 AC 7.
12. THE Board SHALL apply Requirement 4 AC 3, AC 5, and AC 6 (core-word exclusion, slot
    stability, no duplicate words) to prefix predictions in the same way as to
    whole-Message predictions.
13. WHERE the Board-only setting `filterOffensiveWords` is on, THE Board SHALL
    exclude from the Prediction strip every word that is in the Exclusion list and is
    not in the Spoken-word history (a Slot locked under Requirement 4 AC 5 keeps its
    word until the lock is released).
14. WHERE the Board-only setting `filterOffensiveWords` is off, THE Board SHALL rank
    the bundled Prediction word list without applying the Exclusion list.
15. THE Board SHALL apply `filterOffensiveWords` only to words offered from the
    bundled Prediction word list, so that a word in the person's Spoken-word history
    stays eligible for prediction whatever the setting, and SHALL NOT block or alter
    the adding of any letter or word to the Message, the Message itself, or Speak.
16. THE Board SHALL bundle the Exclusion list as its own data file, derived from the
    English list (file `en`) of LDNOOBW
    (<https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words>;
    licence Creative Commons Attribution 4.0 International, copyright 2012-2020
    Shutterstock, Inc.), SHALL keep a licence notice next to the data file, and SHALL
    record its source, licence, and the changes made in `THIRD_PARTY.md` and on the
    About screen (Requirement 12).
17. WHEN deciding whether a word is in the Exclusion list, THE Board SHALL compare
    the whole word, case-insensitively, after the same normalisation as the Prediction
    word list, and SHALL ignore Exclusion list entries made of more than one word,
    because they cannot equal a single predicted word.

### Requirement 5: Input modes

**User Story:** As a person with a specific combination of abilities, I want to use
whichever input mode fits me, so that the Board works with my body.

#### Acceptance Criteria

1. THE Board SHALL support every skeleton input mode: head pointer with dwell
   selection, head pointer with face-gesture selection, face-gesture scanning, switch
   (keyboard or gamepad) scanning, and mouse.
2. THE Board SHALL reuse the skeleton's calibration sequence and Profile unchanged; it
   SHALL NOT implement a second calibration or profile mechanism.
3. THE Board SHALL reuse the skeleton's existing scanning engine (`stepScan` via the
   public API) for every scanning mode; it SHALL NOT implement a second scanning
   engine.
4. EVERY scan cycle on the Board SHALL include the skeleton's built-in cancel item
   (Requirement 4 AC 4 of input-core), with no separate Board-level cancel item needed
   in scan mode.
5. IN head-pointer and mouse modes, THE Board SHALL register a Cancel-role target
   reachable by dwell, gesture, or click, per input-core Requirement 6 AC 1.
6. THE Board SHALL register an Undo-role target reachable in every mode, per
   input-core Requirement 6 AC 5.
7. THE Board SHALL register at least one rest-area target with no selectable content,
   so the pointer has somewhere safe to rest without selecting anything, per
   accessibility.md.
8. THE Board SHALL start the camera only after a start action from any available
   input, or on page load when the Board profile's `startCameraOnLoad` field is on,
   per input-core Requirement 2 AC 1.
9. WHEN the camera is unavailable (permission denied, load failure, or no-face
   timeout), THE Board SHALL continue to work in switch-scanning and mouse modes, and
   SHALL show the plain-language message and the mode alternatives from input-core
   Requirement 8.

### Requirement 6: Settings

**User Story:** As a person or my carer, I want to adjust timing, sizes, voice, and
rate, and keep those settings, so that the Board fits my body and my voice preference.

#### Acceptance Criteria

1. THE Board SHALL provide a Settings screen that lets the person or carer view and
   change every Board profile field in Requirement 11.
2. WHEN a skeleton Profile field (for example dwell time, target size, target
   spacing) is changed on the Settings screen, THE Board SHALL apply it through the
   Planchette's `setProfile`, so the same clamping rules as input-core apply.
3. WHEN a Board-only setting (voice, speech rate) is changed on the Settings screen,
   THE Board SHALL save it to local storage immediately.
4. THE Settings screen SHALL be operable with keyboard alone (Tab, Shift+Tab, Enter,
   Space) and SHALL expose every control's name and state to a screen reader.
5. THE Board SHALL provide an export action that produces one JSON file containing
   the exported skeleton Profile and the Board-only settings together.
6. THE Board SHALL provide an import action that reads a JSON file in the format of
   Requirement 6 AC 5, applies the skeleton Profile part through `importProfile`
   (clamped, with a report of changes per input-core Requirement 7 AC 5), and applies
   the Board-only settings part with the same missing-or-invalid-falls-back-to-default
   rule.
7. WHEN an imported Board-only setting is missing or invalid, THE Board SHALL fall
   back to that setting's default and report the fallback in the same way as a
   skeleton Profile field.
8. THE Settings screen SHALL show the setting "Filter offensive words from
   suggestions" (`filterOffensiveWords`) as an ordinary control that the person or a
   carer can change, and THE Board SHALL save it to local storage immediately with
   the other Board-only settings.
9. THE Settings screen SHALL show the setting "Start camera when the page opens" as an
   ordinary control that the person or a carer can change. It SHALL be bound to the
   skeleton Profile's existing `startCameraOnLoad` field (default off), not to a
   second Board-only field (Requirement 11 AC 4), so it is saved with the Profile,
   exported and imported with the Profile, and an imported value that is missing or
   not a boolean falls back to off and is reported by `importProfile` (Requirement 6
   AC 6).
10. THE Board SHALL save the skeleton Profile (including the input mode and
    `startCameraOnLoad`) to local storage whenever it changes through the mode
    selector, calibration, the Settings screen, or an import, so the next visit starts
    with it (Requirement 13 AC 8).

### Requirement 7: Quick phrases

**User Story:** As a person who says some things often, I want a list of whole
phrases I can edit and select in one action, so that I don't have to rebuild them
every time.

#### Acceptance Criteria

1. THE Board SHALL provide a Quick-phrases list, editable by the person or carer
   (add, edit, remove, reorder), stored only in local storage on the device.
2. WHEN a Quick phrase is selected, THE Board SHALL replace the current Message with
   that phrase's text, as one Action undoable by Requirement 1 AC 7.
3. THE Quick-phrases list SHALL be reachable and editable in every input mode listed
   in Requirement 5, through the same Settings screen keyboard and screen-reader
   support as Requirement 6 AC 4.
4. WHERE the Quick-phrases list has at least one entry, THE Board SHALL show the
   Quick-phrases entries at fixed positions among themselves for the duration of the
   session (their order may only change when the person edits the list through
   Settings), so pointing to a quick phrase does not move while the person points at
   it.
5. WHEN the Quick-phrases list already holds 100 phrases and a new phrase is added,
   THE Board SHALL refuse the new phrase, leave the list unchanged, and show the
   message "The quick-phrases list is full (100). Remove a phrase to add a new one."
   from `messages.ts`. THE Board SHALL never delete or overwrite a phrase the person
   wrote to make room.
6. WHEN stored Quick phrases exceed 100 entries, or an entry's text exceeds 500
   characters, THE Board SHALL keep the first 100 entries and cut each text to 500
   characters, rather than discarding the list, and SHALL NOT write that shortened list
   back until the person edits the list.

### Requirement 8: Speech output

**User Story:** As a person building a message, I want it spoken aloud using a voice
that never leaves my device, so that I can communicate without a network dependency
or privacy risk.

#### Acceptance Criteria

1. WHEN Speak is selected, THE Board SHALL send the Message to the browser
   `speechSynthesis` API using only a `SpeechSynthesisVoice` whose `localService` is
   `true`.
2. IF no local-service voice is available, THEN THE Board SHALL display the Message
   text at a large size instead of attempting speech and SHALL state that speech
   output is unavailable on this device.
3. THE Board SHALL never send Message text, or any part of it, to a network endpoint
   for speech synthesis or any other purpose.
4. WHERE more than one local-service voice is available, THE Board SHALL let the
   person or carer choose one on the Settings screen, saved as a Board-only setting.
5. THE Board SHALL let the person or carer choose a speech rate on the Settings
   screen, saved as a Board-only setting, and SHALL apply it to every Speak action.
6. WHEN Speak completes successfully, THE Board SHALL add each word of the spoken
   Message to the Spoken-word history (Requirement 4 AC 9) (each word lower-cased with
   surrounding punctuation removed; tokens with no letter are not added).

### Requirement 9: Accessibility and theme

**User Story:** As a person with low vision, motion sensitivity, or who uses a screen
reader, and as a carer, I want the Board to follow the accessibility rules and stay
calm and unthemed, so that it is usable and never distressing.

#### Acceptance Criteria

1. THE Board SHALL size every Core-vocabulary, Letter-board, Prediction-strip, and
   Quick-phrase target at or above the Board profile's target size, and space them at
   or above the Board profile's target spacing.
2. THE Board SHALL show text at 24 CSS px or larger everywhere on the Core-vocabulary
   grid, the Letter board, the Prediction strip, the Message bar, and the Quick-phrases
   list.
3. THE Board SHALL show dwell progress and scan highlight using the skeleton UI
   helpers (`createDwellRing`, `createScanHighlight`), which indicate progress and
   highlight by shape as well as by colour.
4. THE Board SHALL keep text contrast at or above 4.5:1 and UI-part contrast (borders,
   focus rings, target outlines) at or above 3:1 against the Board's background.
5. THE Board SHALL follow `prefers-reduced-motion`, through the same reduced-motion
   behaviour as the skeleton UI helpers.
6. THE Board SHALL show no flashing more than three times per second anywhere on the
   page.
7. THE Board SHALL use no spooky, jump-scare, or otherwise themed visual or audio
   effects; its visual design SHALL stay calm and unthemed, distinct from the
   skeleton demo and App B.
8. THE Board SHALL show a visible tracking-status indicator whenever the camera is in
   use or has failed, per input-core Requirement 8.
9. THE Board SHALL be fully operable by a carer using keyboard and screen reader
   alone: every interactive element SHALL be a real, focusable element with a visible
   focus indicator and an accessible name.
10. THE Board SHALL show the notice that it is not a medical device and not a
    replacement for an AAC system assessed by a speech-language therapist.

### Requirement 10: Local-only operation

**User Story:** As a person using the Board, I want to be certain nothing I type or
say leaves my device, so that I can trust it with private communication.

#### Acceptance Criteria

1. THE Board SHALL make no network request of any kind (no analytics, no telemetry,
   no remote speech, no remote word lists fetched at runtime).
2. THE Board's page SHALL carry the same Content-Security-Policy as the skeleton demo
   and App B (`default-src 'self'; connect-src 'self'; script-src 'self'
   'wasm-unsafe-eval'`), permitting only same-origin script and connections and the
   WASM evaluation MediaPipe needs.
3. THE Board SHALL store the Message, the Spoken-word history, the Quick-phrases
   list, and the Board-only settings only in the browser's local storage on the
   device.
4. IF stored data under the Board's local-storage keys is missing, corrupt, or fails
   to parse, THEN THE Board SHALL fall back to that data's default (an empty history,
   the built-in Quick-phrases starter list, or default settings) without throwing an
   error, and SHALL continue to operate. The one exception is a Quick-phrases list
   that parses but is over its size limits: Requirement 7 AC 6 applies, and no phrase
   is discarded.

### Requirement 11: Board profile fields

**User Story:** As a developer, I want one place that defines every Board-specific
setting, its default, and its range, so that Settings, storage, and tests agree.

#### Acceptance Criteria

1. THE Board SHALL define `predictionSlotCount` as a Board profile field: default 4,
   minimum 2, maximum 8.
2. THE Board SHALL define `voiceURI` as a Board-only setting: default empty string
   (meaning "use the first available local-service voice"), any string identifying an
   available `SpeechSynthesisVoice.voiceURI`.
3. THE Board SHALL define `speechRate` as a Board-only setting: default 1.0, minimum
   0.5, maximum 2.0 (the `SpeechSynthesisUtterance.rate` range this project supports).
4. THE Board SHALL reuse every other timing, size, and input setting (dwell time,
   target size, target spacing, mode, and so on) directly from the skeleton Profile
   fields table in the input-core requirements, introducing no duplicate field.
5. WHEN the Board starts and no saved or imported Profile exists, THE Board SHALL set
   the dwell time to 1400 ms through `setProfile`.
6. WHEN the Board starts and a saved or imported Profile exists, THE Board SHALL keep
   that Profile's dwell time, whatever its value, and SHALL NOT apply the 1400 ms
   default.
7. THE Board SHALL define `filterOffensiveWords` as a Board-only boolean setting,
   default on.
8. THE Board SHALL NOT define a Board-only "start camera on load" field. The setting
   "Start camera when the page opens" (Requirement 6 AC 9) is the skeleton Profile's
   `startCameraOnLoad` field, whose default is off.

### Requirement 12: About screen

**User Story:** As a person or carer, I want to see where the Board's data comes from,
how it is licensed, and what the Board is not, so that credit is given and I know its
limits.

#### Acceptance Criteria

1. THE Board SHALL provide an About screen reachable from the Settings screen by
   keyboard and screen reader.
2. THE About screen SHALL credit the Universal Core vocabulary (Center for Literacy and
   Disability Studies, UNC Chapel Hill), state its licence CC BY 4.0, and link to its
   source page and to the licence.
3. THE About screen SHALL credit the Prediction word list (hermitdave/FrequencyWords,
   author Hermit Dave, English OpenSubtitles 2018 via OPUS), state its licence CC
   BY-SA 4.0, state the changes made (trimmed, lower-cased, filtered), and link to its
   source repository and to the licence.
4. THE About screen SHALL state that the trimmed Prediction word list is a derivative
   that stays under CC BY-SA 4.0 and that the Board's code is MIT-licensed.
5. THE About screen SHALL show the not-a-medical-device notice of Requirement 9 AC 10.
6. THE About screen SHALL show the Board version.
7. THE About screen SHALL credit the Exclusion list (LDNOOBW, English list, copyright
   2012-2020 Shutterstock, Inc.), state its licence CC BY 4.0, state the changes made
   (single-word entries only, normalised), and link to its source repository and to
   the licence.

### Requirement 13: Input controls

**User Story:** As a person or carer, I want to choose the input mode, start and stop
the camera, and calibrate from the Board itself, so that the Board can be used out of
the box in whichever mode fits.

#### Acceptance Criteria

1. THE Board SHALL show a Controls row with: a mode selector that offers every
   skeleton input mode (head + dwell, head + gesture, switch scanning, gesture
   scanning, mouse), a camera toggle that reads "Start camera" while the camera is
   off and "Stop camera" while it is on, a Calibrate button, and the Status panel.
2. THE mode selector and the Calibrate button SHALL be ordinary focusable form
   controls with visible labels, as on the skeleton demo page, and SHALL NOT be
   Planchette targets. THE camera toggle SHALL also be a Planchette target of role
   `default` (id `camera-toggle`), at least the Profile's target size, so that a
   head-pointer, gesture, scanning, or mouse user can stop the camera, and start it
   again, without a carer.
3. WHEN the mode selector changes, THE Board SHALL call `setMode`, and WHEN the
   Profile's mode changes by any route (import, calibration, the selector) THE Board
   SHALL show that mode in the selector.
4. THE Board SHALL start the camera only when the camera toggle is selected while the
   camera is off, or on page load when the Profile's `startCameraOnLoad` is on
   (default off, Requirement 6 AC 9). Changing the mode, loading the page with the
   default Profile, or any other action SHALL NOT start the camera.
5. WHEN the camera toggle is selected while the camera is on, THE Board SHALL stop the
   camera. WHEN tracking reports a failure (permission denied, load failure, no face),
   THE Board SHALL show the toggle as "Start camera" again, and the Status panel SHALL
   show the plain-language message and the mode alternatives (Requirement 5 AC 9).
6. WHEN Calibrate is pressed while the camera is off, THE Board SHALL not start
   calibration, and SHALL say that calibration uses the camera and that Start camera
   comes first. WHEN the camera is on, THE Board SHALL call `startCalibration`.
7. THE Board SHALL show the dwell progress ring and the scan highlight by creating
   them with `createDwellRing` and `createScanHighlight` for the Planchette (Requirement
   9 AC 3), and SHALL show a hint, as the demo does, that head and gesture modes need
   the camera and that switch scanning and the mouse work without it.
8. THE Board SHALL save the chosen mode with the rest of the Profile (Requirement 6
   AC 10): the mode is the Profile's `mode` field, not a separate Board setting, and the
   next visit starts in it.
9. THE Board's automated tests SHALL never start a real camera: they use a fake
   Planchette whose `startCamera` is a spy, or assert that `getUserMedia` is not called.

### Requirement 14: Fit to the viewport

**User Story:** As a head-pointer user who cannot scroll, I want everything I need on
one screen, so that I can build, review, and speak a message without leaving the
board.

#### Acceptance Criteria

1. WITH the default Profile sizes (target size 96 CSS px, target spacing 16 CSS px) and
   the default `predictionSlotCount` (4), THE Board SHALL show the Message bar, the
   active grid (Core-vocabulary grid or Letter board), the Prediction strip, the
   action row, the Controls row with its Status panel, the rest area, and the
   not-a-medical-device notice entirely inside a 1366×768 and a 1920×1080 viewport,
   with no page scroll in either axis, in the Core view and in Spell mode.
2. EVERY registered Planchette target's rectangle SHALL lie fully inside the viewport
   in both views, at both sizes.
3. THE Message bar SHALL stay visible, at the same position and size, while the person
   is in Spell mode; a Message longer than the bar SHALL scroll inside the bar and
   show its end, never scroll the page.
4. EACH grid SHALL use equal-width columns and equal-height rows, so that every cell
   of a grid has the same size. EVERY label SHALL fit inside its cell with no overflow
   and at 24 CSS px or larger: a label wraps at spaces, and no word is split.
5. THE Prediction strip's slots SHALL each have a reserved position in the layout,
   whether or not the slot holds a word.
6. THE Board SHALL NOT shrink any target below the Profile's target size, or any gap
   below the Profile's target spacing, to make the layout fit.
7. WHERE the person or a carer sets a target size, target spacing, or
   `predictionSlotCount` larger than the default, THE Board SHALL keep every target at
   the chosen size and MAY need more than one screen; the guarantee in AC 1 is for the
   defaults only.

## Properties for property-based tests

These must hold for any generated sequence of Board actions (selections, mode
switches, settings changes, Spell-mode toggles, resizes, prediction updates, imports)
and any valid Board profile.

1. **Core grid never moves**: for any sequence of actions, every core-vocabulary
   button's row, column, and label at the end of the sequence equals its row, column,
   and label at the start.
2. **Clear then undo is identity**: for any Message state, performing Clear and then
   Undo restores the exact Message that existed before Clear.
3. **Undo restores the previous Message**: for any Message state and any undoable
   Action (Add word, Add letter, Add space, Backspace, Clear), performing the Action
   and then Undo restores the exact Message and Partial word that existed before the
   Action (including a space that the Action inserted).
4. **Prediction never changes a slot in use**: for any sequence of Message changes and
   any slot that is under the pointer, scan-highlighted, or mid-press at the moment of
   a prediction recompute, that slot's displayed word is unchanged by the recompute.
5. **Prediction excludes core words**: for any Message and any resulting ranked
   prediction list, no entry equals any Core word list entry.
6. **Settings round trip**: for any valid Board settings (skeleton Profile subset,
   including `startCameraOnLoad`, plus Board-only settings), exporting then importing
   returns an equivalent settings object. A missing or non-boolean `startCameraOnLoad`
   imports as off and is reported.
7. **Corrupt storage never throws**: for any malformed or partial JSON stored under a
   Board local-storage key, loading it produces the documented default and the Board
   continues to operate without throwing.
8. **No network calls**: for any sequence of Board actions, no `fetch`, `XMLHttpRequest`,
   or `WebSocket` call is made.
9. **Prefix predictions**: for any Message with a non-empty Partial word, every predicted
   word starts with the Partial word.
10. **Offensive-word filter**: for any Message, word list, history, and Exclusion list,
    with `filterOffensiveWords` on no Exclusion list word is in the Prediction strip
    unless it is in the Spoken-word history; with it off, the strip is ranked from the
    unfiltered list.
11. **Spelling after a word**: for any core word `w` and any non-empty letter sequence
    `s`, Add word `w` on an empty Message, then Add letter for each letter of `s`,
    gives the Message "`w` `s`" with `s` in lower case.
