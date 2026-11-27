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
  board-scale.ts         pure: the rendered cell size for a viewport (`renderedCellSize`)
  messages.ts            every user-facing string, one file (structure.md convention)
  board-dom.ts            the only file that registers targets: renders grid/strip/bar/settings,
                          registers targets, listens to Planchette events
  board-settings-dom.ts   the Settings dialog: fields, Tab wrap, Quick-phrases editor, About
  settings-gate.ts        ignores a `select` stamped at or before the dialog's last close
  board-controls.ts       the input controls (mode selector, camera toggle, Calibrate in the
                          Settings dialog, Settings button, Status
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
  | { type: 'complete-word'; text: string } // predicted word replaces the partial word
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
`complete-word`, `add-space`, `clear`, and `replace` reset it to `''`; spell-mode `backspace` removes its
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
"I want he"). `add-space` never inserts an extra space.

`complete-word` (Requirement 4 AC 18) is what a Prediction-strip slot selection
dispatches. *Provenance: proposed by Kiro, accepted by the user on 27 Nov 2026.* (Picking
a prediction replaces the partial word instead of appending after it.) A Core-grid selection stays `add-word`. Empty `text` is a no-op and pushes
nothing, as for `add-word`. Otherwise: when `partialWord === ''` it behaves exactly like
`add-word`. When `partialWord !== ''`, it removes the trailing `partialWord` from the
message (`message.slice(0, message.length - partialWord.length)`), then appends `text`
with the `add-word` spacing rule applied to the remaining message (one space first only
when the remainder is non-empty and does not end in whitespace), and sets `partialWord`
to `''`. It pushes one snapshot, so Undo restores the exact previous message and
partial word ("he" comes back). The remainder normally ends in the space that
`add-letter` inserted before the first letter, so "I want he" + `help` gives
"I want help", and "he" + `hello` gives "hello".

Invariant (checked against `board-model.ts`): whenever `partialWord !== ''`, `message`
ends with `partialWord`. `add-letter` appends the same lower-cased string to both;
spell-mode `backspace` drops the last code point from both; `add-word`, `add-space`,
`clear`, `replace`, grid-mode `backspace` reset `partialWord` to `''`; `undo` restores a
snapshot taken when the invariant held; the initial `partialWord` is `''`. So the
removal above is always well defined, and no fallback rule is needed. After a spell-mode Backspace
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
1. Computes the ranked candidate list. *Provenance: the ranking rule below is a user
   decision* (score `normalizedFreq + 1 + ln(count)`, no time decay, the tie-break order,
   and `message` unused for filtering). `score(word) = normalizedFreq(word) +
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
   unchanged. *Provenance: proposed by Kiro, accepted by the user on 27 Nov 2026* (a
   locked slot keeps its word even when it no longer starts with the Partial word, and
   even when the offensive-word filter has since been turned on; Properties 14 and 15
   state the same precedence).

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

Resolve rule for a non-null voice (*provenance: proposed by Kiro, accepted by the user on
27 Nov 2026*; the `end` / `error` / watchdog rule and the watchdog formula): `speak` creates one `SpeechSynthesisUtterance` for
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
or looked up in the history).** *Provenance: proposed by Kiro, accepted by the user on
27 Nov 2026.* Split the spoken message on whitespace (`/\s+/u`, empty
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
| `planchette-board:quick-phrases` | `{ version, phrases: Array<{ id: string; text: string }> }` | 1 | capped at 100 phrases, each at most 500 characters. The store never evicts: adding the 101st phrase is refused (see `quick-phrases.ts`). Seeded on first run with the built-in starter list defined in `messages.ts`: exactly "Yes", "No", "Thank you", "I need help", "Please wait", "I want to rest", in that order (the six starter phrases: proposed by Kiro, accepted by the user on 27 Nov 2026) |
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
| `letter-<a-z>`, `space`, `backspace` × 28 | `default` | `LETTER_BOARD`, registered only in the Spell view; unregistered in the other views, re-registered on re-entry at the same ids and rectangles |
| `quick-phrase-<id>` × up to 10 | `default` | the current page of `QuickPhrasesStore.phrases`, registered only in the Phrases view: list index `i` on the page at row `floor(i / 2)`, column `i % 2`, each cell 416 × 96 at the defaults. Unused cells are dashed placeholders with no target |
| `phrases-prev`, `phrases-next` | `default` | Phrases view only, fixed at row 5, columns 0 and 1 (416 × 96 each). Registered only when that page exists; otherwise a dashed `aria-disabled` placeholder at the same place with no target |
| `phrases-toggle` | `default` | the Camera row, middle column (148.7 × 96), label `messages.actions.phrases` ("Phrases"), `aria-pressed` true only in the Phrases view |
| `prediction-slot-<0..N-1>` | `default` | `PredictionStrip`, registered at a fixed rectangle each; `autoRepeat: false`. A selection dispatches `complete-word` with the slot's word, in Spell mode and in the Core view alike (with no Partial word it equals `add-word`); both `board-dom.ts` and `BoardApp.selectPrediction` in `main.ts` use it |
| `speak`, `backspace-action`, `clear`, `spell-toggle` | `default` | Board-level action buttons; `spell-toggle` has `aria-pressed` true only in the Spell view |
| `camera-toggle` | `default` | Camera row, left column (148.7 × 96): Start camera / Stop camera (Requirement 13 AC 2) |
| `undo` | `undo` | Requirement 1 AC 7, 5 AC 6 |
| `cancel` | `cancel` | Requirement 5 AC 5 |
| `rest-area` | `rest-area` | Requirement 5 AC 7, Camera row, right column (148.7 × 96) |

**Three views, one registered at a time.** *(The Phrases view, its toggle in the Camera row
and the three-way Camera-row split: proposed by Kiro, accepted by the user on 27 Nov 2026.)*
The view is `'core' | 'spell' | 'phrases'`, held in `board-dom.ts` (default `'core'`). Each toggle goes to its own view, or back to `'core'` when already in it: `spell-toggle` takes core or phrases to spell, and spell to core; `phrases-toggle` takes core or spell to phrases, and phrases to core. This is a deliberately simple rule ("toggle back goes to Core, never to where you came from") so a person can always predict where the next press leads, and so there is no hidden history to test. Only the shown view's grid targets are registered, so Requirement 2 AC 3's "never hidden" is reconciled with three fixed grids the same way as before: each grid is fixed in itself, and switching view is the one transition allowed to add and remove grid targets. `spellMode` (passed to `dispatch`) is true only in the Spell view. Entering the Phrases view shows page 0. The Prediction strip, the action row, and the Camera row are registered in every view; the Message bar is display-only and never a target. Phrase targets are re-registered only on a store change, a page change, or a view change; never on a Message, prediction, or speech change (Requirement 7 AC 12).

**Paging.** A page holds 10 phrases (`PHRASES_PER_PAGE = 10`), whatever the list length, so the cell of list index `n` is always page `floor(n / 10)`, index `n % 10` on it. The page count is `max(1, ceil(count / 10))`. `phrases-prev` is registered when `page > 0`, `phrases-next` when `page < pageCount - 1`. Entering the view sets `page = 0`; a store edit that leaves `page >= pageCount` sets `page = pageCount - 1`. Previous and Next live on row 5 on every page (chosen over "12 per page, nav only when needed", which would move row 5 between a phrase row and a nav row as the list grew past 12). The page position is announced to screen readers by a visually hidden live region ("Page 2 of 3"), not drawn, because all of row 5 is page controls.

**Phrase cell text.** A cell is 416 × 96 with a 2 px border and 6 px side padding, so the text box is 400 px wide (phrase cells use 6 px side padding so the outline band (border + 5 px) clears the text; user decision, 27 Nov 2026); 24 px text at line-height 1.3 is 31.2 px a line, and the 84 px of height inside the border and 4 px top and bottom padding holds two lines (62.4 px) but not three (93.6 px). Measured in Chromium with `system-ui` (ordinary English, words wrapped at spaces), two lines hold about 70 characters (about 36 per line; 22-px-wide capitals like "W" would fit about 18 per line, so all-capitals text fits fewer). The cell uses `display: -webkit-box; -webkit-line-clamp: 2; overflow: hidden`, so a longer phrase shows its first two lines ending with an ellipsis. This hides words from view, so: the button's text content is the full phrase (so its accessible name is the full phrase, and a screen reader reads all of it), selecting it replaces the Message with the full phrase, and the Message bar then shows the whole text (scrolling inside the bar if long) before the person decides to Speak. Selecting is not speaking, so nothing is spoken unseen. The Settings editor shows full text. A phrase over about 70 characters is therefore shown abbreviated but never altered or lost.

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
| Mode selector (`#mode`, label "Input mode") | plain `<select>`, **not** a target, in the Controls row | options: Head + dwell, Head + gesture, Switch scanning, Gesture scanning, Mouse (the five `InputMode` values); `change` calls `setMode`; `mode-change` and calibration end update `select.value` |
| Camera toggle (`camera-toggle`) | plain `<button>` **and** a registered target, role `default`, in the Camera row | label "Start camera" while off, "Stop camera" while on; selecting (click, dwell, gesture, scan, mouse) while off calls `startCamera()`, while on calls `stopCamera()`; a `tracking-status` failure sets it back to "Start camera" |
| Settings button (`#settings-button`) | plain `<button>`, **not** a target, in the Controls row | `showModal()` on the Settings dialog; see "Settings UI" |
| Calibrate (`#calibrate`) | plain `<button>`, **not** a target, **inside the Settings dialog** (moved from the Controls row, which cannot hold it; see "Viewport layout") | camera off: no call, the dialog's message line says calibration uses the camera and Start camera comes first, and the dialog stays open; camera on: the dialog closes, focus returns to the Settings button, and `startCalibration()` is called; step text from `calibration-step` is shown in the page's `#controls-message` line (the Status panel) |
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

