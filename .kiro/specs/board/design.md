# Design: communication board (App A)

## Overview

The Board is a plain-DOM, plain-TypeScript app (no framework, per tech.md) built on
one `Planchette` instance from `@planchette/skeleton`. Its own logic — the Message
model, the undo stack, the prediction ranker, the Quick-phrases store, and settings
storage — is pure and framework-free, so it is unit- and property-testable without a
DOM or a browser. A thin rendering layer owns the DOM: it draws the fixed grid, the
Message bar, and the Settings screen, and it is the only place that calls
`registerTarget` / `updateTarget` and reads `Planchette` events.

The hard constraint across every requirement is **position stability**: the
core-vocabulary grid, the Letter board, and the Prediction strip must never move or
reorder regardless of what else happens in the app. The design meets this by
separating "what is shown" (a pure, deterministic layout function) from "what is
true" (the Message, undo stack, prediction ranking, and settings), and by gating
Prediction-strip updates on pointer/highlight/press state the same way the skeleton
gates dwell progress — through the public API's own events, never by polling the DOM.

## Architecture

```
apps/board/src/
  main.ts              entry point: wires board-model to board-dom, creates the Planchette
  board-model.ts        pure: Message, undo stack, actions (createBoardModel)
  core-vocabulary.ts     pure: the fixed 36-word list, grid geometry (row/col)
  letter-board.ts        pure: the fixed 28-key letter/space/backspace layout
  prediction.ts          pure: ranking, slot assignment, lock rule (createPredictionStrip)
  quick-phrases.ts       pure: CRUD over the quick-phrases list
  speech.ts              thin wrapper over `speechSynthesis`, local-service filter
  board-storage.ts       pure: localStorage read/write, schema, versioning, corrupt-data fallback
  board-settings.ts      pure: Board profile fields (predictionSlotCount, voiceURI, speechRate,
                          filterOffensiveWords),
                          export/import together with the skeleton Profile
  messages.ts            every user-facing string, one file (structure.md convention)
  board-dom.ts            the only file that registers targets: renders grid/strip/bar/settings,
                          registers targets, listens to Planchette events
  board-controls.ts       the Controls row (mode selector, camera toggle, Calibrate, Status
                          panel hint); takes the Planchette and the DOM, no other state
  main.ts                 creates Planchette, createBoardModel, createPredictionStrip,
                          wires board-dom and board-controls to both, saves the Profile
```

`apps/board/src/main.ts` (`startBoard`) is the browser entry. `board/index.html` holds
the static markup and is restructured for the viewport layout (see "Viewport layout").
It already exposes `window.planchetteBoard = { planchette }`, the test hook used by the
end-to-end tests and the layout export; it exists and is not created again.

### State ownership

- **Planchette** owns pointer/dwell/scan/calibration/profile/camera state — the Board
  never duplicates it.
- **`BoardModel`** (`board-model.ts`) owns the Message string and an undo stack of
  `{ message, partialWord }` snapshots, one push per Action (Add word/letter/space,
  Backspace, Clear). `undo()` pops the stack and restores `message`; it never pushes
  while undoing, and a second `undo()` immediately after a Clear's undo reverses the
  Action before the Clear, so successive undos walk the whole session back one Action
  at a time (Property 3 generalises Property 2).
- **`PredictionStrip`** (`prediction.ts`) owns the current slot assignment (an array of
  `predictionSlotCount` entries, each `string | null`) and recomputes it whenever the
  model's `message` changes, but only writes a slot whose index is not "locked" at
  that moment (Requirement 4 AC 5).
- **`QuickPhrasesStore`** and **`BoardSettings`** are independent pure stores backed by
  `board-storage.ts`.
- **`board-dom.ts`** is the only stateful, DOM-touching module. It subscribes to the
  three pure stores and to `Planchette` events, and is the only place that knows pixel
  rectangles.

### Why the board model is separable from the DOM

Every correctness property in this design (grid stability, undo, slot locking,
ranking, storage round-trip, no network calls) is phrased over the pure stores, with
no DOM or `Planchette` object in scope. Property tests construct a `BoardModel` /
`PredictionStrip` / `BoardStorage` directly and drive it with generated action
sequences; `board-dom.ts` is covered separately by Playwright end-to-end tests and
axe-core, which exercise real positions and accessibility, not generated input (per
the PBT decision guide: UI rendering and layout are not property-tested).

## Components and Interfaces

### `core-vocabulary.ts`

```typescript
export interface CoreButton {
  readonly id: string;    // kebab-case of the word, e.g. "finished"
  readonly label: string; // the word as shown and spoken
  readonly row: number;   // 0-5
  readonly col: number;   // 0-5
}
/** The 36 Universal Core vocabulary words (CC BY 4.0, CLDS/UNC), in a fixed 6x6 grid.
 *  Alphabetical row-major placement: deterministic, carer-predictable, and stable
 *  because it is computed once from a literal array, never from frequency or state. */
export const CORE_VOCABULARY: readonly CoreButton[];
```