**Camera start rule (principle 5).** *(Start camera when the page opens as the Profile's
`startCameraOnLoad`, and saving the Profile: proposed by Kiro, accepted by the user on
27 Nov 2026.)* `startBoard` never calls `startCamera()` on its
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

**First-run hint (Requirement 13 AC 10 to 13).** With no saved Profile the mode is
head + dwell and the camera is off, so nothing can select until the person or a carer
picks a mode or presses Start camera. The Controls module shows one short hint for that
case.
- *When it is on.* `createBoardApp` exposes `firstRun`, which is `usedDefault` from the
  `readSettings` result (true when `planchette-board:settings` is missing, unreadable or
  of the wrong shape; false whenever a Profile was saved, imported or written by a mode
  change or calibration). `startBoard` passes it to `mountBoardControls({ firstRun })`
  (default `false`, so existing tests and callers are unchanged). The controls module keeps an
  in-memory `firstRunActive`, starting at `firstRun`.
- *When it ends.* `firstRunActive` becomes false on the first `select` event of any target
  (whether or not the Board acts on it) or the first time the camera is marked on
  (`setCameraOn(true)`, which the toggle, the load-time start and a `tracking-status` of
  found, lost or low confidence all go through), whichever comes first. It is never set
  back to true in the same page.
- *Which line shows.* The hint goes in the existing `#controls-message` line in the Status
  panel (112 px high, 478 wide), so there is no new element and no layout shift. The
  line already holds exactly one message at a time. Priority, highest first: (1) the
  tracking indicator, which hides the line while it has content (unchanged); (2) a
  transient `say(...)` such as a calibration step or "Camera stopped." (unchanged; none
  of them can happen before the camera has started, which ends the hint); (3) the first-run
  hint while `firstRunActive`; (4) the head-modes-need-the-camera hint when the mode needs
  the camera and the camera is off; (5) the privacy hint. `showHint()` is where (3) to
  (5) are chosen, so while `firstRunActive` the first-run hint replaces (4) and (5), and
  two hints are never shown together.
- *Fit.* "Choose an input mode, or press Start camera" is 43 characters. At 24 px
  system-ui (about 12.4 px a character on average) the line holds about 38 characters in
  the 478 px column, so it wraps to two lines, three at the worst: at most `3 * 31.2 = 93.6`
  px, inside the 112 px panel. The existing needs-the-camera hint is longer (about 125
  characters, four lines, 124.8 px) and already scrolls inside the panel; the first-run
  hint is shorter, so it fits without scrolling.
- *After a reload.* The hint reflects "no saved Profile", not "dismissed": nothing is
  stored for it. Saves happen on a mode change, when calibration ends, after an import and
  after a Settings change. So a person who only presses Start camera (no mode change, no
  save) sees the hint again on the next load. A person who changed the mode in the
  selector has a saved Profile, so the next load shows no hint. Within the same page, a mode
  change does not end the hint; the first select or camera start does.
- *Camera.* Showing, keeping or ending the hint never calls `startCamera`. The camera
  still starts only on a press of the toggle (or, on load, when the Profile's
  `startCameraOnLoad` is on, which needs a saved Profile and so no hint).
- *Text.* `messages.controls.firstRunHint` is added to `messages.ts` (it does not exist
  yet) with exactly "Choose an input mode, or press Start camera".
- *No layout shift.* The message line is already in the Status panel's 112 px box and has
  `max-height: 112px; overflow-y: auto`, so a hint of any length changes no other block.
  The e2e test compares every region's rectangle with and without the hint.

**Dwell outline and scan highlight.** `startBoard` calls `createDwellRing(planchette, {
shape: 'outline' })` and `createScanHighlight(planchette)` from `@planchette/skeleton/ui`.
The skeleton demo calls `createDwellRing(planchette)` and keeps its ring ("Dwell progress
outline" below; *user decision, 27 Nov 2026*).

**Persistence of the mode.** *(Saving the Profile through `saveProfile()`: proposed by
Kiro, accepted by the user on 27 Nov 2026.)* The mode is the Profile's `mode` field (default
`'head + dwell'`), so it needs no new storage field. Today nothing writes
`planchette-board:settings`, so neither a changed mode nor the 2100 ms dwell default is
remembered. `main.ts` therefore gets `saveProfile()`: it reads `planchette.exportProfile()`
and calls `writeSettings({ profile, board })`. It runs on `mode-change`, when
calibration ends, after a Profile import, and after a Settings change. Once a Profile is
saved, `resolveInitialProfile` returns it unchanged on the next visit (Requirement 11
AC 6), including `dwellTime`, which is then the 2100 ms the Board applied the first
time.

**Tests never start a real camera.** `board-controls` tests use a fake Planchette whose
`startCamera`/`stopCamera` are spies. The end-to-end tests wrap `getUserMedia` to count
and refuse calls, as `skeleton/test/demo.e2e.ts` does, and assert zero calls.

### Dwell progress outline (Requirement 9 AC 11 to 13)

*(User decision, 27 Nov 2026. It replaces the first version of this section, which found no
fill to remove and planned only a "fill: none" hardening of the ring.)*

**Problem.** The ring `createDwellRing` draws is 72 px across and sits at the pointer. Its
white edge, dark track and arc together cover radius 22 to 34 px, so a label wider than the
44 px inside it (for example "different", 86 px) is crossed by the band. The ring has no fill
(checked in Chromium: every circle's computed `fill` is `none`, and the white seen inside is
the cell's own `--panel` background). The decision is to draw progress around the cell edge
instead, so nothing covers the text.

**Where it lives: a new option on `createDwellRing`, in the skeleton.**
`DwellRingOptions` gains `shape?: 'ring' | 'outline'` (default `'ring'`) and
`elementFor?: (targetId: string) => HTMLElement | null` (default: the element with
`data-planchette-target="<id>"`, else the element with that id, the same lookup as
`createScanHighlight`). With `shape` absent or `'ring'` the code path and the drawing are
unchanged, so the skeleton demo, the UI test fixture and `skeleton/test/demo.e2e.ts` keep
their ring. Options compared:
- **A new option on `createDwellRing` (chosen).** The file already owns the event wiring
  (`dwell-progress`, `select`, `destroy`), the live `prefers-reduced-motion` handling and
  `shownProgress` (quarter steps), so the outline reuses them and the two shapes cannot
  drift apart in what "progress" and "reduced motion" mean. It is a skeleton helper, so a
  developer who adopts the kit gets the outline too, which fits the product (the kit is for
  app developers). It is additive: a new optional field.
- **A Board-only renderer on the public `dwell-progress` event.** It would not touch the
  skeleton, but it would copy the quarter-step logic, the select handling and the
  reduced-motion listener into `apps/board`, and any later change to the skeleton's
  behaviour would need two edits. Rejected for that duplication.
Either way the Board imports only from the skeleton's public entry points. `main.ts` calls
`createDwellRing(planchette, { shape: 'outline' })`.

**Input-core impact.** The input-core design, section "UI helpers" (`.kiro/specs/input-core/
design.md`, the "Dwell ring" bullet), lists the options as `{ container?, size?,
reducedMotion? }` and describes only the ring. It needs one amendment, which this spec does
**not** make (the input-core files are not edited): add `shape?: 'ring' | 'outline'` (default
`'ring'`) and `elementFor?`, with a sentence saying that `'outline'` draws progress along the
target's edge and ignores `size`. Input-core Task 16.1 ("a filling ring") and the accessibility
steering ("a filling ring or bar", progress also shown by more than colour) are still met: the
default is still a ring, and the outline is a progress bar wrapped around the cell, with
progress as arc length. No input-core requirement is affected. This is reported to the user.

**Drawing rules (`shape: 'outline'`).**
- One `<svg>`, `position: fixed`, `pointer-events: none`, `aria-hidden`, the same z-index as
  the ring, `overflow: hidden`, `data-planchette="dwell-ring"` and `data-shape="outline"`.
  It is an overlay: it does not take part in layout, so the target's size and every other
  element stay where they are (no reflow). Its left, top, width and height are the target
  element's `getBoundingClientRect()` (its border box), so it never extends past the cell.
- It follows the rect: three `<rect>` elements with `fill="none"` (and `style.fill = 'none'`
  through the CSSOM, and `fill="none"` on the root, so a page rule such as `rect { fill:
  #fff }` cannot fill them), with corner radius from the element's computed `border-radius`
  (8 px for Board buttons), reduced by each stroke's inset so the curves are concentric.
  Without an element (an id that no element carries) it falls back to the rect from
  `planchette.getTargets()` with square corners and a zero border.
- Bands, from the cell's border inwards (b is the element's computed border width, 2 px, or
  4 px on a pressed toggle; the sum from the border-box edge is b + 5 px):
  1. **Edge**, 1 px, `#ffffff`, closed, directly inside the border.
  2. **Track**, 4 px, `#111111`, closed, inside the edge.
  3. **Arc**, 2 px, `#ffd400`, centred on the track (1 px of dark track on each side), a
     dash of the stroke's length so that the arc is `progress` of the perimeter, butt caps.
  Total 5 px. No fill anywhere: the inside of the outline is the cell's own background and
  the label.
- Start and direction: progress starts at the top edge just after the top-left corner (the
  start of an SVG `<rect>` path) and runs clockwise: along the top edge to the right, down
  the right edge, back along the bottom edge, up the left edge. The perimeter used for the
  dash is computed from the rect's size and radius, `2 (w + h) - 8 r + 2 pi r` on the arc's
  centre line, so the arc length is exactly `progress` of the way round (no `pathLength`).
- Progress 0 hides the SVG. In the `filling` state the arc shows `progress`. On a `select`
  not from scanning, the arc is a closed full loop for 600 ms (the same time as the ring's
  tick), with no tick (a tick would be drawn over the label) and no scale pulse (it would
  push the stroke outside the cell). A closed loop is a shape change, so the select is not
  shown by colour alone.
- Reduced motion (`reducedMotion` option, else `prefers-reduced-motion`, followed live):
  what the ring does today. Progress is shown in quarter steps (`shownProgress`), and there
  is no transition. Otherwise the arc follows each progress event with the ring's 80 ms
  linear transition on `stroke-dashoffset`.
- When the target's rectangle changes: the outline re-measures the element on every
  `dwell-progress` event, on window `resize` and `scroll` and after a `select`, in the next
  animation frame (so it runs after the Board's own `resize` handler has applied the scaled
  `--target-size`), and through a `ResizeObserver` on the current target element when the
  browser has one (so a Settings change that alters the size without a window resize is
  also followed). The new rect, border width and radius are applied to the three `<rect>`
  elements and the dash length is recomputed, keeping the same progress. The scaling in
  "Scaling to the viewport" and the Message-bar change in "Message bar text" therefore need no extra
  code in the outline.

**Does it cover the label?** The band reaches b + 5 px from the border-box edge, 7 px at the
usual border of 2 px. The label's text box is centred in the cell. Horizontally the tightest
label is "Backspace" (113 px at 24 px, the Letter board's "⌫ Backspace" key wraps at its
space, so its widest line is "Backspace") in the narrowest cell, 128 px at s = 96: it leaves
(128 - 113) / 2 = 7.5 px on each side, so the clearance is 0.5 px. At s = 148 the cell is
197 px wide and every label has more than 40 px each side. Vertically a two-line label is
62.4 px high in a cell 96 to 148 px high, which leaves 16.8 to 42.8 px above and below
against 7 px. Phrase cells are the exception to the 2 px side padding: they use 6 px side padding so the outline band (border + 5 px) clears the text; user decision, 27 Nov 2026. Border + padding is 8 px against the 7 px band, so a long phrase that fills the line still clears it. A pressed toggle has a 4 px border and so a 9 px band, but its labels ("Spell",
"Phrases", "Start camera") are short, with more than 20 px each side. The width of "Backspace"
was measured in Chromium with `system-ui`; another platform's font may be wider. The e2e test
(below) measures the real text boxes, and if a platform fails it the fix is a 3 px track
(band 4 px), not a change of the cell. The clearance of 0.5 px is the reason the band is not
wider. The tightest measured clearance elsewhere is "⌫ Backspace" at 96 px cells: 0.33 px on macOS Chromium.

**Contrast (WCAG 1.4.11, 3:1 for a UI part).** Colours: track `#111111`, edge `#ffffff`,
arc `#ffd400`, cell border `--accent` `#1f4e8c`. The scan highlight draws
`rgba(255, 212, 0, 0.45)` over the element (`scan-highlight.ts`, `inset 0 0 0 9999px`),
so the composed colour is `0.55 * background + 0.45 * (255, 212, 0)`. The dark track alone
against the border is 2.27 : 1, below 3:1, which is why the light edge exists: the track
touches the edge, and the edge touches the border.

| Pair | Colours | Ratio |
|---|---|---|
| Track on a normal cell | `#111` on `--panel` `#ffffff` | 18.9 : 1 |
| Track on a pressed cell | `#111` on `--pressed` `#d6e4f7` | 14.7 : 1 |
| Track on a scan-highlighted cell | `#111` on about `#ffec8c` | 15.8 : 1 |
| Track on a scan-highlighted, pressed cell | `#111` on about `#e8dd88` | 13.6 : 1 |
| Track on an empty or dashed cell | `#111` on `--bg` `#f7f7f4` | 17.6 : 1 |
| Edge against the cell border | `#fff` on `#1f4e8c` | 8.3 : 1 |
| Edge against the track | `#fff` and `#111` | 18.9 : 1 |
| Arc against the track | `#ffd400` on `#111` | 13.2 : 1 |
| Track against the cell border (why the edge is needed) | `#111` on `#1f4e8c` | 2.3 : 1 |

Every pair that the outline relies on is at least 8.3 : 1, so the 3:1 floor has wide
margin. The arc against a cell background is not relied on (1.0 to 1.4 : 1); the arc is
always seen against the 1 px of dark track on each side. Empty slots and dashed placeholders
are not targets, so no outline is ever drawn over them; they are in the table because
Requirement 9 AC 12 lists the state. The numbers are computed in the test, not copied
from this table.

**Tests.**
1. `skeleton/test/dwell-ring.test.ts` (jsdom, `// @vitest-environment jsdom`): with
   `shape: 'outline'`, after a `dwell-progress` of 0.5 every `rect` has `fill` `none`
   (attribute and `style.fill`) and the root has `fill="none"`, and the ring's markup has
   no `circle`; a document rule `rect { fill: #fff }` does not change `style.fill`; the
   three rects take the element's rect (stubbed `getBoundingClientRect`, border width and
   `border-radius`) with the insets above; after the rect changes and a `resize` plus a
   frame, they follow; the arc length is `progress` of the computed perimeter; reduced motion
   gives quarter steps and no transition; the `selected` state draws a full loop and no tick.
   The default shape still builds the unchanged circles and tick.
2. `skeleton/test/dwell-outline-geometry.test.ts` (examples, pure function
   `outlineGeometry(rect, border, radius)`): for 128 x 96 with border 2 and radius 8, 197 x 148
   with border 4 and radius 8, 96 x 96 with border 0 and radius 0, and a radius larger than half
   the side, the three strokes lie inside the rect, the outer edge of the edge stroke is at the
   border's inner side, the strokes are adjacent and do not overlap (1 + 4 px, arc 2 px
   centred), the radius never goes negative, and the perimeter is `2 (w + h) - 8 r + 2 pi r`
   on the arc's centre line.
3. `apps/board/test/ring-contrast.test.ts` (Vitest, the contrast maths of
   `board-colours.test.ts`): the colours are read from a ring created in jsdom with
   `shape: 'outline'`, the backgrounds from `board.css` and the tint from `scan-highlight.ts`
   source text; every row of the table above is at least 3.