`CORE_VOCABULARY` is a literal, ordered array baked in at build time (alphabetical,
row-major into 6 columns). Nothing in the app ever re-sorts or filters it — this is
what makes Property 1 trivially true for the grid's *data*; the property test instead
exercises the *rendering and lookup* path (`board-dom.ts`'s target registration) to
confirm the DOM agrees with this data under arbitrary action sequences.

### `letter-board.ts`

```typescript
export interface LetterKey {
  readonly id: string;   // 'letter-e', 'letter-t', ... | 'space' | 'backspace'
  readonly label: string; // 'E', 'T', ... | 'Space' | '⌫ Backspace'
  readonly row: number;
  readonly col: number;
}
/** A fixed grid of 6 columns x 5 rows (rows 0-4, cols 0-5). The 26 letters in English
 *  single-letter frequency order (E T A O I N S H R D L C U M W F G Y P B V K J X Q Z)
 *  are placed in plain row-major order from (0,0). Row 4 is therefore Q (4,0), Z (4,1),
 *  then Space (4,2) and Backspace (4,3). Cells (4,4) and (4,5) are empty: no key, no
 *  target is registered for them. */
export const LETTER_BOARD: readonly LetterKey[];
```

Frequency order is a deliberate, documented trade-off (Requirement 3 AC 3): it shortens
average time-to-letter for scanning and head-pointer dwell (frequent letters visited
sooner in the fixed scan/reading order) at the cost of not matching an alphabetic
keyboard expectation. A carer unfamiliar with the order is helped by the visible label
on every key (no hidden mapping) and can switch to Settings → "Spell layout:
alphabetical" is explicitly **not** offered in v1, to keep exactly one fixed layout
(Requirement 3 AC 7); this is noted as an open question in Notes below.

### `board-model.ts`

```typescript
export type BoardAction =
  | { type: 'add-word'; text: string }
  | { type: 'add-letter'; char: string }
  | { type: 'add-space' }
  | { type: 'backspace' }      // word in grid mode, character in spell mode
  | { type: 'clear' }
  | { type: 'replace'; text: string }; // quick phrase

export interface BoardModel {
  readonly message: string;
  /** Letters added in Spell mode since the last word/space/clear/replace; '' when none. */
  readonly partialWord: string;
  dispatch(action: BoardAction, spellMode: boolean): void;
  undo(): void;
  canUndo(): boolean;
  subscribe(fn: (message: string) => void): () => void;
}
export function createBoardModel(initial?: string): BoardModel;
```

`dispatch` is the single mutation point. `partialWord` is
tracked beside the message: `add-letter` appends the lower-cased character to it; `add-word`,
`add-space`, `clear`, and `replace` reset it to `''`; spell-mode `backspace` removes its
last character (and does nothing to it when it is already empty); grid-mode `backspace`
resets it. Every branch pushes `{ message, partialWord }` (the pre-action values) onto a bounded undo stack (cap 50, oldest dropped; a conversational
tool has no need to undo further back, and an unbounded stack would grow for the
whole session) before computing the new message, except when the action would have no
effect (empty message + backspace/clear): those are no-ops and push nothing, matching
Requirement 1 AC 5 and keeping Undo meaningful. Word-append inserts one space exactly
when `message !== '' && !/\s$/.test(message)`. Letter-append (`add-letter`) lower-cases
the character in the model (`char.toLowerCase()`, locale-independent), so every caller
gets the same result and the Letter board's upper-case labels stay display-only. It
inserts one space first exactly when `partialWord === '' && message !== '' &&
!/\s$/.test(message)`: a new spelled word after a word gets a separator ("I want" + H
gives "I want h"), and a spelled word in progress gets none ("I want h" + E gives
"I want he"). `add-space` never inserts an extra space. After a spell-mode Backspace
removes the first letter of a word, the inserted space stays ("I want h" becomes
"I want "), and the next letter adds no second space. `backspace` in grid mode removes the content after the last run of
non-whitespace plus the whitespace before it (i.e., the last "word"); in spell mode it
removes exactly one character.

### `prediction.ts`

```typescript
export interface SlotState {
  readonly index: number;
  readonly word: string | null;
}
export type SlotLock = (index: number) => boolean; // true = do not overwrite this slot now

export interface PredictionStrip {
  readonly slots: readonly SlotState[];
  recompute(message: string, partialWord: string, isLocked: SlotLock): void;
  subscribe(fn: (slots: readonly SlotState[]) => void): () => void;
}
export interface OffensiveWordFilter {
  readonly excluded: ReadonlySet<string>; // normalised single words (Exclusion list)
  readonly enabled: () => boolean;        // current `filterOffensiveWords` setting
}
export function createPredictionStrip(
  slotCount: number,
  wordList: PredictionWordList,
  history: SpokenWordHistory,
  filter: OffensiveWordFilter,
): PredictionStrip;
```

`recompute` is called by `main.ts` on every `message` change. It:
1. Computes the ranked candidate list: `score(word) = normalizedFreq(word) +
   recencyWeight(history, word)`, where `recencyWeight(history, w) = 1 + ln(count)`
   when `w` is in the Spoken-word history with `count >= 1`, else `0` (so count 1 adds
   1, count 3 adds `1 + ln 3`). There is no time decay and no clock input:
   `lastSpokenAt` is used only for history eviction in storage, never for ranking.
   `normalizedFreq(w)` is the bundled `1 / (rank + 1)` value with 0-based rank (the top
   entry is exactly 1); a history word that is not in the bundled list has
   `normalizedFreq` 0, so its score is `recencyWeight` alone. Candidates are the union
   of the bundled list and the history words. Ties on equal score are broken by:
   history words first, then bundled-list order (rank), then lexicographic order for
   history-only words. The `message` argument is not used to filter candidates: a word
   already in the message can still be suggested. It stays in the signature for the
   whole-message rule and future use. Every `CORE_VOCABULARY` word is excluded
   (Requirement 4 AC 3). When `filter.enabled()` is true, it also drops every
   candidate that is in `filter.excluded` and is not a key of `history.entries`
   (Requirement 4 AC 13, 15); when it is false, nothing is dropped for this reason
   (Requirement 4 AC 14). The filter touches only this candidate list: it is never
   consulted by `board-model.ts`, the Letter board, or `speak`, so typing is never
   blocked. When `partialWord` is non-empty, candidates are first
   filtered to words whose lower-cased form starts with the lower-cased `partialWord`,
   then ordered in two groups: words present in the Spoken-word history first, then
   words only in the bundled list, each group by `score` descending (Requirement 4
   AC 10). When `partialWord` is empty, the whole-message rule above applies unchanged
   (Requirement 4 AC 11). `message` is kept in the signature for the whole-message
   rule; the prefix comes only from `partialWord`, never from re-parsing `message`, so
   a core word added with Add word is never mistaken for a partial word.
2. Walks slots `0..slotCount-1` in order. For each index where `isLocked(index)` is
   `false`, assigns the next unused top-ranked candidate (skipping any candidate
   already placed in another slot this recompute) or `null` if candidates run out. For
   each index where `isLocked(index)` is `true`, keeps the existing `SlotState`
   unchanged.

History keys are normalised words (see "Spoken-word normalisation" under `speech.ts`),
so `recompute` looks a candidate up in the history, and checks "is a key of
`history.entries`" for the offensive-word filter, using the normalised form of the
candidate.

`isLocked` is supplied by `board-dom.ts` from three skeleton-event-derived facts, so
the lock rule itself needs no DOM: a slot is locked while it is the current
`pointer-move` target's id (hit-tested against the slot's last-registered rectangle,
same approach the Planchette engine itself uses — the Board does not re-implement hit
testing; it keeps the last `dwell-progress` event's `targetId` if the id is a
prediction slot's), while it is in the current `highlight` event's `targetIds`, or
while a `select`/press has been requested but the matching DOM update has not yet
committed (tracked by a short "pending" flag cleared on the next animation frame).
This reuses exactly the public events input-core already emits; no second input layer
is built.

### `quick-phrases.ts`

```typescript
export interface QuickPhrase { readonly id: string; readonly text: string; }
export interface QuickPhrasesStore {
  readonly phrases: readonly QuickPhrase[];
  /** Refuses (list unchanged) at the 100-phrase cap; never evicts a phrase. */
  add(text: string): { readonly added: true } | { readonly added: false; readonly reason: 'full' };
  update(id: string, text: string): void;
  remove(id: string): void;
  reorder(ids: readonly string[]): void; // only way the order changes
  subscribe(fn: (phrases: readonly QuickPhrase[]) => void): () => void;
}
```

At the 100-phrase cap, `add` returns `{ added: false, reason: 'full' }` and changes
nothing; the Settings editor then shows `messages.quickPhrases.full` ("The quick-phrases
list is full (100). Remove a phrase to add a new one."). A phrase the person wrote is
never removed to make room.

Order only ever changes through `reorder`, called from the Settings screen's edit UI;
Board actions (selecting a quick phrase, speaking, undoing) never call `add`,
`remove`, or `reorder`, which is what Requirement 7 AC 4 and the quick-phrase-order
property rely on.

### `speech.ts`

```typescript
export interface SpeechResult { readonly spoken: boolean; }
export function pickLocalVoice(voices: readonly SpeechSynthesisVoice[], preferredURI: string): SpeechSynthesisVoice | null;
export interface SpeakTimers {
  readonly setTimeout: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}
export function speak(
  text: string,
  options: { voice: SpeechSynthesisVoice | null; rate: number },
  synth: Pick<SpeechSynthesis, 'speak' | 'cancel' | 'getVoices'>,
  timers?: SpeakTimers, // defaults to the global setTimeout/clearTimeout
): Promise<SpeechResult>;
```

Timer injection: `speak` takes an optional fourth argument `timers` holding
`setTimeout` and `clearTimeout`. Production code omits it and gets the globals; tests
pass a fake pair that records the delay and lets the test fire the callback by hand,
so no test waits in real time.

Resolve rule for a non-null voice: `speak` creates one `SpeechSynthesisUtterance` for
`text` with the voice and rate, attaches `end` and `error` listeners, starts the
watchdog timer, and calls `synth.speak` once.
- `end` event: resolve `{ spoken: true }`.
- `error` event, whatever its `error` code (including `canceled` and `interrupted`):
  resolve `{ spoken: false }`.
- Watchdog: if neither event fires within `max(10000, 150 * text.length / rate)`
  milliseconds (`text.length` in characters), call `synth.cancel()` and resolve
  `{ spoken: false }`.

The promise settles exactly once. The first of `end`, `error`, or the watchdog wins,
the watchdog timer is cleared on `end` or `error`, and any later event is ignored (an
`end` that arrives after the watchdog fired does not change the result or the history).

`pickLocalVoice` filters to `voices.filter(v => v.localService === true)` first, then
picks the one matching `preferredURI`, else the first local-service voice, else
`null`. `speak` with a `null` voice never calls `synth.speak` (and starts no timer); it resolves
`{ spoken: false }` so `board-dom.ts` can show the large-text fallback
(Requirement 8 AC 2). On a resolved `{ spoken: true }`, `main.ts` appends each
normalised word of `text` to the Spoken-word history (rule below) — history is updated
by `main.ts`, not inside `speech.ts`, keeping `speech.ts` free of storage concerns.

**Spoken-word normalisation (`normaliseSpokenWord`, applied before a word is added to
or looked up in the history).** Split the spoken message on whitespace (`/\s+/u`, empty
tokens ignored). For each token, in order:
1. lower-case it with `toLowerCase()` (locale-independent, not `toLocaleLowerCase`);
2. strip leading and trailing characters that are not Unicode letters, using
   `token.replace(/^[^\p{L}]+|[^\p{L}\p{M}]+$/gu, '')` (the `u` flag is required for
   `\p{…}`): at the start every non-letter is removed; at the end every character that is
   neither a letter (`\p{L}`) nor a combining mark (`\p{M}`) is removed, so a combining
   mark attached to the last letter is kept. Inner apostrophes and inner hyphens are not
   touched;
3. if the result contains no letter (`!/\p{L}/u.test(result)`), drop the token.

Examples: `"Hello,"` → `hello`; `"don't"` → `don't`; `"José!"` → `josé`;
`"'quoted'"` → `quoted`; `"well-known"` → `well-known`; `"1234"` and an emoji-only token
are dropped. History keys are always normalised words, and every history lookup
(including the prediction ranker's) normalises its argument with the same function. The
Message itself is never altered by this rule; it applies only to the history.

### `board-storage.ts`

Centralises every `localStorage` key behind typed read/write functions that never
throw:

```typescript
export interface StorageResult<T> { readonly value: T; readonly usedDefault: boolean; readonly reason?: string; }
export function readJSON<T>(key: string, schemaVersion: number, fallback: T, migrate?: (raw: unknown, version: number) => T | undefined): StorageResult<T>;
export function writeJSON(key: string, schemaVersion: number, value: unknown): void;
```

`readJSON` never lets a thrown exception escape: `JSON.parse` failure, a value that is
not an object, a missing or non-numeric `version` field, or a `migrate` that returns
`undefined` all fall back to `fallback` with `usedDefault: true` and a `reason`
string. `writeJSON` wraps the write in try/catch too (a full quota is possible) and
silently drops the write rather than throwing, so a storage failure never crashes the
Board mid-conversation (this takes priority, per product.md Principle 1, over
persisting that one change).

### Storage keys, schema, and limits

| Key | Shape | Version | Notes |
|---|---|---|---|
| `planchette-board:message` | `{ version, message: string }` | 1 | saved after every Action so a reload resumes the sentence in progress; capped at 2000 characters, truncated silently if exceeded |
| `planchette-board:history` | `{ version, words: Array<{ word: string; count: number; lastSpokenAt: number }> }` | 1 | capped at 500 distinct words; least-recently-spoken evicted first |
| `planchette-board:quick-phrases` | `{ version, phrases: Array<{ id: string; text: string }> }` | 1 | capped at 100 phrases, each at most 500 characters. The store never evicts: adding the 101st phrase is refused (see `quick-phrases.ts`). Seeded on first run with the built-in starter list defined in `messages.ts`: exactly "Yes", "No", "Thank you", "I need help", "Please wait", "I want to rest", in that order |
| `planchette-board:settings` | `{ version, profile: Partial<Profile>, board: { predictionSlotCount, voiceURI, speechRate, filterOffensiveWords } }` | 1 | `profile` is the skeleton Profile's exportable JSON shape (it holds `mode` and `startCameraOnLoad`, default off), not re-validated here — `importProfile` does that. The Board writes it whenever the Profile changes (mode selector, calibration, Settings, import) |

Cap behaviour: a Quick phrase longer than 500 characters is cut to 500 when it is
entered (`add`/`update`), and `writeQuickPhrases` never drops or cuts anything: if
given more than 100 phrases it writes nothing and returns `false`, so a bug cannot
silently erase a phrase the person wrote. A stored message or history value that is
over its cap when read falls back to that key's default with `usedDefault: true`. A
stored quick-phrases list over its limits does not: `readQuickPhrases` keeps the first
100 entries and cuts each text to 500 characters (reason `'truncated'`, `usedDefault:
false`), and the store does not write the shortened list back until the person edits
it, because falling back to the default would show the starter list and, on the next
write, erase the person's phrases (Property 12 is amended for this key). A list with
malformed entries (an entry that is not `{ id: string, text: string }`) still falls back
to the default. The history's `lastSpokenAt` is used only to choose which entry to evict
at the 500-word cap, not for ranking.

Every key is namespaced `planchette-board:` so it cannot collide with a future App B
key or a host page's own storage. `version` lets a future schema change add a
`migrate` function per key instead of a silent reset. Requirement 10 AC 4's "corrupt
data → documented default, no throw" is implemented once, in `readJSON`, and is the
single thing Property 7 (storage round trip / corrupt-data fallback) exercises.

### Message/undo model detail

The undo stack stores the *message before* each push-worthy action, not a diff, which
keeps `undo()` O(1) and the model trivially correct: "Action then Undo" is literally
"compute new message, then throw it away and restore the saved one." Clear is no
different from Backspace in this scheme — it is simply an action whose "new message"
is always `''` — so Property 2 (Clear then Undo is identity) is a specific case of
Property 3 (any undoable action then Undo is identity), and the design implements only
the general mechanism.

### Prediction model and the slot-update rule

The slot-update rule (Requirement 4 AC 5, Property 4) is enforced structurally:
`recompute` *never writes* to a locked index; it is not a matter of writing and then
reverting. This makes the property a direct consequence of reading the code, and the
property test exists to catch a regression (for example, an off-by-one in which
`isLocked` is checked against the wrong slot index after a reorder).

### Input-mode integration via the skeleton API

`board-dom.ts` is the only caller of `registerTarget` / `updateTarget` /
`unregisterTarget`. Targets and roles:

| Target id(s) | Role | Source |
|---|---|---|
| `core-<word>` × 36 | `default` | `CORE_VOCABULARY` |
| `letter-<a-z>`, `space`, `backspace` × 28 | `default` | `LETTER_BOARD`, shown only while Spell mode is on; unregistered while off, re-registered on re-entry at the same ids and rectangles (Spell mode is a single on/off state, so there is only ever one of the two grids registered at a time — this, not a shared 64-button grid, is how Requirement 2 AC 3's "never hidden" is reconciled with having two fixed grids: each grid is internally fixed, and the switch between them is the one state transition that is allowed to add/remove targets) |
| `prediction-slot-<0..N-1>` | `default` | `PredictionStrip`, registered at a fixed rectangle each; `autoRepeat: false` |
| `quick-phrase-<id>` | `default` | `QuickPhrasesStore`, re-registered (ids may change) only on `reorder`/`add`/`remove`, never on message/prediction changes |
| `speak`, `backspace-action`, `clear`, `spell-toggle` | `default` | Board-level action buttons |
| `camera-toggle` | `default` | Controls row: Start camera / Stop camera (Requirement 13 AC 2) |
| `undo` | `undo` | Requirement 1 AC 7, 5 AC 6 |
| `cancel` | `cancel` | Requirement 5 AC 5 |
| `rest-area` | `rest-area` | Requirement 5 AC 7, a quiet strip below the grid |

Scan order: the skeleton has no scan `order` option, so the Board passes none. Targets
are scanned in reading order (by rectangle: top to bottom, left to right), and the
layout is arranged with that in mind. The skeleton adds its own built-in Cancel item to
every scan cycle (Requirement 5 AC 4), so the Board needs no scan-order rule to put
Cancel last.

`calibration`, `profile`, and camera lifecycle are untouched: `board-dom.ts` calls
`planchette.startCamera()` / `stopCamera()` / `startCalibration()` / `recentre()`
exactly as the skeleton demo does, and renders `tracking-status` with the same
plain-language/alternatives contract (Requirement 5 AC 9, 9 AC 8).

### Input controls (Requirement 13)

`board-controls.ts` follows the skeleton demo page (`skeleton/demo/main.ts`): the same
modes, the same camera rules, the same hint text pattern. It takes the `Planchette`,
the Controls row elements from `board/index.html`, and a small callback to save the
Profile; it holds no other state (the camera-on flag is derived from `tracking-status`
events and the toggle's own presses, as in the demo).

| Control | Kind | Behaviour |
|---|---|---|
| Mode selector (`#mode`, label "Input mode") | plain `<select>`, **not** a target | options: Head + dwell, Head + gesture, Switch scanning, Gesture scanning, Mouse (the five `InputMode` values); `change` calls `setMode`; `mode-change` and calibration end update `select.value` |
| Camera toggle (`camera-toggle`) | plain `<button>` **and** a registered target, role `default` | label "Start camera" while off, "Stop camera" while on; selecting (click, dwell, gesture, scan, mouse) while off calls `startCamera()`, while on calls `stopCamera()`; a `tracking-status` failure sets it back to "Start camera" |
| Calibrate (`#calibrate`) | plain `<button>`, **not** a target | camera off: no call, the message line says calibration uses the camera and Start camera comes first; camera on: `startCalibration()`; step text from `calibration-step` is shown in the message line |
| Status panel | `#camera-status` (the skeleton's tracking indicator, passed as `trackingIndicator`) and `#controls-message` (hint and calibration text) | the message line shows only while the indicator element is empty |

**Which controls are targets (decision).** The skeleton demo registers only its grid,
Cancel, Undo and rest area as targets; its mode selector, camera buttons and Calibrate
are plain controls for a carer. The Board follows that, with one addition: the camera
toggle is also a target. Product principle 3 (the person can always stop) and the
accessibility rule that the camera can be stopped at any time mean a head-pointer or
scanning user must be able to stop the camera without a carer. One toggle target
covers both "start" (useful for a scanning user who wants gesture scanning) and
"stop"; it is a single target because two buttons that swap in and out would move a
target. The mode selector and Calibrate stay plain: mode changes and calibration need
a carer's judgement and an accidental selection of either by dwell would be disruptive
(product principle 1).

**Camera start rule (principle 5).** `startBoard` never calls `startCamera()` on its
own. It calls it once on load only when `planchette.getProfile().startCameraOnLoad`
is true. The setting "Start camera when the page opens" is that existing Profile
field, not a Board-only one: the skeleton already defines it (default `false`), saves
it in the exported Profile, and `importProfile` already treats a missing or non-boolean
value as the default `false` and reports it ("startCameraOnLoad: missing — using
default"). A second Board-only copy would be two sources of truth for one switch and
would break Requirement 11 AC 4 (no duplicate field), so the setting reuses the
Profile field. Its label is `messages.settings.startCameraOnLoad` ("Start camera when
the page opens"). Export and import ride on the Profile part of `BoardExport`
(Property 7 names it explicitly).

**Dwell ring and scan highlight.** `startBoard` calls `createDwellRing(planchette)` and
`createScanHighlight(planchette)` from `@planchette/skeleton/ui`, as the demo does.

**Persistence of the mode.** The mode is the Profile's `mode` field (default
`'head + dwell'`), so it needs no new storage field. Today nothing writes
`planchette-board:settings`, so neither a changed mode nor the 1400 ms dwell default is
remembered. `main.ts` therefore gets `saveProfile()`: it reads `planchette.exportProfile()`
and calls `writeSettings({ profile, board })`. It runs on `mode-change`, when
calibration ends, after a Profile import, and after a Settings change. Once a Profile is
saved, `resolveInitialProfile` returns it unchanged on the next visit (Requirement 11
AC 6), including `dwellTime`, which is then the 1400 ms the Board applied the first
time.

**Tests never start a real camera.** `board-controls` tests use a fake Planchette whose
`startCamera`/`stopCamera` are spies. The end-to-end tests wrap `getUserMedia` to count
and refuse calls, as `skeleton/test/demo.e2e.ts` does, and assert zero calls.

### Viewport layout (Requirement 14)

**Defaults used.** `targetSize` 96 CSS px and `targetSpacing` 16 CSS px are the
skeleton Profile defaults (`skeleton/src/engine/profile.ts`, `defaultProfile`, lines
156-157; allowed range 64-400 and 8-64). The Board overrides only `dwellTime`.
`predictionSlotCount` defaults to 4 (Requirement 11 AC 1). Text is 24 CSS px, the
minimum in accessibility.md. The Board never shrinks a target or gap below these (Req
14 AC 6).

**Equal-width cells and label fit.** Each grid uses `grid-template-columns:
repeat(6, var(--cell-w))` and `grid-auto-rows: var(--target-size)`, so every cell of a
grid is the same size. `--cell-w` is `calc(var(--target-size) * 4 / 3)`, 128 px at the
default. Labels are normal weight (not bold), 24 px, with a 2 px border and 2 px side
padding, so the content width is 128 - 4 - 4 = 120 px. The widest unbreakable string is
"Backspace" (in the Letter board's "⌫ Backspace" key): 113 px at 24 px normal weight,
measured with `measureText` in Chromium with `system-ui` (bold would be 123 px and
would overflow, so bold is dropped). The widest core word, "different", is 86 px. The
Letter board's "⌫ Backspace" label wraps at its space, "⌫" over "Backspace", two lines of
24 px at line-height 1.3 (about 62 px) inside the 96 px cell height. Wrapping happens
only at spaces (`overflow-wrap: normal`, no hyphenation); no word is split. The font is
not bundled (the CSP allows same-origin files, but a font file would add weight for
little gain), so another platform's `system-ui` may be wider. The end-to-end test
therefore asserts `scrollWidth <= clientWidth` and `scrollHeight <= clientHeight` for
every target; if it fails on a platform, raise `--cell-w`.

**Arrangement.** A two-column page, 12 px side padding and 8 px top and bottom
padding, with the DOM in this order (which is also the Tab and reading order):
Message bar, grid, then the right column (prediction strip, action row, camera toggle and
rest area, Controls row, Status panel, notice). CSS grid areas place them. Left column:
Message bar on top, the active grid under it. Right column: everything else.

**Arithmetic at 1366 x 768 (default values).**

Horizontal: 12 + grid width + 16 gap + right column + 12 = 1366.
- Grid width = 6 x 128 + 5 x 16 = 768 + 80 = 848 (both grids use 6 columns).
- Right column = 1366 - 12 - 848 - 16 - 12 = 478.

Vertical, left column (usable height 768 - 8 - 8 = 752):
- Message bar 80 (`height: 80px; box-sizing: border-box`): 24 px text at line-height
  1.3 is 31.2 px a line, two lines are 62.4 px, plus 4 px padding and a 3 px border on
  each side is 76.4 px, so 3.6 px spare. Longer text scrolls inside the bar and shows
  its end.
- Gap 16.
- Core grid = 6 x 96 + 5 x 16 = 576 + 80 = 656.
- Total 80 + 16 + 656 = 752. It fits with no spare height: 8 + 752 + 8 = 768.
- Letter board = 5 x 96 + 4 x 16 = 480 + 64 = 544, so 80 + 16 + 544 = 640, leaving 112
  empty under it. The Message bar and the right column do not move between views.

Vertical, right column (usable 752; widths in brackets):
| Block | Width | Height | y range |
|---|---|---|---|
| Prediction strip, 4 slots in one row: (478 - 3 x 16) / 4 = 107.5 wide each | 478 | 96 | 8-104 |
| gap | | 16 | |
| Action row, 3 columns x 2 rows: (478 - 2 x 16) / 3 = 148.7 wide each; Speak, Backspace, Clear / Undo, Spell, Cancel | 478 | 96 + 16 + 96 = 208 | 120-328 |
| gap | | 16 | |
| Camera toggle (column 1, 148.7) and rest area (columns 2-3, 2 x 148.7 + 16 = 313.3 wide) | 478 | 96 | 344-440 |
| gap | | 16 | |
| Controls row: label, mode selector, Calibrate (ordinary controls, `min-height: 48px`) | 478 | 48 | 456-504 |
| gap | | 16 | |
| Status panel (hint text, or the tracking indicator) | 478 | 112 | 520-632 |
| gap | | 16 | |
| Notice (footer), 24 px, line-height 1.2: about 3 lines = 86 px, up to 3.9 lines fit | 478 | 112 | 648-760 |

Sum = 96 + 208 + 96 + 48 + 112 + 112 = 672, plus 5 gaps x 16 = 80, gives 752. The right
column's last block ends at y = 760 = 768 - 8. Every target is inside the viewport:
the widest right-column x is 1354 <= 1366 and the lowest target bottom is the grid at
y = 104 + 656 = 760 <= 768.

**Target minimums hold.** Cells are 128 x 96 (>= 96 x 96). Prediction slots are 107.5 x 96.
Action buttons and the camera toggle are 148.7 x 96. The rest area is 313.3 x 96. Gaps
between targets are 16 (the profile spacing): between grid cells, between slots, between
action buttons, and between the two rows of blocks in the right column. The gap between
the grid and the right column is 16.

**1920 x 1080.** The same fixed layout is used, centred horizontally in a container of
width 1366 (the 1366 above, including the 12 px side padding) with `margin: 0 auto`.
Content height is 768 <= 1080 and content width is 1366 <= 1920. The spare space is empty; the layout does not scale up in v1 (uniform
scaling is allowed by Requirement 2 AC 3 but is not needed to pass Requirement 14).

**Prediction strip reservation.** `board/index.html` holds a `<div id="prediction-strip">`
placed at the right column's top, with `grid-template-columns: repeat(4, 1fr)` and a
`min-height` of one target row, sized by CSS whether or not it holds slots, so the
space is reserved before the prediction wiring task fills it. The wiring task creates
`predictionSlotCount` slot buttons inside it. Each slot shows its word at 24 px, wraps
inside the slot at 24 px (`overflow-wrap: anywhere`, up to two lines), because the
longest bundled word is 16 characters ("misunderstanding") and a 107.5 px slot is about 99 px
of content. A word is never cut with an ellipsis: a truncated word could be selected
as something the person did not mean (product principle 1). An empty slot is drawn as a
dashed placeholder with no target registered.

**Limits (stated, not hidden).** The guarantee is for the defaults. With
`predictionSlotCount` 5-8 the strip needs two rows (+112 px): the right column then
needs 864 px, which fits 1920 x 1080 (1064 usable) but not 1366 x 768 (752). The page may
then scroll at 1366 x 768; the targets keep their size (Requirement 14 AC 7). A larger
target size or spacing does the same. Settings help text for "Number of suggestions"
says that more than 4 may need scrolling on a small screen.

**Status panel failure state.** The tracking indicator's failure state is a message of
up to about 130 characters, the "alternatives" sentence, and three buttons. That does not
fit in 112 px. While in a failure state, the indicator is positioned over the bottom of the
right column (`position: absolute`, anchored to the Status panel's bottom edge, 478 px
wide, growing upward over the Controls row and the camera/rest row) with a solid
background and a visible border. Every failure means head tracking is not working, so
the temporarily covered targets are not the ones the person was using; the three
buttons ("Try the camera again", "Use switch scanning", "Use the mouse") end the state.
Planchette hit-tests registered rectangles, not the DOM, so mouse and scan input keep
working under the overlay. The camera toggle is covered only in that state, and "Try the
camera again" does what it does.

**Scan order.** The scan visits targets in the skeleton's reading order of their
rectangles. With this layout the prediction strip (top of the right column) and grid
row 0 are close in y, so the visiting order interleaves them by position. This is
checked by the dwell-simulator layout runs in Tasks 31 and 32 and revisited if it reads
badly; the Board does not pass an order.

### Accepted as built

These details were built before this design named them and are accepted:
- Action labels (`messages.actions`): Speak, Backspace, Clear, Undo, Spell, Cancel. Letter
  board keys: Space and "⌫ Backspace" (`messages.letterBoard`).
- The not-a-medical-device notice is in the page footer, not in the Message bar.
- Cancel has no Board handler beyond the skeleton's own `cancel` event; the Board
  registers the target (role `cancel`) and the skeleton cancels the dwell or the scan.
- The rest area is a registered target of role `rest-area` with no selectable content.
  Its earlier `min-height: 140px` is replaced by the size in the layout arithmetic above
  (313.3 x 96), which governs.

### About screen

A panel (`#about`) opened from a button on the Settings screen, an ordinary focusable
control like the rest of Settings (not a `Planchette` target). All text comes from
`messages.ts`. The not-a-medical-device notice is the sentence "The board is not a
medical device and not a replacement for an AAC system assessed by a
speech-language therapist." (the sentence in requirements.md's introduction). The
links are exactly the URLs already in `THIRD_PARTY.md`:
<https://github.com/hermitdave/FrequencyWords>,
<https://www.med.unc.edu/healthsciences/clds/universal-core-vocabulary/>,
<https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words>,
<https://creativecommons.org/licenses/by-sa/4.0/>, and
<https://creativecommons.org/licenses/by/4.0/>. It shows, in this order: the Board version (read from `package.json` at
build time); the not-a-medical-device notice; the Universal Core vocabulary credit
(CLDS, UNC Chapel Hill, CC BY 4.0, links to the source page and the licence); the
Prediction word list credit (hermitdave/FrequencyWords, Hermit Dave, English
OpenSubtitles 2018 via OPUS, CC BY-SA 4.0, the changes made (trimmed, lower-cased,
filtered), links to the repository and the licence); a statement that the trimmed list
is a derivative that stays CC BY-SA 4.0 and that the Board's code is MIT; and the Exclusion list credit (LDNOOBW, English list, copyright
2012-2020 Shutterstock, Inc., CC BY 4.0, the changes made, links to the repository and
the licence) (Requirement 12).

### Settings UI

One screen (`#settings` panel, opened by an ordinary button, not a `Planchette`
target — Settings is a carer tool, reachable by keyboard Tab and screen reader, not
required to be dwell/scan-reachable by the Board's own person-facing input modes,
matching how the skeleton demo treats its own mode switcher and profile box). It
renders:
- every Board profile / skeleton Profile field as a labelled `<input>` or `<select>`
  with its min/max shown in help text (reusing the input-core Profile fields table —
  no new range logic);
- the control labels, all defined in `messages.ts`: "Start camera when the page opens"
  (the checkbox below), "Voice" (the `voiceURI` select),
  "Speech rate" (the range input), "Number of suggestions" (`predictionSlotCount`),
  "Edit quick phrases" (the Quick-phrases editor), and "Filter offensive words from
  suggestions" (the checkbox);
- `voiceURI` as a `<select>` populated from `speechSynthesis.getVoices().filter(v =>
  v.localService)`, with a live "no local voices available" message when the list is
  empty;
- `speechRate` as a `<input type="range">`;
- "Filter offensive words from suggestions" as a labelled checkbox, on by default,
  changeable by the person or a carer, saved at once with the other Board-only
  settings;
- "Start camera when the page opens" as a labelled checkbox bound to the Profile's
  `startCameraOnLoad` (default off), saved with the Profile (see "Input controls");
- an "About" button that opens the About screen;
- Export/Import as a text box plus two buttons, exactly like the skeleton demo's
  profile box (same pattern, so no new UI idiom is introduced), to avoid `blob:`/`data:`
  URLs under the CSP;
- the Quick-phrases editor (add/edit/remove/reorder, with the "list is full" message when
  `add` refuses; drag-and-drop optional, keyboard
  reordering — Move up/Move down buttons — required, since drag-and-drop alone is not
  keyboard-operable).

## Data Models

```typescript
// board-model.ts
interface MessageSnapshot { readonly message: string; }

// prediction.ts
interface PredictionWordList {
  readonly words: ReadonlyMap<string, number>; // word -> 1 / (rank + 1), 0-based rank, top = 1
}
interface SpokenWordHistory {
  readonly entries: ReadonlyMap<string, { count: number; lastSpokenAt: number }>;
}

// board-settings.ts
interface BoardOnlySettings {
  readonly voiceURI: string;   // '' = first local-service voice
  readonly speechRate: number; // 0.5-2.0, default 1.0
  readonly filterOffensiveWords: boolean; // default true; a non-boolean imports as true
}
interface BoardProfileFields {
  readonly predictionSlotCount: number; // 2-8, default 4
}
// Exported/imported together:
interface BoardExport {
  readonly version: 1;
  readonly profile: Partial<Profile>;    // from planchette.exportProfile(), re-parsed
  readonly board: BoardOnlySettings & BoardProfileFields;
}
```

`PredictionWordList` is loaded once at startup from a bundled JSON asset
(`apps/board/data/prediction-word-list.json`, generated by a build script from a
committed copy of the source below) and never refetched — this satisfies Requirement 10 AC 1 (no runtime network
request) while still being a "bundled word-frequency list" per Requirement 4.

### Prediction word list: source and licence

**Source:** the English OpenSubtitles 2018 frequency list of
[hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords)
(`content/2018/en/en_50k.txt`, the 50,000 most frequent words, one `word count` pair per
line). Author: Hermit Dave. The counts come from subtitles in the OpenSubtitles 2018
corpus, distributed through [OPUS](https://opus.nlpl.eu/). Subtitle text is closer to
spoken, conversational English than a web or book corpus, which suits a spoken-message
tool.

**Licence:** the repository README states "MIT License for code. CC-by-sa-4.0 for
content." The word data is therefore CC BY-SA 4.0
(<https://creativecommons.org/licenses/by-sa/4.0/>); the Board's own code stays MIT.
The trimmed list the Board ships is an adaptation of that data and stays CC BY-SA 4.0.
It is stored as its own data file so the share-alike condition attaches to that file
only, with the licence notice next to it (below). The licence is re-verified from the
source repository before bundling (Task 4.1) and the build stops if it is not CC BY-SA.

**Files, all in `apps/board/data/`:**

| File | Purpose |
|---|---|
| `source/en_50k.txt` | committed, unmodified copy of the source file; the build reads this, never the network |
| `prediction-word-list.json` | the trimmed, filtered output (`{ word: normalisedFrequency }`), CC BY-SA 4.0 |
| `prediction-word-list.LICENSE.md` | the CC BY-SA 4.0 notice: source and link, author Hermit Dave, OpenSubtitles 2018 via OPUS, the licence link, a statement that the file was changed (trimmed, lower-cased, filtered, re-ranked), and that the result is shared under CC BY-SA 4.0 |

**Filtering rules, applied in this order by the build script:**
1. lower-case every word;
2. keep only entries that start with a letter, then continue with letters or
   apostrophes, of length 2 or more (`/^[a-z][a-z']+$/`; a one-letter entry is dropped
   because `I` is a core word and `a` adds a slot for no gain; tokenizer fragments
   such as `'s`, `'t`, `'m` are dropped because they start with an apostrophe;
   contractions such as `don't` and `i'm` are kept because people say them);
3. drop every word that equals a `CORE_VOCABULARY` word (Requirement 4 AC 3);
4. keep the first 5,000 remaining entries in source order.

**Size: 5,000 words.** Reasons: memory and file size (about 60 KB as JSON, loaded once
and held as one `Map`), start-up cost with no runtime filtering, and coverage (the top
5,000 subtitle words are everyday conversational vocabulary; coverage of any one
person's speech was not measured). Rank order stays the source order; the normalised
frequency is `1 / (rank + 1)` scaled to [0, 1], so ranks, not the huge raw counts,
drive the score.

`recompute`'s own core-word exclusion stays as a second check in case a future list
revision reintroduces an overlap.

**Content warning.** Subtitle text includes profanity and slurs. The Exclusion list
below, applied at run time under the `filterOffensiveWords` setting, handles this; the
bundled prediction list itself is not edited for it, so turning the filter off shows
the unfiltered list.

### Exclusion list: source and licence

**Source:** the English list (file `en`) of
[LDNOOBW](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words).
**Licence:** Creative Commons Attribution 4.0 International, copyright 2012-2020
Shutterstock, Inc., verified in the repository README and LICENSE for this spec
(<https://creativecommons.org/licenses/by/4.0/>). The build step re-verifies this from
the source repository before bundling (Task 4.3) and stops if it is not CC BY 4.0.

**Files, all in `apps/board/data/`:**

| File | Purpose |
|---|---|
| `source/ldnoobw-en.txt` | committed, unmodified copy of `en`; no download at build or run time |
| `offensive-words.json` | the normalised, single-word output (a JSON array of strings), CC BY 4.0 |
| `offensive-words.LICENSE.md` | the CC BY 4.0 notice: source and link, copyright holder, licence link, and the changes made |

**Build rules, in order:** apply the same normalisation as the prediction list
(lower-case; keep only entries of a-z and apostrophes); drop entries that contain a
space or any other character outside a-z and apostrophe after lower-casing, which
removes every multi-word entry (a multi-word entry can never equal one predicted word,
so it cannot match and is dropped); de-duplicate.

**Matching rule:** whole word, case-insensitive: a predicted candidate is excluded
exactly when its lower-cased form is an element of the set. There is no substring or
stem matching. Because the word list was already normalised to a-z and apostrophes,
the comparison is a plain `Set.has`.

**Scope of the filter:** setting on (the default) removes Exclusion list words from
the bundled-list candidates only. Words the person has spoken (Spoken-word history)
stay eligible whatever the setting. The filter never touches the Message, the Letter
board, the Core grid, Quick phrases, or Speak.

### Core vocabulary list: source and licence

As stated in requirements.md's "Core vocabulary" section: the Universal Core
vocabulary, Center for Literacy and Disability Studies (CLDS), UNC Chapel Hill,
36 words, CC BY 4.0 (page fetched and its licence statement verified for this spec).
The user approved use of this list. `THIRD_PARTY.md` records the title, link, and
licence (the 36-word list is not itself copied there; it is normative content of
`core-vocabulary.ts` and `requirements.md`), and the attribution line required by CC BY
4.0 ("Universal Core vocabulary, Center for Literacy and Disability Studies, licensed
under CC BY 4.0", with links) is shown on the About screen, satisfying attribution
without cluttering the Message bar or grid.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid
executions of a system — essentially, a formal statement about what the system should
do. Properties serve as the bridge between human-readable specifications and
machine-verifiable correctness guarantees.*

Reflection on the prework: several prework-testable criteria collapse into the same
underlying property. 1.1's "message bar always reflects model state" is not separately
listed because it is true by construction of `subscribe` (a rendering contract covered
by example/DOM tests, not a generated-input property distinct from the model's own
correctness). 1.7's undo-reverses-last-action and 2.*'s Clear-then-undo are the same
mechanism at different generality, so only the general form (Property 3) is kept; the
Clear-specific case is kept as a named unit test, not a second property. 4.4's
"history updated only when spoken" and 8.6's "history updated on successful speak" are
the same fact from two requirements and are merged into Property 8. 4.5 and 4.6 (slot
locking and the fill rule) are one property because the fill rule is only meaningful
in terms of which slots are unlocked. 10.1/10.3's "no network" and "local storage
only" are kept as two properties because one is about outbound calls (any action) and
the other is about inbound parsing (any stored bytes) — different generators, no
overlap to merge.

### Property 1: Fixed-grid position stability

For any sequence of Board actions, mode switches, Settings changes, Spell-mode
toggles, and window-resize events, the row, column, and label that `board-dom.ts`
registers for each `CORE_VOCABULARY` target id at the end of the sequence equal the
row, column, and label it registered for that id at the start, and likewise for each
`LETTER_BOARD` target id whenever Spell mode is on both before and after the sequence.

**Validates: Requirements 2.2, 2.3, 2.4, 3.3, 3.7**

### Property 2: Clear then undo is identity

For any Message string `m`, `dispatch({ type: 'clear' })` followed by `undo()`
restores the model's `message` to exactly `m`.

**Validates: Requirements 1.6, 1.7**

### Property 3: Any undoable action then undo is identity

For any Message string `m` (with any Partial word) and any of `add-word`, `add-letter`,
`add-space`, `backspace`, `clear`, `replace` that is not a no-op there (per Requirement 1
AC 5), dispatching that action and then calling `undo()` restores `message` and
`partialWord` to exactly their values before the action. This still holds with the
spelling rule (a space inserted before the first letter of a spelled word): the undo
snapshot is taken before the action, so it restores the message without the inserted
space. Property 2 is the `clear` case and is unaffected, because `clear` never inserts
a separator.

**Validates: Requirements 1.4, 1.5, 1.7, 7.2**

### Property 4: Prediction never changes a locked slot

For any sequence of message changes and any slot index that `isLocked` reports `true`
for at the moment of a `recompute` call, that slot's `word` after the call equals its
`word` before the call.

**Validates: Requirements 4.1, 4.5**

### Property 5: Unlocked slots are filled from the ranked, deduplicated, core-excluding list

For any message, any Partial word (empty or non-empty), word list, and history, every
word assigned to an unlocked slot after `recompute` (a) does not appear in
`CORE_VOCABULARY`, (b) does not repeat in any other slot, and (c) is not outranked by a
candidate placed in a later unlocked slot (slots are filled in non-increasing rank order
among the unlocked ones). With an empty Partial word, rank order is the whole-message
score order; with a non-empty Partial word, rank order is the prefix ordering (words in
the Spoken-word history first, then list-only words, each group by score descending).

**Validates: Requirements 4.3, 4.6, 4.7**

### Property 6: Speaking a word never decreases its future rank

For any word `w` and any two histories `h1`, `h2` where `h2` is `h1` with one more
spoken occurrence of `w` added, `w`'s rank in the candidate list computed from `h2` is
at or above its rank computed from `h1`, all other words held equal.

**Validates: Requirements 4.7**

### Property 7: Settings export/import round trip and clamping

For any valid `BoardExport` value, exporting then importing it returns an equivalent
`BoardExport` (profile part equal after `exportProfile`/`importProfile`'s own
round-trip guarantee, including `profile.startCameraOnLoad` (`true` stays `true`,
`false` stays `false`); `predictionSlotCount` unchanged if already in `[2,8]`,
`speechRate` unchanged if already in `[0.5,2.0]`; `filterOffensiveWords` unchanged).
For any `BoardExport`-shaped JSON whose `profile.startCameraOnLoad` is missing or not
a boolean, importing gives `startCameraOnLoad` `false` and reports the change (this
comes from the skeleton's `importProfile`; the property pins it for the Board).
For any `BoardExport`-shaped JSON with `board.filterOffensiveWords` not a boolean
(imports as `true`), or with `board.predictionSlotCount` or `board.speechRate` outside its range, or of the
wrong type, or missing, importing clamps to range or falls back to default and reports
the change, the same way `importProfile` does for skeleton fields.

**Validates: Requirements 6.5, 6.6, 6.7, 6.9, 11.1, 11.2, 11.3, 11.8**

### Property 8: Spoken-word history updates only on successful speech

For any Message and any sequence of `speak()` calls, the Spoken-word history after the
sequence contains an incremented entry for each word of a message exactly for the
calls whose `SpeechResult.spoken` was `true`, and is unchanged by every call whose
`spoken` was `false` (no local-service voice) or by any `Add word` / `Add letter` /
prediction-slot selection on its own (selecting a predicted word never, by itself,
touches history).

**Validates: Requirements 4.4, 4.9, 8.1, 8.2, 8.6**

### Property 9: Local-service-only voice selection

For any list of available `SpeechSynthesisVoice` objects (including lists with zero,
one, or many `localService === true` entries and any number of `localService ===
false` entries) and any `preferredURI`, `pickLocalVoice` returns either `null` (only
when no entry has `localService === true`) or a voice whose `localService` is `true`;
it never returns a voice whose `localService` is `false`.

**Validates: Requirements 8.1, 8.2, 8.4**

### Property 10: Chosen voice and rate are used on every speak call

For any `BoardOnlySettings` and any Message, every call to the underlying
`SpeechSynthesisUtterance` constructed by `speak()` during that setting has its `voice`
and `rate` equal to the current settings' resolved voice and `speechRate`.

**Validates: Requirements 8.4, 8.5**

### Property 11: Quick-phrase order is stable under non-edit actions

For any sequence of Board actions that does not call `add`, `update`, `remove`, or
`reorder` on the `QuickPhrasesStore`, the order of `phrases` ids after the sequence
equals the order before it.

**Validates: Requirements 7.4**

### Property 12: Corrupt or partial storage never throws and falls back to the documented default

For any byte string stored under a Board local-storage key (including non-JSON text,
valid JSON of the wrong shape, a JSON object with a missing or non-numeric `version`,
and valid JSON exceeding a key's size cap), `readJSON` returns that key's documented
default with `usedDefault: true` and does not throw, and the Board continues to accept
further actions afterward (modelled as: the next `dispatch` call also does not throw).

*Amended (this revision):* the "exceeding a key's size cap" case applies to the
message and history keys. For the quick-phrases key, a list that parses with well-formed
entries but exceeds 100 entries or a text over 500 characters is not replaced by the
default: `readQuickPhrases` keeps the first 100 entries and cuts each text to 500
characters (`usedDefault: false`, no throw). Replacing it with the default would drop
phrases the person wrote and, because the store re-seeds and writes on `usedDefault`,
erase them. All other cases (non-JSON, wrong shape, bad version, malformed entries) still
give the default.

**Validates: Requirements 10.4, 7.6**

### Property 13: No network calls

For any sequence of Board actions (including Speak, Settings import/export, and
prediction recompute), no call is made to `fetch`, `XMLHttpRequest`, `WebSocket`, or
`navigator.sendBeacon` (checked by spying on all four in the test environment and
asserting zero calls after driving the pure stores and the speech/storage modules
through the sequence).

**Validates: Requirements 10.1, 10.3**

### Property 14: Prefix predictions start with the partial word

For any Message, non-empty Partial word, word list, history, and locked-slot subset,
after `recompute` the word in every unlocked slot, and the word in every locked slot
whose word already starts with the Partial word, starts with the Partial word (compared
case-insensitively). A locked slot keeps its word even if that word no longer matches
the Partial word (Property 4 takes precedence). Among unlocked slots, every history word
that starts with the Partial word and fits is placed ahead of every word found only in
the bundled list.

**Validates: Requirements 4.10, 4.12**

### Property 15: Offensive-word filter

For any Message, Partial word, word list, Spoken-word history, Exclusion list, and
locked-slot subset: with `filterOffensiveWords` on, no word that is in the Exclusion
list and not in the history appears in any unlocked slot after `recompute`, and appears
in no slot at all when the filter setting and the Exclusion list are unchanged since
that slot was filled. A word in a locked slot (for example under the pointer) is never
swapped out when the filter is turned on; it is replaced on the first `recompute` after
the lock is released. With the filter off, the candidate ranking equals the ranking
computed with an empty Exclusion list.

**Validates: Requirements 4.13, 4.14, 4.15, 4.17**

### Property 16: Spelling after a word

For any core word `w0` (any `CORE_VOCABULARY` label) and any non-empty sequence `s` of
letters (a-z, A-Z), dispatching `add-word` with `w0` on an empty Message and then
`add-letter` for each character of `s` in order gives the Message `w0 + ' ' +
s.toLowerCase()` and the Partial word `s.toLowerCase()`. (The first letter finds a
non-empty Message with no trailing whitespace and an empty Partial word, so it inserts
one space; every later letter finds a non-empty Partial word, so it inserts none.)

**Validates: Requirements 3.4**

## Error Handling

- **Corrupt or missing localStorage data**: handled uniformly by `readJSON` (see
  Storage keys above); the Board always starts from a valid, documented default and
  never throws during startup.
- **`localStorage` write failure (quota, private browsing)**: `writeJSON` catches and
  drops the write; the in-memory store stays authoritative for the rest of the
  session, and the person is not interrupted mid-conversation. A one-line, non-blocking
  notice ("Settings could not be saved on this device") is shown via the same `say`-style
  status area the skeleton demo uses, not a blocking dialog.
- **Quick-phrases list full**: `add` refuses the 101st phrase and leaves the list
  unchanged; the Settings editor shows `messages.quickPhrases.full`. No phrase is
  removed to make room.
- **No local-service speech voice**: `speak()` resolves `{ spoken: false }`;
  `board-dom.ts` shows the Message at large size (reusing the Message bar's own text,
  scaled up, not a second text element) and the message "Speech output is unavailable
  on this device." (from `messages.ts`), per Requirement 8 AC 2. The same
  `{ spoken: false }` result, and the same message, also covers a speech `error` and a
  watchdog timeout. This is re-checked on every Speak press
  (voice lists can change if the OS adds a voice package), not cached as a permanent
  "no speech" mode.
- **Camera failures (permission denied, load failure, no-face timeout)**: delegated
  entirely to input-core's existing handling and `tracking-status` event; `board-dom.ts`
  renders the message/alternatives it is given, exactly like the skeleton demo, and
  never introduces a second failure path.
- **Imported settings JSON malformed or out of range**: delegated to
  `importProfile` for the skeleton Profile part (already specified and tested in
  input-core) and to the same clamp-or-default-and-report pattern, implemented in
  `board-settings.ts`, for the Board-only part (Property 7).
- **Prediction list shorter than `predictionSlotCount`**: unlocked slots with no
  remaining candidate are set to `null` and rendered as present-but-unselectable
  (registered with no target, or registered and immediately skipped by scan order) so
  the strip's slot *count* and *positions* still never change (Requirement 2/4's
  position-stability guarantee extends to the Prediction strip's slots themselves,
  which are structural, not content).

## Testing Strategy

**Unit tests** (Vitest, `apps/board/test/*.test.ts`): `board-model.ts` action
semantics and no-op cases; `core-vocabulary.ts` / `letter-board.ts` literal-table
shape (36 entries, 6×6; 28 entries, frequency order matches the documented table);
`prediction.ts` ranking formula edge cases (empty history, single-candidate list,
`predictionSlotCount` at its min 2 and max 8); `speech.ts` with a fake
`SpeechSynthesis`; `board-storage.ts` default values for a missing key; the Settings
export/import UI's keyboard tab order (a short, fixed sequence, example-based);
axe-core scan of the rendered grid, Letter board, and Settings screen (as the skeleton
demo does in `ui.e2e.ts`), including both the core-grid view and the Spell-mode view.

**Property tests** (Vitest + **fast-check**, `apps/board/test/*.props.test.ts`), each
tagged `Feature: board, Property N: <text>`, minimum 100 runs:
- Property 1 generates random interleavings of `BoardAction`s, Spell-mode toggles,
  settings changes, and resize events, replaying them against `board-dom.ts`'s target
  registry (a lightweight fake `Planchette` host that records `registerTarget` /
  `updateTarget` calls, not a real DOM) to avoid flaking on real layout/CSS.
- Properties 2–6, 8, 11, 14, 15, 16 drive `board-model.ts` / `prediction.ts` / `quick-phrases.ts`
  directly with `fast-check` arbitraries for messages (unicode strings including
  leading/trailing/internal whitespace), word lists, and histories.
- Property 7 generates arbitrary `BoardExport`-shaped objects, including out-of-range
  and wrong-typed `board` fields, run through export then import.
- Property 9–10 generate arbitrary voice lists (`localService` boolean, random
  `voiceURI`) and settings.
- Property 12 generates arbitrary strings (valid JSON of the wrong shape, truncated
  JSON, non-JSON text) as the stored value for each key.
- Property 13 spies on `fetch`/`XMLHttpRequest`/`WebSocket`/`sendBeacon` globally for
  the duration of a generated action sequence run through the pure stores plus
  `speech.ts` and `board-storage.ts` (never a real network stack, so this is fast and
  needs no network sandboxing).

**Viewport tests** (Playwright, `apps/board/test/board-viewport.e2e.ts`): at 1366 x 768
and 1920 x 1080, in mouse mode, in the Core view and in Spell mode, the document does
not scroll (`scrollHeight <= innerHeight`, `scrollWidth <= innerWidth`), the Message
bar, active grid, prediction strip, action row, Controls row, Status panel, rest area
and notice are inside the viewport, every target returned by
`window.planchetteBoard.planchette.getTargets()` lies fully inside the viewport, and no
target's label overflows its element. Playwright runs these from a new `board` project
in `playwright.config.ts` (project-level `testDir: 'apps/board/test'`), so the skeleton
specs and their config are unchanged. The config's top-level `testDir` stays
`skeleton/test`.

**End-to-end tests** (Playwright, `apps/board/test/*.e2e.ts`, pattern copied from
`skeleton/test/demo.e2e.ts` / `ui.e2e.ts`): drive the Board with mouse clicks and
keyboard only (Tab/Enter for scanning via the switch binding, Space as the default
switch). The camera is never started in any Board e2e test — every head-pointer- or
gesture-mode assertion needed for the Board is already covered by input-core's own
tests against the real engine via `feedSamples`; the Board's e2e suite only needs to
confirm wiring (mouse and switch-scan selection reach the Message bar, Undo, Cancel,
Speak), which needs no camera path at all. axe-core checks run against the built page
(core-grid view and Spell-mode view), matching `ui.e2e.ts`'s pattern.

**Layout validation with the dwell simulator**: the dwell-sim-mcp server is the
acceptance gate for the fixed-grid layout's usability under head-pointer dwell before
calling this spec done; see "Layout validation" below.

## Layout validation (dwell-sim-mcp)

### Why this is part of the design, not a follow-up

The Board's whole premise (product.md Principle 1: never select something the person
did not mean) depends on the grid's geometry — target size, spacing, grouping, and the
default dwell time — being good enough for a person with head tremor or who reads
labels while pointing. The skeleton demo's own measured numbers (see below) show the
default profile is not automatically safe for every layout; the Board must be checked,
not assumed, with the same tool used for the skeleton demo.

### Configuring the MCP server

Add to `.kiro/settings/mcp.json` (workspace-level, per
[kiro.dev's MCP configuration reference](https://kiro.dev/docs/mcp/configuration/),
checked for this spec):

```json
{
  "mcpServers": {
    "dwell-sim": {
      "command": "node",
      "args": ["tools/dwell-sim-mcp/dist/server.js"],
      "disabled": false
    }
  }
}
```

**Absolute-path problem and its handling.** The dwell-sim-mcp README's example uses an
absolute path because the client's working directory is not guaranteed to be the
repository root. `.kiro/settings/mcp.json` is itself a workspace file that is natural
to commit, but a hard-coded absolute path (`/Users/<name>/...`) is machine-specific and
would break for every other clone. Decision: the committed `.kiro/settings/mcp.json` uses the
**relative** path shown above (`tools/dwell-sim-mcp/dist/server.js`) and never an
absolute path. That Kiro resolves a relative path against the workspace root is an
assumption until checked: Task 30.1 verifies it first (enable the server in Kiro and
list its tools, or read the Kiro MCP docs and run a check). If it does not resolve,
nothing machine-specific is committed. Instead the task documents a per-user,
uncommitted config (`~/.kiro/settings/mcp.json` with the user's own absolute path) in
the dwell-sim-mcp README, removes the relative entry from the workspace file, and
**stops and tells the user** before continuing.

### Exporting the Board's layout

Following dwell-sim-mcp Task 20's pattern (`tools/dwell-sim-mcp/scripts/export-demo-layout.ts`),
a new script `tools/dwell-sim-mcp/scripts/export-board-layout.ts` serves the built
`dist/board/index.html` with `vite preview`, opens it with Playwright at 1920×1080 and
1366×768, and exports two layouts per view:

- **Core-grid view** (`board-layout-core-<size>.json`): the default view, Core-vocabulary
  grid + Message bar + action row (Speak/Backspace/Clear/Undo/Cancel/Spell-toggle) +
  Prediction strip + rest area, read from `planchette.getTargets()` exactly as the demo
  export does (`window.planchetteBoard = { planchette }` is the Board's equivalent test
  hook, following the same `planchetteDemo` pattern).
- **Spell view** (`board-layout-spell-<size>.json`): the same page after the Spell-mode
  toggle is pressed once (the Playwright script presses it, waits for the Letter-board
  targets to register, then reads `getTargets()`), since Spell mode swaps the
  registered target set (see Input-mode integration above).

Four files total: `board-layout-core-1920x1080.json`, `board-layout-core-1366x768.json`,
`board-layout-spell-1920x1080.json`, `board-layout-spell-1366x768.json`, written next to
the existing demo-layout files in `tools/dwell-sim-mcp/`.

### Running the six presets

`tools/dwell-sim-mcp/scripts/run-demo-presets.ts` is generalised (not duplicated) to
accept a list of named layouts instead of the two hard-coded demo files — a new
script `run-board-presets.ts` imports `runDemoPresets` from `run-demo-presets.ts` and
passes the four Board layouts in, plus a `task` that selects one target per intended
selection across the Core-vocabulary grid's 36 targets (`{ eachTarget: 2 }`, to keep
the run small while covering every button at least twice) for the core-grid layouts,
and across the Letter board's 28 targets for the spell layouts. All six presets
(`steady`, `slow`, `head-tremor`, `strong-head-tremor`, `small-range`,
`reads-while-pointing`) run on each of the four layouts, seed 1, default profile,
appended to `docs/kiro-journal.md` in the same one-entry-per-preset format
`formatPresetEntry` already produces.

### The acceptance target for `reads-while-pointing`

**Target: `reads-while-pointing`'s accidental rate on every Board layout (core-grid and
spell, both screen sizes) is at or below 10 accidental selections per 100 intended
selections, at the Board's *chosen* default dwell time (see below), not necessarily at
input-core's global default of 1000 ms.**

**Reasoning.** The demo page's own measured `reads-while-pointing` rate (25.4 per 100 at
1920×1080, 21.7 at 1366×768, recorded in `docs/kiro-journal.md`, 23 Nov 2026) comes from
reading pauses of 300–900 ms landing on a *default* 1000 ms dwell time with *no*
deliberate spacing or rest areas between groups (METHODOLOGY.md §2.7, §Chosen values),
so a pause that is almost as long as the dwell time itself frequently finishes a
selection by accident while the person is only reading the next label, not aiming at
the target their pause happens to land on. A communication board is read far more
than the demo's nine Halloween icons (every button's *label* is the point, not a
glanceable icon), so this failure mode is the Board's single biggest accidental-selection
risk and the one the simulator is best suited to catch before a real person does.
10 per 100 (down from 21.7–25.4) is chosen, not 0, because:
- Zero is not achievable with dwell selection and any reading at all — some reading
  pause will always be long enough, at some probability, to reach any finite dwell
  time; the target has to trade off against time-to-select, not eliminate the risk.
- 10 per 100 means roughly 1 in 10 reading-triggered pauses near a button turns into an
  accidental selection, which is a documentable, demonstrable improvement (more than
  2× better than the demo's 1366×768 figure, and more than 2.5× better than its
  1920×1080 figure) achievable by the levers below without materially hurting
  `slow`'s time-to-select (see trade-off below) — it is a reachable target for this
  codebase, not an arbitrary round number.
- It is stated as a number (not "noticeably fewer") so Task 31 below is a pass/fail
  gate, per this workflow's requirement that acceptance criteria be measurable.

**Design levers used, and why each acts on reading-pause accidents specifically (never
by changing the simulator):**

1. **Raise the Board's default dwell time to 1400 ms** (a `Board profile` default
   applied via `setProfile` only when no saved or imported profile exists, within
   input-core's existing 400–3000 ms range — no new field). The rule lives in
   `board-settings.ts` as `resolveInitialProfile(saved)`: if `planchette-board:settings`
   holds a profile (saved by the person, or written by an import), return it unchanged,
   including its `dwellTime` whatever the value (a saved 1000 stays 1000); only when
   `readJSON` reports `usedDefault: true` for that key does it return `{ dwellTime: 1400 }`
   (Requirement 11 AC 5, 6). A person's or carer's chosen dwell time is never overwritten. A reading pause of 300–900 ms is now 500–1100 ms short of
   completing a selection on its own, instead of 100–700 ms short at 1000 ms; the
   `compare` run (Task 32) must show the accidental rate drop as a direct result of
   this one change before any other lever is added, isolating its effect. Trade-off:
   `compare`'s own `slow`-preset time-to-select metric is expected to rise by roughly
   the same 400 ms per *intentional* selection (a slower, deliberate dwell costs every
   selection equally, not just the accidental ones) — acceptable because `slow`'s risk
   is time, not safety, and product.md Principle 1 (never select something not meant)
   ranks above speed.
2. **Group related buttons with a visually and spatially distinct gap (at least double
   the profile's target spacing) between groups**, and place the rest area between the
   Core-vocabulary grid and the action row/Prediction strip rather than off in a
   corner. This acts on reading-pause accidents because the simulator's reading-pause
   model stops the simulated user *on a target the aim path crosses while moving
   towards another target*; wider gaps between unrelated groups reduce how often a
   path between two far-apart intended targets crosses a third, unrelated target at
   all, and a rest area on the path gives the pause somewhere to land with no target
   under it, costing nothing. This does not help a pause that happens to land on a
   target adjacent to the one the person is reading *en route to that exact target*
   (unavoidable: the model samples a stop inside any crossed target, including the
   next one over), but it reduces how many *extra, unrelated* targets are crossed
   reading the grid left to right.
3. **Do not enlarge target size beyond the profile default (96 px) for this fix.**
   Larger targets make `aim-outside-target` misses rarer but make a reading pause
   *more* likely to land inside some target (more of the screen is "inside a target"),
   which would work against this specific failure mode; target size is left at the
   accessibility-mandated minimum and spacing (lever 2) is the lever used instead.

**Levers considered and rejected:** shortening the grace time or disabling auto-repeat
were considered and rejected — grace time is unrelated to reading pauses (it affects
gaps caused by brief tracking loss, not deliberate stops), and the Board registers no
auto-repeat targets at all, so that lever does not apply here.

### Comparing layout changes

Every subsequent layout change (adding a Quick phrase, resizing the grid, changing
`predictionSlotCount`) that could plausibly move targets closer together or change
grouping is validated with `compare` (not a fresh `simulate` reading) against the
last-recorded layout, same seed, same task, so the result is a paired before/after
delta rather than two noisy independent runs (per `compare`'s own design intent in
dwell-sim-mcp). The result (verdict per metric, and the `pairs` time-to-select deltas)
is appended to `docs/kiro-journal.md`.

### Counterexample policy

If any `simulate` or `compare` run surfaces an accidental selection whose cause is not
already understood by this design (anything other than the expected `reading-pause`
cause at a rate below the target), the exact input (preset, layout file, seed, task)
is pinned as a fixed regression case in `apps/board/test/layout-regressions.test.ts`
(a thin wrapper that re-runs that one `simulate` call and asserts the previously-bad
metric now passes) and logged in `docs/kiro-journal.md`, per tech.md's counterexample
policy.

## Notes / open questions for the user

- **Letter-board layout choice is fixed to frequency order, no alphabetical option in
  v1.** If user testing later shows carers strongly prefer alphabetical for typing
  speed, a second fixed layout could be added as a Settings choice — but that would
  need its own "fixed for the session" rule (changing it mid-message would violate
  Requirement 3 AC 7), so it is deliberately left out of this spec rather than
  designed partially.
- **`reads-while-pointing` 10-per-100 target is a proposal**, not a figure from a
  cited human-factors source (unlike the simulator's own movement-model figures, which
  are cited in METHODOLOGY.md) — it is this design's own choice, justified above. The
  user may want a stricter or looser number once the Task 31 measurement is in hand.