4. `apps/board/test/board-dwell-outline.e2e.ts` (Playwright, `board` and `board-built`
   projects, no camera; the dwell is driven with synthetic camera samples through
   `window.planchetteBoard.planchette.feedSamples` in head + dwell mode, as
   `skeleton/test/demo.e2e.ts` does with `lookAt`, because dwell does not run in mouse mode
   (the skeleton selects on a click there and emits no `dwell-progress`; `getUserMedia` is
   counted and never called): at cell sizes 96 (1366 x 768), 139 (1920 x 1080, once
   the Message-bar task has run; 148 before it) and 148 (a saved Profile with target size
   148, at 1920 x 1080, where the page may scroll): (a) for every registered target, with
   no dwell needed, the label's text box (a `Range` over the button's text, union of its
   client rects) lies inside the target's border box less `b + 5` px on each side, where `b`
   is the computed border width. Then, for the widest-label target of each grid (Core
   "different", Letter board "⌫ Backspace", a two-line phrase), a long prediction slot and the
   pressed Spell toggle, feed samples that rest the pointer on its centre for about 40% of
   the dwell time and, while the outline shows (`data-state="filling"`): (b)
   `document.elementFromPoint` at the label's centre returns the button (the outline has
   `pointer-events: none`), and no `rect` of the outline has a computed fill other than
   `none`; (c) the outline's box equals the target's box, and the target's size and every
   region's rectangle are unchanged from before the dwell; (d) after a window `resize` the
   outline's box equals the new target box.

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
padding (phrase cells: 6 px, see the Phrases view), so the content width is 128 - 4 - 4 = 120 px. The widest unbreakable string is
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
Message bar, grid, then the right column (prediction strip, action row, Camera row of camera
toggle, Phrases toggle and rest area, Controls row, Status panel, notice). CSS grid areas place them. Left column:
Message bar on top, the active grid under it. Right column: everything else.

**Arithmetic at 1366 x 768 (default values).**

Horizontal: 12 + grid width + 16 gap + right column + 12 = 1366.
- Grid width = 6 x 128 + 5 x 16 = 768 + 80 = 848 (the Core and Letter grids use 6 columns; the Phrases view uses 2 columns filling the same 848).
- Right column = 1366 - 12 - 848 - 16 - 12 = 478.

Vertical, left column (usable height 768 - 8 - 8 = 752):
- Message bar 80 (`box-sizing: border-box`, 3 px border, no vertical padding): the text is 48
  px (twice the 24 px body text; *user decision, 27 Nov 2026*), with a line height equal to the
  text area, 80 - 6 = 74 px, so one line fills the bar exactly. At 1366 x 768 the bar stays 80
  px and holds one line (a 48 px line needs 1.3 x 48 = 62.4 px, which fits in 74). Two lines
  need 124.8 px of text area, 58.8 px more than the bar has, and the grid cannot give that
  up (see "Message bar text"). A longer Message scrolls inside the bar, which shows its last
  line in full, and the page never scrolls.
- Gap 16.
- Core grid = 6 x 96 + 5 x 16 = 576 + 80 = 656.
- Total 80 + 16 + 656 = 752. It fits with no spare height: 8 + 752 + 8 = 768.
- Letter board = 5 x 96 + 4 x 16 = 480 + 64 = 544, so 80 + 16 + 544 = 640, leaving 112
  empty under it. The Message bar and the right column do not move between views.
- Phrases view = 6 rows x 96 + 5 x 16 = 656 (5 phrase rows and the page-control row),
  the same as the Core grid, so 80 + 16 + 656 = 752 again. Columns: (848 - 16) / 2 = 416
  each, so every cell is 416 x 96 (it is `calc((var(--cell-w) * 6 + var(--target-gap) * 4) / 2)`
  in CSS, which stays equal to half the grid width less half a gap when the target size
  changes). Cell text: see "Phrase cell text" under the target table.

Vertical, right column (usable 752; widths in brackets):
| Block | Width | Height | y range |
|---|---|---|---|
| Prediction strip, 4 slots in one row: (478 - 3 x 16) / 4 = 107.5 wide each | 478 | 96 | 8-104 |
| gap | | 16 | |
| Action row, 3 columns x 2 rows: (478 - 2 x 16) / 3 = 148.7 wide each; Speak, Backspace, Clear / Undo, Spell, Cancel | 478 | 96 + 16 + 96 = 208 | 120-328 |
| gap | | 16 | |
| Camera row, 3 columns: camera toggle, Phrases toggle, rest area, (478 - 2 x 16) / 3 = 148.7 wide each | 478 | 96 | 344-440 |
| gap | | 16 | |
| Controls row: "Input mode" label, mode selector, Settings button (ordinary controls, `min-height: 48px`; widths below) | 478 | 48 | 456-504 |
| gap | | 16 | |
| Status panel (hint text, or the tracking indicator) | 478 | 112 | 520-632 |
| gap | | 16 | |
| Notice (footer), 24 px, line-height 1.2: about 3 lines = 86 px, up to 3.9 lines fit | 478 | 112 | 648-760 |

Sum = 96 + 208 + 96 + 48 + 112 + 112 = 672, plus 5 gaps x 16 = 80, gives 752. The right
column's last block ends at y = 760 = 768 - 8. Every target is inside the viewport:
the widest right-column x is 1354 <= 1366 and the lowest target bottom is the grid at
y = 104 + 656 = 760 <= 768.

**Target minimums hold.** Cells are 128 x 96 (>= 96 x 96). Prediction slots are 107.5 x 96.
Action buttons, the camera toggle, the Phrases toggle and the rest area are 148.7 x 96.
Phrase cells and Previous/Next are 416 x 96. Gaps between targets are 16 (the profile
spacing): between grid cells, between slots, between action buttons, between the three
Camera-row targets, and between the rows of blocks in the right column. The gap between
the grid and the right column is 16.

**Camera row: the rest area shrinks from 313.3 to 148.7 px wide** (*the 148.7 px rest area:
proposed by Kiro, accepted by the user on 27 Nov 2026*). The rest area is
148.7 x 96, which is at least the profile target size (96) in both directions. Checked
against `.kiro/steering/accessibility.md` and input-core: the rule is that every layout
has a rest area, a screen area with no targets (role `rest-area`); there is no minimum
size. (Input-core hit-testing skips `rest-area` targets, and the area between and
around targets is also empty space that never selects.) So 148.7 px does not break a
rule. The visible text had to change: "Rest area. Nothing here is selected." is 361 px
wide at 24 px, which wraps to four lines (about 115 px) inside the 126.7 px content
width and is clipped in the 96 px height. The visible text becomes "Rest area" (96 px,
one line) in `messages.ts` (`page.restArea`), and the full sentence stays as its
`aria-label` (`page.restAreaHelp`). "Phrases" is 83 px and fits the 140.7 px content
width of the Phrases toggle on one line. "Start camera" and "Stop camera" wrap at their
space into two lines (about 62 px).

**Controls row widths (Chromium, `system-ui`, 24 px; buttons carry a 3 px border and
14 px side padding, so 34 px beyond their text; 12 px gaps).** The row was measured
with the four controls from Requirement 13 as first specified: "Input mode" label 116.9
+ mode selector 199 (its natural width with "Gesture scanning", the longest option,
180.8) + Calibrate 92.8 + 34 = 126.8 + Settings 85.4 + 34 = 119.4, plus 3 gaps of 12 =
**598.1 px, against 478 available: it does not fit** (even with the label cut to "Mode",
59.5, it needs 540.7). The select cannot be shrunk below about 199 px without clipping
its option text, and the 24 px minimum rules out smaller text. **Resolution: Calibrate
moves into the Settings dialog** (Settings as a modal dialog from the Controls row, with
Calibrate moved into it: proposed by Kiro, accepted by the user on 27 Nov 2026; calibration is a carer-supervised step already, and
the mode selector, not Calibrate, is the control needed day to day). The Controls row
is then 116.9 + 12 + 199 + 12 + 119.4 = **459.3 px, leaving 18.7 px spare** in 478. The
end-to-end test asserts that the row does not wrap or overflow. Another platform's
`system-ui` may be wider than these figures; with less than 19 px spare this is the
tightest place in the layout, so the fallback if it fails is to shorten the visible label to
"Mode" (frees 57 px), which keeps the label visible.

**1920 x 1080.** The layout scales up to use the viewport; see "Scaling to the viewport"
below. (The first version kept the 1366 x 768 layout, centred, and left about 320 px
empty at the bottom.)

### Message bar text (Requirement 14 AC 14 to 17)

*(User decision, 27 Nov 2026: option (a), "48 px text at every size, two lines where the screen
is tall enough, one line that scrolls where it is not". It replaces the open question that
was in "Notes / open questions for the user".)*

**Text and line box.** The bar's text is 48 CSS px, twice the 24 px body text, at every
viewport size. The bar has a 3 px border, 8 px side padding and **no vertical padding**, and
its line height is the text area divided by the number of lines it holds:
`line-height: calc((var(--bar-height) - 6px) / var(--bar-lines))`. The text area is therefore
an exact whole number of line boxes, so when a long Message is scrolled to its end the bar
shows its last `lines` lines in full and no part of an earlier line. (The first version used
24 px text, a 1.3 line height and 4 px of vertical padding. At 48 px that would leave a 7.6 px
sliver of the previous line above the last one in an 80 px bar.)

| Bar | `--bar-height` | Text area | Lines | Line height | Fits 1.3 x 48 = 62.4 px? |
|---|---|---|---|---|---|
| one line | 80 | 74 | 1 | 74 px | yes, 11.6 px spare |
| two lines | 131 | 125 | 2 | 62.5 px | yes, 0.1 px per line spare; 2 x 62.4 = 124.8 <= 125 |

131 is the smallest whole number of px that holds two 48 px lines at line height 1.3:
`ceil(2 * 1.3 * 48) + 6 = 125 + 6`.

**How the height is chosen: computed by the scaling script, not fixed in CSS.** Task 31's
`apps/board/src/board-scale.ts` gets a pure function `messageBarLayout(profileSize, gap,
stripRows, viewport)` that returns `{ lines, barHeight, cellSize, pageMinHeight }`. The
constants are `BAR_TEXT_PX = 48`, `BAR_LINE_FACTOR = 1.3`, `BAR_BORDER_PX = 6`, the one-line
height 80, and `TWO_LINE_MIN_VIEWPORT_HEIGHT = 900`. The rule:
1. Compute `cellSize` with `H = 131` using the formulas in "Scaling to the viewport".
2. `lines = 2` and `barHeight = 131` when `innerHeight >= 900` and that cell size is at least
   the Profile's target size. Otherwise `lines = 1`, `barHeight = 80`, and `cellSize` is
   recomputed with `H = 80`.
3. `pageMinHeight = 16 + max(H + 6s + 6g, (k+3)s + (k+5)g + 272)`: the page height the Core
   view needs.

Why a script and not a media query: the cell size already comes from the script, the bar
height enters its formula, and one function holding both numbers cannot drift from itself,
while a CSS breakpoint and a TypeScript formula could. Why a fixed 900 px breakpoint and not
"whichever bar leaves the larger cells": that rule would make the cell size jump around as the
window is resized, with no pattern a carer could predict. At 900 px the two-line cell size is
`floor((900 - 16 - 131 - 96) / 6) = 109`, 13 px above the 96 px minimum. At 899 px the one-line
cell size is 117, so there is a one-off step of 8 px (117 to 109) when the window grows through
900 px, and the cell size never decreases while the bar stays the same height (Property 18).
A browser window on a 1080p display has about 950 px of height, so it gets the two-line bar
with `s = floor((950 - 243) / 6) = 117`. At 1366 x 768 (`768 < 900`) nothing changes: bar 80,
`s = 96`.

**CSS-safe.** `applyLayout` sets `--bar-height` (px), `--bar-lines` (1 or 2) and
`--page-min-height` (px) with `document.documentElement.style.setProperty`, as it already does
for `--target-size`, so the page's Content-Security-Policy (no inline `style` attributes) is
unaffected. `board.css` reads them with fallbacks: `.page { grid-template-rows:
var(--bar-height, 80px) auto; min-height: var(--page-min-height, 0); align-content: start }`
and `#message-bar { height: var(--bar-height, 80px); padding: 0 8px; font-size: 48px;
line-height: calc((var(--bar-height, 80px) - 6px) / var(--bar-lines, 1)) }`. After it changes the bar
height, `applyLayout` scrolls the bar to its end again so that a long Message shows its last
lines (`messageBar.scrollTop = messageBar.scrollHeight`, the call `board-dom.ts` already makes
on every Message change). The rectangle of every registered target follows through
`syncTargets`, which already runs after `applyLayout`. (The Message bar is display-only and is not registered.)

**What 1920 x 1080 gives:** see "Arithmetic at 1920 x 1080" under "Scaling to the viewport".
Bar 131, `s` = 139 (it was 148 with an 80 px bar), left column 1061, right column 924, page
1077 (99.7%). The page box is held at the Core view's height in every view by
`--page-min-height` (Requirement 14 AC 17), because the Spell view's own content (940 px, 87%)
would otherwise fall under the 90% of AC 13.

**Tests** (`apps/board/test/board-message-bar.e2e.ts`, Playwright, `board` and `board-built`
projects, mouse mode, no camera, at 1366 x 768 and at 1920 x 1080):
1. The computed `font-size` of `#message-bar` is at least twice the computed `font-size` of
   `body` (48 against 24).
2. 1920 x 1080: build a two-line Message (add Core words until `scrollHeight` exceeds one
   line height and `scrollHeight <= clientHeight`), then assert the bar's `clientHeight` is at
   least 2 x its computed line height, `scrollWidth <= clientWidth`, and the document does not
   scroll (`scrollHeight <= innerHeight`, `scrollWidth <= innerWidth`). A longer Message
   scrolls inside the bar to its end and shows exactly two full lines (`scrollTop +
   clientHeight == scrollHeight`).
3. 1366 x 768: the bar is 80 px high and its `clientHeight` equals one line height; a long
   Message (60 x "different") keeps `scrollHeight > clientHeight`, is scrolled to its end
   (`scrollTop + clientHeight == scrollHeight`), shows its last word, and the document does
   not scroll in either axis.
4. At each size the Message bar's bounding rectangle is the same in the Core, Spell and
   Phrases views, before and after the long Message, and the `.page` box is the same height
   in the three views.
`board-viewport.e2e.ts` is updated in the same task: it has no 24 px or 80 px expectation for
the bar (it compares the bar's rectangle between views), so only its cell-size expectations
change: `s` is 96 at 1366 x 768 and 139 at 1920 x 1080 (not 148), and the 90% check uses 1077.
Unit tests: `board-scale.test.ts` gets `messageBarLayout` examples and Property 18 (see
"Correctness Properties") is extended; `board-layout.test.ts` pins `#message-bar` at
`font-size: 48px` and reads `--bar-height`, `--bar-lines` and `--page-min-height` with their
fallbacks; `board-dom-scale.test.ts` checks the three custom properties at both sizes.

### Scaling to the viewport (Requirement 14 AC 11 to 13)

**Rule.** The rendered cell size `s` (the height of one grid row; the cell width stays
`s * 4 / 3`) is

`s = max(profile.targetSize, floor(min(sFitHeight, sFitWidth)))`

where `g` is `profile.targetSpacing`, `vw` and `vh` are `window.innerWidth` and
`window.innerHeight`, and `k` is the number of rows the Prediction strip uses (`k = 1` for
up to 4 slots, `k = 2` for 5 to 8, because the strip has 4 columns). The gap `g` never
scales, and the Profile's `targetSize` and `targetSpacing` are minimums: `s` is never below
the first, and `g` is never changed. The layout's size as a function of `s` (the Core grid,
six rows, is the tallest grid, so every view uses the same `s`):

| Quantity | Formula | At s = 96, g = 16, k = 1, H = 80 |
|---|---|---|
| Left column height: Message bar `H` + gap `g` + 6 rows `6s` + 5 gaps | `H + 6s + 6g` | 752 |
| Right column height: strip `k*s + (k-1)*g`, actions `2s + g`, Camera row `s`, Controls 48, Status 112, notice 112, and 5 block gaps | `(k+3)s + (k+5)g + 272` | 752 |
| Page height: 8 + 8 padding + the taller column | `16 + max(H + 6s + 6g, (k+3)s + (k+5)g + 272)` | 768 |
| Page width: 12 + 12 padding + grid `6 * (4s / 3) + 5g` + gap `g` + right column 478 | `8s + 6g + 502` | 1366 |

`sFitHeight = min((vh - 16 - H - 6g) / 6, (vh - 288 - (k+5)g) / (k+3))`, with `H` the Message
bar's height, 80 or 131 (see "Message bar text"; `H = 80` gives `vh - 96 - 6g` as before). The first term is the
largest `s` at which the left column fits; the second is the same for the right column.
At `k = 1`, `g = 16` the two columns have equal height at `s = 96` and the left column
grows faster above it (slope 6 against 4), so the `min` picks the column that actually
binds, including for a Profile target size below 96. `sFitWidth = (vw - 502 - 6g) / 8`.
(The right column's 478 px is the page width left over at the defaults; the page's
`max-width` below keeps it at 478 at every `s`.)

**At 1366 x 768 nothing changes.** `sFitHeight = min((768 - 96 - 96) / 6, (768 - 288 - 96) / 4)
= min(96, 96) = 96` and `sFitWidth = (1366 - 502 - 96) / 8 = 96`, so `s = max(96, 96) = 96`.
Every figure in the arithmetic above stands (the viewport is under 900 px high, so `H = 80`).

**Arithmetic at 1920 x 1080 (defaults, g = 16).** The first version of this section had
`H = 80` and `s = 148`. With the two-line Message bar (`H = 131`, *user decision, 27 Nov
2026*, "Message bar text" below) the figures are:
- `sFitHeight = min((1080 - 16 - 131 - 96) / 6, (1080 - 288 - 96) / 4) = min(139.5, 174) = 139.5`.
- `sFitWidth = (1920 - 502 - 96) / 8 = 165.25`.
- `s = max(96, floor(min(139.5, 165.25))) = 139`. Cell width `139 * 4 / 3 = 185.33`.
- Grid width `6 * 185.33 + 5 * 16 = 1192`; the page is `1192 + 16 + 478 + 24 = 1710` wide,
  centred in 1920 (105 px each side), because `.page { max-width }` becomes
  `calc(var(--cell-w) * 6 + var(--target-gap) * 6 + 502px)` (the 24 px of page padding plus
  the 478 px right column), which is 1366 at the defaults and 1710 at `s = 139`.
- Left column, Core view: Message bar 131, gap 16, Core grid `6 * 139 + 5 * 16 = 914`; total
  `131 + 16 + 914 = 1061`. Page height `1061 + 16 = 1077`, which is 99.7% of 1080 (3 px spare,
  from the floor of 139.5).
- Right column: strip 139, gap 16, action row `2 * 139 + 16 = 294`, gap 16, Camera row 139,
  gap 16, Controls row 48, gap 16, Status panel 112, gap 16, notice 112. Sum
  `139 + 294 + 139 + 48 + 112 + 112 = 844`, plus 5 gaps of 16 = 80, gives 924 (137 px shorter
  than the left column; the space stays empty under the notice).
- Right-column widths stay as at 1366: 478 wide, so slots are 107.5 x 139 and the action,
  Camera-row and Prediction targets are 148.7 x 139 (width 148.7 is at least the Profile's
  96; the cells are taller than wide, which Requirement 14 allows).
- Phrases view: cells `(1192 - 16) / 2 = 588` x 139; grid 914; left column 1061; page 1077.
- Spell view: the Letter board is 5 rows, `5 * 139 + 4 * 16 = 759`, so the left column is
  `131 + 16 + 759 = 906`, and the right column (924) is taller, so the content alone gives a
  page of `924 + 16 = 940`, which is 87.0% of 1080 and **below the 90% (972 px) that
  Requirement 14 AC 13 asks for** (with the one-line bar the right column was 960 and the
  figure was 90.4%). The fix is Requirement 14 AC 17: the script sets `--page-min-height` to
  the height the Core view needs, `16 + max(H + 6s + 6g, (k+3)s + (k+5)g + 272) = 1077`, and
  `.page { min-height: var(--page-min-height); align-content: start }`, so the `.page` box
  is 1077 px (99.7%) in every view. In the Spell view that leaves 171 px empty under the
  Letter board and 137 px under the notice; nothing moves and no target changes size. The
  `.page` box (padding included), not the union of the targets, is what is measured.
  This is a decision for the user to confirm: the alternative is to leave Spell at 87% and
  lower AC 13's figure for that view.
- Block heights at `s = 139` in one list, for the e2e test: Message bar 131; Core and Phrases
  grid 914; Letter board 759; Prediction strip 139; action row 294; Camera row 139;
  Controls row 48; Status panel 112; notice 112; every gap 16. Coverage of the viewport
  height by the `.page` box: Core, Spell and Phrases 1077 / 1080 = 99.7%.
- The profile-minimum case still holds: the rendered size never goes below
  `profile.targetSize`, so a Profile of 200 at 1920 x 1080 renders at 200, the bar stays one
  line (the two-line bar is used only when it still leaves `s` at the Profile size or more),
  and the page may scroll (Requirement 14 AC 7).

**Where it is computed: script, not CSS.** Two options were compared. (a) CSS only:
`--target-size: max(var(--profile-size), min((100vh - ...) / 6, (100vw - ...) / 8))`.
It needs no resize handler for the size itself, but it cannot floor to a whole pixel (cells
land on fractional pixels), it cannot be unit-tested in jsdom (no layout), `100vh` differs
from `innerHeight` on mobile browsers and with scroll bars, and the right-column
`min`/`max` branch for sizes under 96 is hard to read in `calc`. (b) A pure function in
`apps/board/src/board-scale.ts`, `renderedCellSize(profileSize, gap, stripRows, viewport)`,
called from `board-dom.ts`'s existing `applyLayout` (which passes `stripRows =
max(1, ceil(strip.slots.length / 4))`). Chosen: (b). It is a pure function, so
Property 18 can test it directly, and `applyLayout` already sets `--target-size` and
`--target-gap` and already runs on mount, `resize`, `scroll`, `mode-change` and after every
Settings change (`syncTargets`). The CSP is unaffected: the page's policy blocks inline
`style` attributes, but `document.documentElement.style.setProperty(...)` goes through the
CSSOM and is what the Board does today. `applyLayout` sets `--target-size` to the rendered
size `s` (so every CSS rule that reads it, including `--cell-w`, the side column's row
sizes and `.target { min-height }`, follows) and keeps the Profile's size as the
`minSize` argument. `.page`'s `max-width` changes as above; nothing else in `board.css`
changes.

**Targets follow.** `syncTargets` (already on `resize`, `scroll` and `mode-change`) calls
`applyLayout()` first, which changes the custom properties, and then reads each
registered element with `getBoundingClientRect()`, which forces layout, and passes it to
`host.updateTarget`. So the rectangles that the skeleton hit-tests are the scaled ones.
Slot-lock rectangles (`lastRects`) are updated in the same loop. A view change or a page
change registers elements after `applyLayout` has run, so they are read at the current
size. `host.setScreen` is called with the new window size in the same function.

**Dwell-simulator layouts.** The layout export (Task 36.1) reads `getTargets()` from the
built page at 1920 x 1080 and 1366 x 768, so the 1920 x 1080 files hold the scaled layout
(cells 139 px high, with the two-line Message bar). The six-preset gate then measures what a person sees at that size.
This is a change from the first version of this design, whose 1920 x 1080 layout was the
1366 x 768 layout moved to the centre.

**Open point for the user: lever 3.** Lever 3 under "Layout validation" ("Do not enlarge
target size beyond the profile default (96 px) for this fix") is unchanged by this section.
It was written for the Profile's target size, and its reason is that larger targets make a
reading pause more likely to land inside one. The rendered cells at 1920 x 1080 are now
139 px because the viewport allows it, so the 1920 x 1080 gate measures larger cells than
lever 3 assumes. The gate in Task 36.2 may therefore give a different figure at 1920 x 1080
than the unscaled layout did. If the gate is missed, the task stops and reports to the
user (see "If the gate is missed"); no lever is edited here.

**Tests.** `board-scale.test.ts` (examples: 1366 x 768 gives 96; 1920 x 1080 gives 139 (148 with
a one-line bar, `H = 80`);
5 to 8 slots (`k = 2`) at 1920 x 1080 give 136; a Profile size above the fit wins; a very
small viewport returns the Profile size) and `board-scale.props.test.ts` (Property 18);
`board-dom` jsdom tests with a fake host: a `resize` calls `updateTarget` for every
registered target with the rectangles read after `--target-size` changed, and
`applyLayout` sets `--target-size` and `--target-gap` through `style.setProperty` and
sets no `style` attribute; `board-viewport.e2e.ts` at 1920 x 1080: the `.page` box is at
least 90% of the viewport height in the Core, Spell and Phrases views (the same height in
all three, Requirement 14 AC 17), with the existing
checks (no scroll, every target inside the viewport, equal cell widths within each grid, no
overflow) still passing at both sizes in all three views. The e2e file's fixed numbers
(cell 416 x 96, camera row 148.7 x 96, phrase rows 96 + 16 apart) become expressions of `s`
read from the page (`--target-size`).

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
`predictionSlotCount` 5-8 the strip needs two rows (+112 px at `s = 96`): the right column
then needs 864 px, which does not fit 1366 x 768 (752 usable). The strip wraps to a second
row, and the new count applies on the next page load. The page may then scroll at
1366 x 768; the targets keep their size (Requirement 14 AC 7). At 1920 x 1080 the scaling
rule takes `k = 2` into account: `sFitHeight = min(139.5, (1080 - 288 - 7 * 16) / 5 = 136) =
136`, so the cells are 136 px high and the page still fits (right column `5 * 136 + 112 +
272 + 16 = 1080`). A larger
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
checked by the dwell-simulator layout runs in Tasks 36 and 37 and revisited if it reads
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
  (148.7 x 96, after the Camera row was split three ways), which governs.

### About screen

A section (`#about`) of the Settings dialog, shown by an "About" button inside it (an
ordinary focusable control like the rest of Settings, not a `Planchette` target). All text comes from
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

*Provenance: Settings as a modal dialog opened from the Controls row, with Calibrate moved
into it: proposed by Kiro, accepted by the user on 27 Nov 2026.* One modal dialog (`<dialog id="settings">`), opened by the plain "Settings" button
(`#settings-button`) in the Controls row. Neither is a `Planchette` target: Settings is
a carer tool, reachable by keyboard Tab, mouse and screen reader, not required to be
dwell/scan-reachable by the Board's own person-facing input modes, matching how the
skeleton demo treats its own mode switcher and profile box.

**Dialog behaviour.**
- Open with `dialog.showModal()`. A modal `<dialog>` makes the rest of the document
  inert (not focusable, hidden from the accessibility tree). Chromium's modal dialog does
  not keep Tab inside it: Tab from the last control leaves the dialog. `board-settings-dom`
  therefore adds a `keydown` handler on the dialog that wraps focus at both ends (Tab on
  the last focusable control moves to the first, Shift+Tab on the first moves to the last),
  to satisfy Requirement 6 AC 11. It has `aria-labelledby` pointing at its heading ("Settings").
- Escape closes it (the browser's `cancel` then `close` events), and so does the visible
  "Close" button. On `close`, `board-dom` calls `settingsButton.focus()` explicitly
  (browsers also restore focus to the previously focused element; the explicit call
  makes it deterministic and testable).
- The About screen is a second section inside the same dialog: the "About" button
  swaps the settings sections for the About section and shows a "Back" button, so there
  is one dialog and one focus trap, not two. Escape closes the whole dialog.
- **Targets under the dialog.** The skeleton has no pause, disable, or modal API (its
  surface is `registerTarget`, `updateTarget`, `unregisterTarget`, mode and profile
  setters, camera and calibration calls). Planchette hit-tests registered rectangles from
  mouse, keyboard, gamepad and camera samples, not DOM elements, so the dialog being on
  top does not stop it: a mouse click on a dialog control that sits over a target's
  rectangle would also make the skeleton emit `select` for the target underneath, and
  dwell or scanning would carry on. (Its keyboard adapter already ignores keys in text
  fields via `isEditable`, but not on buttons, selects or checkboxes, so Space on a
  focused dialog button also counts as a switch press.) `board-dom.ts` therefore keeps a
  `settingsOpen` flag, set on `showModal` and cleared on `close`, and its `select`
  listener returns at once while it is set. The flag alone is not enough: the skeleton
  queues pointer presses and emits `select` on the next animation frame, so a click on
  Close over a target closes the dialog first and the `select` arrives after `close`.
  `settings-gate.ts` (`createSettingsGate`) records the time of the dialog's last `close`
  and ignores any `select` whose `detail.now` (the press's own `performance.now()`-clock
  timestamp) is at or before that time. `board-dom`'s `select` listener and
  `board-controls`' camera-toggle handler both check the gate in addition to the flag.
  This also covers `phrases-toggle`,
  `camera-toggle`, `spell-toggle`, prediction slots and every other id, because the check
  is at the one listener. Targets are left registered (unregistering them would shift
  scan and hit-test state for a dialog that is opened by a carer for a few seconds). The
  dwell ring and scan highlight may still draw over the dialog; this is accepted because the
  dialog is a carer's tool. `cancel` events are not ignored (Escape also reaches the
  skeleton as cancel, which only cancels its own dwell or scan).
- Calibrate and the camera: Calibrate is inside the dialog (see "Input controls"). WHEN
  pressed with the camera on, the dialog closes first, so the step text and the
  calibration overlay are visible on the page, then `startCalibration()` runs.
- jsdom does not implement `showModal`, `close` or the Escape/Tab behaviour, so unit tests
  use a small stub that sets and clears the `open` attribute and fires `close`; the Tab
  wrap, Escape and focus return are checked in Playwright
  (`board-settings-dialog.e2e.ts`).

It renders:
- the skeleton Profile fields and the Board-only fields as labelled `<input>` or
  `<select>` controls with their min/max shown in help text. The dialog has no input-mode
  control: the Controls-row mode selector covers it. The skeleton does not export its
  field limits, so the help text comes from a static table in the Board copied from the
  input-core Profile fields table. The dwellTime field's shown default is the Board
  default (2100 ms, `BOARD_DEFAULT_DWELL_TIME`), not the skeleton's 1000 ms. The table is display only: a change goes through
  `setProfile`, and the dialog then shows back the value the skeleton kept (so a clamped
  value is shown clamped). `predictionSlotCount` is saved immediately and applies on the
  next page load, because the Prediction strip is fixed for the life of the page;
- the control labels (proposed by Kiro, accepted by the user on 27 Nov 2026), all defined in `messages.ts`: "Start camera when the page opens"
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
- a "Calibrate" button (see "Input controls"), a message line for it, an "About" button
  that shows the About section inside the dialog, and a "Close" button;
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

**Filtering rules, applied in this order by the build script** (*provenance: the word-list
filter `/^[a-z][a-z']+$/` in rule 2 is a user decision*):
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

For any sequence of Board actions, mode switches, view toggles (Spell toggle, Phrases
toggle), page changes, Settings changes that do not edit the Quick-phrases list, and
window-resize events, the row, column, and label that `board-dom.ts` registers for each
`CORE_VOCABULARY` target id at the end of the sequence equal the row, column, and label
it registered for that id at the start whenever the Core view is shown at both, and
likewise for each `LETTER_BOARD` target id whenever the Spell view is shown at both. In
the Phrases view, for an unedited list: whenever the same page is shown at the start
and the end, every `quick-phrase-<id>` target on it has the same row, column, and label
(the full phrase text), `phrases-prev` and `phrases-next` are at row 5, columns 0 and 1
whenever registered, and the cell of list index `n` is always at page `floor(n / 10)`,
row `floor((n % 10) / 2)`, column `n % 2`. Exactly one view's grid targets are
registered at any time, and the view after each toggle follows the rule in "Input-mode
integration via the skeleton API".

**Validates: Requirements 2.2, 2.3, 2.4, 3.3, 3.7, 7.4, 7.7, 7.8, 7.9, 7.10, 7.12**

### Property 2: Clear then undo is identity

For any Message string `m`, `dispatch({ type: 'clear' })` followed by `undo()`
restores the model's `message` to exactly `m`.

**Validates: Requirements 1.6, 1.7**

### Property 3: Any undoable action then undo is identity

For any Message string `m` (with any Partial word) and any of `add-word`, `complete-word`,
`add-letter`, `add-space`, `backspace`, `clear`, `replace` that is not a no-op there (per Requirement 1
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

### Property 17: Completing a word replaces the partial word

For any Message `m0` that is empty or has no trailing whitespace, any non-empty string
of letters `p` spelled after it with `add-letter` (one dispatch per character), and any
non-empty word `w` (letters and apostrophes): dispatching `complete-word` with `w` gives
exactly the message that `add-word` with `w` gives on `m0` (that is, `m0` + a separator
+ `w`, the separator being one space when `m0` is non-empty and none otherwise) and
`partialWord` `''`; and `undo()` then restores the message `m0` + the same separator +
`p.toLowerCase()` and `partialWord` `p.toLowerCase()`. Property 3 covers `complete-word`
as one more undoable action.

**Validates: Requirements 4.18**

### Property 18: Rendered cell size

For any whole-number Profile target size in 64 to 400, any whole-number target spacing `g`
in 8 to 64, any Prediction-strip row count `k` of 1 or 2, and any viewport width and height
of at least 1 px: `messageBarLayout` returns a bar height `H` of 80 or 131 and a whole-number
cell size `s` that is at least the Profile target size. `H` is 131 only when the viewport
height is at least 900 and the cell size computed with `H = 131` is at least the Profile
target size. If `s` is greater than the Profile target size, the layout's page height
`16 + max(H + 6s + 6g, (k+3)s + (k+5)g + 272)` is at most the viewport height and its page
width `8s + 6g + 502` is at most the viewport width, and the same figures at `s + 1` exceed
at least one of them. For two viewports that get the same `H`, `s` never decreases when the
viewport width or height is increased with the other held. `pageMinHeight` equals the page
height formula above. For target size 96, spacing 16 and `k = 1`, a 1366 x 768 viewport
returns `H = 80` and 96, and a 1920 x 1080 viewport returns `H = 131` and 139.

**Validates: Requirements 14.6, 14.11, 14.13, 14.15, 14.17**

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
  on this device." (from `messages.ts`; the wording is proposed by Kiro, accepted by the
  user on 27 Nov 2026), per Requirement 8 AC 2. The same
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
- Property 1 generates random interleavings of `BoardAction`s, Spell and Phrases
  toggles, page changes, settings changes, and resize events, replaying them against `board-dom.ts`'s target
  registry (a lightweight fake `Planchette` host that records `registerTarget` /
  `updateTarget` calls, not a real DOM) to avoid flaking on real layout/CSS.
- Properties 2–6, 8, 11, 14, 15, 16, 17 drive `board-model.ts` / `prediction.ts` / `quick-phrases.ts`
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
and 1920 x 1080, in mouse mode, in the Core view, in Spell mode and in the Phrases view
(with the list filled past 10 phrases so there are several pages, and with a phrase
longer than two lines), the document does
not scroll (`scrollHeight <= innerHeight`, `scrollWidth <= innerWidth`), the Message
bar, active grid, prediction strip, action row, Controls row, Status panel, rest area
and notice are inside the viewport, every target returned by
`window.planchetteBoard.planchette.getTargets()` lies fully inside the viewport, and no
target's label overflows its element. Playwright runs these from a new `board` project
in `playwright.config.ts` (project-level `testDir: 'apps/board/test'`), so the skeleton
specs and their config are unchanged. The config's top-level `testDir` stays
`skeleton/test`. These checks run at both sizes in all three views; at 1920 x 1080 they also
assert that the `.page` box is at least 90% of the viewport height ("Scaling to the
viewport"), and the expected cell and row sizes are computed from the rendered size read
from the page, not hard-coded to 96. A separate test opens the page with no saved
Profile and checks that the first-run hint fits the Status panel without page scroll
and that removing it moves no other region ("First-run hint").
Property 18 (rendered cell size and Message-bar height) is a Vitest + fast-check test of the pure
`messageBarLayout` (and `renderedCellSize`, its `H = 80` case); the first-run hint is covered by jsdom example tests in
`apps/board/test/board-controls.test.ts` (shown on a fresh Profile; hidden after a select;
hidden after a camera start; never shown with a saved Profile; `startCamera` never called;
never two hints at once), because its behaviour does not vary over a large input space.
The dwell outline ("Dwell progress outline") is covered by example tests too: a jsdom test
and a geometry property test in `skeleton/test`, a colour test and an e2e test in
`apps/board/test`. The Message-bar text size and height ("Message bar text") are covered by
`board-message-bar.e2e.ts` and the unit tests listed there.

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
assumption until checked: Task 35.1 verifies it first (enable the server in Kiro and
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

**The 1920 x 1080 files hold the scaled layout.** The page scales its cells to the viewport
("Scaling to the viewport"), so `getTargets()` at 1920 x 1080 returns rectangles for 139 px
rows (148 before the two-line Message bar), not the 1366 x 768 layout moved to the centre. The export must run after
`applyLayout` has used the 1920 x 1080 window (it opens the page at that size, so
this holds with no extra step), so the gate measures what a person sees at that size.
The 1366 x 768 files are unchanged by the scaling.

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
- It is stated as a number (not "noticeably fewer") so Task 36 below is a pass/fail
  gate, per this workflow's requirement that acceptance criteria be measurable.

**If the gate is missed.** The task stops and reports the measured numbers (the preset,
the layout, `accidentalPer100Intended`, the causes) and the options to the user. It does
not loosen the 10-per-100 target and does not change the design levers below without the
user's approval.

**Design levers used, and why each acts on reading-pause accidents specifically (never
by changing the simulator):**

1. **Raise the Board's default dwell time to 2100 ms** (user decision, 27 Nov 2026; a `Board profile` default
   applied via `setProfile` only when no saved or imported profile exists, within
   input-core's existing 400–3000 ms range — no new field). The rule lives in
   `board-settings.ts` as `resolveInitialProfile(saved)`: if `planchette-board:settings`
   holds a profile (saved by the person, or written by an import), return it unchanged,
   including its `dwellTime` whatever the value (a saved 1000 stays 1000); only when
   `readJSON` reports `usedDefault: true` for that key does it return `{ dwellTime: 2100 }`
   (Requirement 11 AC 5, 6). A person's or carer's chosen dwell time is never overwritten. A person can change it in
   Settings (400–3000 ms, step 50).

   *The design's original reasoning was disproved by the simulator.* It said a reading
   pause of 300–900 ms would be 500–1100 ms short of completing a selection at 1400 ms
   (and 100–700 ms short at 1000 ms). The simulator showed otherwise: the slow crossing
   into and out of a reading pause counts toward dwell as well, so pauses of 300–900 ms
   still complete 1400 ms dwells. At 1400 ms the gate measured 50.6–58.6 accidental
   selections per 100 intended on `reads-while-pointing` (core-1920 52.1, core-1366 50.6,
   spell-1920 58.6, spell-1366 57.6; seed 1, `eachTarget` 2).

   **Decision (user decision, 27 Nov 2026): 2100 ms.** The rule that chose it: the
   smallest of 2000, 2100 and 2200 ms whose worst seed (1–10) of `reads-while-pointing`
   is at or below 10 accidental per 100 intended on all four Board layouts. 2000 ms fails
   (worst seed 10.6/8.2/12.7/9.5), 2100 ms passes (7.9/4.9/8.3/6.1), 2200 ms passes
   (5.4/4.0/5.9/4.3), in the order core-1920, core-1366, spell-1920, spell-1366. At
   2100 ms, seed 1, the rate is 3.6/2.4/5.8/3.8; the other five presets stay at 0.5 or
   below, except `small-range` at 4.4–6.3. With no reading pauses, accidents are 0–0.5.
   With the pause capped at 600 ms they are still 39–47 per 100, so a shorter pause does
   not fix it. The full tables (the 1000–2200 ms sweep and the multi-seed runs) are in
   `docs/board-gate.md`.

   **Cost:** about 700 ms per intentional selection (core-1366: `steady` median
   2533 → 3233 ms, `slow` 3967 → 4667 ms). A slower dwell costs every selection equally,
   not just the accidental ones. It is accepted because `slow`'s risk is time, not
   safety, and product.md Principle 1 (never select something not meant) ranks above
   speed. The `compare` run (Task 37) shows this effect.
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
- **Message-bar text size: decided (option (a), user decision, 27 Nov 2026).** The text is
  48 px at every size. At 1920 x 1080 the bar is 131 px (two lines) and the cells are 139 px;
  at 1366 x 768 the bar stays 80 px with one line that scrolls. The arithmetic is in "Message
  bar text" and "Scaling to the viewport". One point is for the user to confirm: with the
  taller bar the Spell view's own content is 87% of the 1080 px height, so the `.page` box is
  held to the Core view's height (Requirement 14 AC 17) to keep the 90% of AC 13.
- **`small-range` "other" accidents: open, not investigated (27 Nov 2026).** At the 2100 ms
  default the `small-range` preset has 31–46 accidental selections per layout (4.4–6.3
  per 100 intended) whose cause is not `reading-pause`. Almost all are misses where the
  aim lands outside the target. The cause is unknown and no change was made.
- **`reads-while-pointing` 10-per-100 target is a proposal**, not a figure from a
  cited human-factors source (unlike the simulator's own movement-model figures, which
  are cited in METHODOLOGY.md) — it is this design's own choice, justified above. The
  user may want a stricter or looser number once the Task 36 measurement is in hand.
