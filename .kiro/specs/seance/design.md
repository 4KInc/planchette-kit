# Design: Séance (second app on the template)
## Overview
Séance is a plain-DOM, plain-TypeScript app (no framework, per tech.md) built on one
`Planchette` instance from `@planchette/skeleton`. Its game logic is pure and has no DOM:
the Round state machine, the Support (adaptation) state machine, the Message chooser, the
Summary figures, the Carry to the Board's storage, and the sound plan. A thin DOM layer
draws the board and registers targets. The input bar (mode selector, Start camera, Settings,
first-run hint, rest area, Cancel, Undo) is the Board's, moved into the skeleton's `./ui` entry
point and shared (see "Shared input controls").
Séance imports nothing from `apps/board`. It reads two things from the Board as *data*:
the shape of the Board's stored settings (copied, then pinned by a contract test, see "Carry")
and the offensive-word list (read by one test). If something should be shared later, it goes
into the skeleton's public API (structure.md), not across apps (Notes, item 3).
Design choices, with the alternatives considered:
| Choice | Alternative | Why this one |
| --- | --- | --- |
| One screen: the board, replaced by the Summary at round end | A separate menu, level select, score screen | Fewer targets to mis-select, nothing to navigate, fits the "keep it small" budget |
| Alphabetical board, 7 × 6 | The Board's frequency-order letter grid (6 × 5) | A new player searches for a letter; alphabetical is the order they know. The 7-column grid keeps the Board's 848 px left column and 96 px rows, so the same page envelope fits |
| No score, no timer, no fail state | Stars, streaks, a timer | Principle 1 and "never punishes". The Summary reports figures without judging them |
| Support level as a small state machine in its own file | Folding it into the Round | The Round must stay a plain counter. Adaptation is a separate rule with its own properties |
| Suggestion applied only by an explicit press | Auto-raise the dwell | Principle 4 (adapt to the person) and "never select something not meant": a silently slower dwell would change the person's setup |
| Carry writes the Board key only on a press, preserves all other fields, refuses a record it cannot read | Overwrite the key with a fresh record | The Board reads the whole record or falls back to defaults. A partial or fresh write would erase the person's other settings |
| Controls moved into `skeleton/ui` and shared by the Board and Séance (user decision) | Copy and trim the Board's | A copy would drift. The move is done first, with the Board's tests as the proof that nothing changed |
## Architecture
```
apps/seance/src/
  main.ts              entry: creates the Planchette, wires the DOM layer, saves the Profile,
                        exposes window.planchetteSeance = { planchette }
  spirit-messages.ts   pure: the bundled word list, Message type, pickMessage(seed, n, previous)
  round.ts             pure: createRound, stepRound(state, input, now), cloneRound
  support.ts           pure: createSupport, stepSupport(state, input, now), cloneSupport, SEANCE_CONFIG
  summary.ts           pure: summarise(round, context), canOfferCarry(...)
  board-link.ts        pure + storage: readBoardDwell, carryDwellToBoard, undoCarry
  seance-storage.ts    pure + storage: readSeanceProfile, writeSeanceProfile (corrupt -> default)
  seance-layout.ts     pure: the fixed cell table, extent arithmetic, arrival guard
  sound-plan.ts        pure: which tones to play for an event, with the limits
  sound.ts             thin Web Audio wrapper (creates the AudioContext on first "on")
  messages.ts          every user-facing string, one file (structure.md)
  seance-dom.ts        the only file that registers board and summary targets; draws the page
  seance-settings-dom.ts  Settings dialog (Dwell time, start camera on load, Calibrate, About)
apps/seance/seance.css   every colour as a custom property; no inline styles
seance/index.html        static markup, same Content-Security-Policy as the Board
apps/seance/test/        unit, property, e2e (names in "Testing strategy")
```
Engine-style files export `step…(state, input, now)` that updates a small state object in
place and returns events, plus a `clone…` function for tests, as tech.md requires. They never
read a clock, `Math.random`, the DOM or storage. The DOM layer reads `performance.now()` once
per Round start and passes it in; every later time is the skeleton's own `select.detail.now`
(same clock, as the Board's `settings-gate.ts` already relies on).
### State ownership
- **Planchette** owns pointer, dwell, scan, calibration, Profile and camera state.
- **`RoundState`** (`round.ts`) owns one Round's progress and counts. A new object per Round.
- **`SupportState`** (`support.ts`) lives for the page's life: Support level, streaks, the
  open Suggestion, whether one was offered this Round.
- **`seance-dom.ts`** owns the view (`'play' | 'summary'`), the page seed and Round number,
  the last Summary, the last Carry's undo record, and `modeChangedDuringRound` (set by a
  `mode-change` event while a Round is playing, cleared at Round start). It is the only DOM-touching, stateful
  module.
- **Storage** holds the Séance Profile only (and the Board key after a Carry).
### Why the logic is separable from the DOM
Every property in "Correctness properties" is phrased over the pure modules, or over a fake
host that records `registerTarget`/`updateTarget`/`unregisterTarget` calls (as the Board's
Property 1 does). `seance-dom.ts` is covered by Playwright and axe-core, which check real
positions and accessibility.
## Components and interfaces
### `spirit-messages.ts`
```typescript
export type MessageKind = 'word' | 'answer' | 'farewell';
export interface Message {
  readonly id: string;               // 'word-moth', 'answer-yes', 'farewell-goodbye'
  readonly kind: MessageKind;
  readonly text: string;             // 'MOTH', 'YES', 'GOODBYE'
  readonly steps: readonly string[]; // target ids: ['letter-m','letter-o','letter-t','letter-h']; ['yes']; ['goodbye']
}
export const WORDS: readonly string[];          // the list below
export function pickMessage(seed: number, roundNumber: number, previousId: string | null): Message;
```
**The list** (32 words, written for this project; single common English words chosen by
hand):
- 3 letters: OWL BAT FOG OAK FOX JAR ZEN
- 4 letters: MOTH MIST DUSK CROW LAMP STAR WIND BIRD STAY CALM HIVE
- 5 letters: GHOST RAVEN EMBER SHADE WITCH MAGIC QUIET LIGHT
- 6 letters: CANDLE SPIDER LISTEN SILENT WINDOW SHADOW

Checked with a script against Requirement 14 (the first draft had MOON, which has a double O; it became MOTH): all A to Z, no adjacent repeated letter, every letter
of the alphabet appears (Q in QUIET, J in JAR, X in FOX, Z in ZEN, V in RAVEN, Y in STAY), none
of them offensive; the test re-checks all of it, including the Board's exclusion list.
`pickMessage(seed, n, previousId)`:
- `n` counts Rounds from 1. If `n % 4 === 0`, the Message is an answer or the farewell,
  chosen by `((n / 4) - 1) % 3`: 0 gives YES, 1 gives NO, 2 gives GOODBYE.
- Otherwise it is a word. Round 1 draws from the 3-letter words only (a warm-up). Other
  Rounds draw from all words except `previousId`'s.
- The draw uses a small inline `mulberry32` PRNG seeded with `(seed + n × 0x9E3779B1) >>> 0`
  (no dependency, no `Math.random`). The page calls `crypto.getRandomValues` once for the
  seed, in `main.ts`, not here.
### `round.ts`
```typescript
export type RoundStatus = 'playing' | 'complete' | 'stopped';
export interface RoundState {
  readonly message: Message;
  status: RoundStatus;
  index: number;       // Hits standing; the current Step is message.steps[index]
  startedAt: number;
  endedAt: number;     // -1 until the Round ends
  lastAt: number;      // last accepted timestamp; starts at startedAt
  stepShownAt: number; // when the current Step became the next target
  hits: number;        // Hits ever made (Taken back ones included)
  misses: number;
  takenBack: number;
  readonly stepMs: number[]; // per Step, ms from shown to Hit; -1 = none standing
}
export type RoundInput =
  | { type: 'select'; target: string }  // a Board target
  | { type: 'undo' }
  | { type: 'stop' };
export type RoundEvent =
  | { type: 'hit'; target: string; index: number; ms: number }
  | { type: 'miss'; target: string; expected: string }
  | { type: 'undone'; index: number }
  | { type: 'complete' }
  | { type: 'stopped' };
export function createRound(message: Message, now: number): RoundState;
export function stepRound(state: RoundState, input: RoundInput, now: number): RoundEvent[];
export function cloneRound(state: RoundState): RoundState;
```
Rules, in the order they apply:
1. If `status !== 'playing'`, return `[]` (absorbing).
2. `stop` is always accepted: `status = 'stopped'`, `endedAt = max(now, lastAt)`, event
   `stopped`. This is what makes "a Round always ends" true whatever the timestamps.
3. For `select` and `undo`, if `now <= lastAt`, return `[]` (Requirement 2 AC 2). Otherwise
   `lastAt = now`.
4. `select` of `steps[index]`: `stepMs[index] = now - stepShownAt`, `index++`, `hits++`,
   `stepShownAt = now`, event `hit`. If `index === steps.length`, `status = 'complete'`,
   `endedAt = now`, and a `complete` event follows.
5. `select` of any other target: `misses++`, event `miss`. No other change.
6. `undo` with `index > 0`: `index--`, `stepMs[index] = -1`, `takenBack++`, `stepShownAt = now`,
   event `undone`. With `index === 0`: `[]`. `hits` is not decremented: it counts selections,
   so a selection is never counted twice and never uncounted.
The Summary's "letters" is `index` (Hits standing), not `hits`.
The Round's time is `endedAt - startedAt`.
### `support.ts`
```typescript
export const SEANCE_CONFIG = {
  strongCueAfterMisses: 2,   // Misses in a row for level 1
  suggestAfterMisses: 4,     // Misses in a row for level 2 and the Suggestion
  calmAfterHits: 3,          // Hits in a row to drop one level
  suggestedDwellStepMs: 300, // Suggestion = current dwell + this, on the 50 ms step, capped
  dwellMinMs: 400, dwellMaxMs: 3000, dwellStepMs: 50, // the Profile's dwellTime range and Settings step
} as const;
export interface SupportState {
  level: 0 | 1 | 2;
  missStreak: number;
  hitStreak: number;
  offeredThisRound: boolean;
  suggestion: { ms: number } | null;  // open until answered or the Round ends
}
export type SupportInput =
  | { type: 'round-start' }
  | { type: 'hit' }
  | { type: 'miss'; dwellMs: number; dwellApplies?: boolean }
  | { type: 'round-end' }
  | { type: 'accept' }
  | { type: 'dismiss' };
export type SupportEvent =
  | { type: 'level'; level: 0 | 1 | 2 }
  | { type: 'suggest'; ms: number }
  | { type: 'apply-dwell'; ms: number }   // the DOM calls setProfile({ dwellTime: ms }) and saves
  | { type: 'suggestion-closed' };
export function stepSupport(state: SupportState, input: SupportInput, now: number): SupportEvent[];
```
(`now` is in the signature for the shared shape and is not used.)
Rules:
- `round-start`: `missStreak = hitStreak = 0`, `offeredThisRound = false`. Level and an open
  Suggestion carry over.
- `round-end`: close an open Suggestion (`suggestion-closed`); nothing else.
- `miss`: `missStreak++`, `hitStreak = 0`. `target = missStreak >= suggestAfterMisses ? 2 :
  missStreak >= strongCueAfterMisses ? 1 : 0`. `level = max(level, target)`. If `missStreak >=
  suggestAfterMisses`, no Suggestion is open, `!offeredThisRound`, `dwellApplies !== false` (the page
  passes `mode === 'head + dwell'`) and `dwellMs < dwellMaxMs`,
  open one: `ms = min(dwellMaxMs, ceil((dwellMs + suggestedDwellStepMs) / dwellStepMs) × dwellStepMs)`,
  set `offeredThisRound`, emit `suggest`.
- `hit`: `missStreak = 0`, `hitStreak++`. When `hitStreak >= calmAfterHits`: `level = max(0,
  level - 1)`, `hitStreak = 0`.
- `accept` with an open Suggestion: emit `apply-dwell`, clear it. `dismiss`: clear it, emit
  `suggestion-closed`. Without an open Suggestion both do nothing.
Nothing in this file changes the dwell by itself: `apply-dwell` is only an event the DOM acts on,
and it is emitted only for `accept`.
Why `level` never falls on a Miss: the only `level` assignment in the `miss` branch is
`max(level, target)`; the only decrease is in the `hit` branch. Property 4 checks it over
generated sequences instead of trusting this paragraph.
### `summary.ts`
```typescript
export interface SummaryData {
  readonly completed: boolean;
  readonly spelled: string;          // letters standing, e.g. 'MO'; whole text if complete
  readonly letters: number; readonly steps: number;
  readonly seconds: number;          // (endedAt - startedAt) / 1000, one decimal
  readonly misses: number; readonly takenBack: number;
  readonly dwellMs: number; readonly mode: InputMode;
}
export function summarise(round: RoundState, context: { dwellMs: number; mode: InputMode }): SummaryData;
export function canOfferCarry(round: RoundState, context: { mode: InputMode; modeChangedDuringRound: boolean; boardReadable: boolean }): boolean;
```
`canOfferCarry` is `round.status === 'complete' && mode === 'head + dwell' && !modeChangedDuringRound
&& boardReadable` (Requirement 5 AC 1). "Measured" in the brief means *the dwell time the person
actually used in this round*, not an estimate of the best value (Notes, item 2).
### `board-link.ts`
The Board's stored value for `planchette-board:settings` is `{ version: 1, profile, board }` where
`profile` is a record and `board` holds `predictionSlotCount` (number), `voiceURI` (string),
`speechRate` (number) and `filterOffensiveWords` (boolean). The Board's reader
(`readSettings`) accepts the record only if all of that holds; otherwise it falls back to its
defaults and the person's saved profile is lost on its next save. So the Carry must never write
a partial record.
```typescript
export const BOARD_KEY = 'planchette-board:settings';
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type BoardRead =
  | { state: 'none' }                                    // key missing
  | { state: 'ok'; dwellMs: number | null; raw: string } // valid record; dwellMs null if profile has none
  | { state: 'unreadable' };                             // present but not a valid record, or storage failed
export function readBoard(storage: StorageLike | undefined): BoardRead;
export interface CarryRecord { readonly previousRaw: string | null; readonly writtenRaw: string; readonly dwellMs: number }
export type CarryResult = { ok: true; record: CarryRecord } | { ok: false; reason: 'unreadable' | 'storage-failed' };
export function carryDwellToBoard(storage: StorageLike | undefined, dwellMs: number): CarryResult;
export type UndoResult = 'restored' | 'changed-since' | 'storage-failed';
export function undoCarry(storage: StorageLike | undefined, record: CarryRecord): UndoResult;
```
- `carryDwellToBoard`: `dwell = clamp(round(dwellMs / 50) × 50, 400, 3000)`. `readBoard`: `unreadable`
  returns `{ ok: false }` and writes nothing. `none` writes `{ version: 1, profile: { dwellTime },
  board: <the four Board defaults, as literals> }`. `ok` parses the stored JSON, sets
  `profile.dwellTime`, and re-serialises with every other field untouched.
- `undoCarry` restores `previousRaw` (or `removeItem` when it was `null`) only if the current raw
  value still equals `writtenRaw`; if the Board's settings changed since, it returns
  `'changed-since'` and writes nothing, so Undo never overwrites a later change.
- All storage access is in try/catch.
- **Contract test** (`board-link.contract.test.ts`): the one test that imports from the Board's
  source (`readSettings` from `apps/board/src/board-storage.ts`, a test file, outside the
  skeleton import boundary). It writes with `carryDwellToBoard` into an in-memory storage and
  asserts the Board's reader returns `usedDefault: false` with the carried dwell time, for both
  the `none` and the `ok` paths. If the Board's schema changes, this fails first.
### `seance-storage.ts`
`KEY_SEANCE = 'planchette-seance:settings'`, value `{ version: 1, profile: Partial<Profile> }`.
`readSeanceProfile(storage)` returns `{ profile, usedDefault }` and never throws: missing key, bad
JSON, a non-object, a wrong `version` or a non-object `profile` all return `{ profile: {},
usedDefault: true }`. `writeSeanceProfile` swallows a storage failure. Same behaviour as the Board's
`readJSON`/`writeJSON`, in about 30 lines of Séance's own.
`resolveInitialProfile(result)` returns `{ dwellTime: 2100 }` when `usedDefault`, else the saved
profile unchanged (Requirement 8 AC 4), as the Board's does.
### `seance-layout.ts`
```typescript
export interface Cell { readonly id: string; readonly row: number; readonly col: number; readonly colSpan: number; readonly kind: 'letter' | 'word' | 'decor' }
export const BOARD_CELLS: readonly Cell[]; // 29 targets + 5 decorative cells, per the "Game board" table
export const COLUMNS = 7, ROWS = 6;
export function boardExtent(targetSize: number, gap: number, gridWidth: number): { cellW: number; width: number; height: number };
export function insideRect(point: { x: number; y: number }, rect: Rect): boolean;
export function guardedTargets(ids: readonly string[], rects: ReadonlyMap<string, Rect>, pointer: { x: number; y: number } | null): { register: string[]; held: string[] };
```
`guardedTargets` is the arrival guard: with a known pointer, a target whose rect contains it goes
in `held`; the others in `register`. With `pointer === null` all register. The DOM calls it when
the view changes and again on each `pointer-move` while any target is held (cheap: at most a few
targets, no allocation beyond the two small arrays when something is held).
Fixed table ids: `letter-a` to `letter-z`, `yes`, `no`, `goodbye`; decorative cells have ids
`decor-*` and are never registered.
### `sound-plan.ts` and `sound.ts`
```typescript
export const SOUND_LIMITS = { maxGain: 0.12, minFadeS: 0.02, maxToneS: 0.6, minGapS: 0.15 } as const;
export interface Tone { readonly freq: number; readonly startS: number; readonly durS: number; readonly gain: number }
export type SoundEvent = 'hit' | 'complete';
export function planSound(event: SoundEvent, lastToneEndS: number, nowS: number): Tone[];
```
`hit`: one sine tone, 392 Hz, 0.25 s, gain 0.08, starting at `nowS`. `complete`: two sine tones, 392 Hz
then 523 Hz, 0.3 s each, gain 0.08; the first starts at `nowS`, the second at `nowS + 0.3 + minGapS`.
`planSound` returns `[]` when `nowS - lastToneEndS < minGapS`, and shifts nothing: a plan is either inside
the limits or empty. Miss, Undo and Stop play nothing.
`sound.ts` (`createSound(win)`) creates no `AudioContext` until `setOn(true)`. It schedules the tones
with `OscillatorNode` and a `GainNode` ramped in and out (`linearRampToValueAtTime`, 20 ms or
more). `setOn(false)` ramps any live gain to 0 within 20 ms and suspends the context. The wrapper is
about 40 lines and is tested with a fake `AudioContext`.
### `seance-dom.ts`
It draws the page from `BOARD_CELLS` and the Summary template, fills every `[data-text]` element
from `messages.ts`, registers targets, and runs the Round loop:
1. `select` event: if the Settings dialog is open or the event is stale (`seance-gate`), ignore.
   Route by `targetId`.
2. Board target: `stepRound`, then `stepSupport` with `hit` or `miss` (the Miss passes the current
   `getProfile().dwellTime`), then draw: spelled line, marker, level (`data-support` on `.page`),
   live-region text, sound for a `hit` or `complete`. On `complete` or `stopped`, go to the Summary.
3. Control targets: `stop` (`stepRound` with `stop`), `undo` (`stepRound` with `undo` in play;
   `undoCarry` in the Summary), `sound-toggle`, `suggest-apply` (`stepSupport` accept, then
   `setProfile`, then save), `suggest-dismiss`, `next-round`, `carry-dwell`, `camera-toggle`. A
   `cancel` event closes an open Suggestion (`dismiss`); otherwise it only resets the dwell, which
   the skeleton does itself.
4. View change: unregister the old set, compute `guardedTargets` for the new one with the last
   `pointer-move` position, register `register`, draw `held` dashed, release held targets as
   `pointer-move` events move the pointer out.
`registerTarget` rectangles come from `getBoundingClientRect()` after layout, as the Board does, and
are re-registered with `updateTarget` on resize.
### Shared input controls (`skeleton/src/ui`)
New public exports of `@planchette/skeleton/ui`, moved out of the Board with no behaviour change:
```typescript
export function mountInputControls(options: InputControlsOptions): InputControls;
export interface InputControlsOptions {
  readonly host: ControlsHost; readonly document: Document;
  readonly saveProfile: () => void; readonly firstRun?: boolean;
  readonly text: InputControlsText;   // every string; the skeleton holds none
}
export interface InputControls { setCameraOn(on: boolean): void; destroy(): void }
export function createSettingsGate(doc: Document): SettingsGate;
export function elementRect(el: HTMLElement): Rect;
export function roleOptionsOf(el: HTMLElement): { role: TargetRole } | undefined;  // data-role
export function createTargetRegistry(host, doc?): TargetRegistry;  // register/unregister/update elements
```
`mountInputControls` is `mountBoardControls` with the Board's `messages.controls` replaced by `text`
and the error text generalised. It expects the page ids the Board's page has (`mode`, `calibrate`,
`camera-status`, `controls-message`, `settings`, `settings-button`, `settings-message`, and the
`camera-toggle` target). `elementRect` and `roleOptionsOf` are the Board's `rectOf` and its role
lookup; `createTargetRegistry` adds register, unregister and re-measure over a map of ids to elements,
which Séance uses and the Board's `board-dom.ts` does not need (it calls the two helpers only, so its
`lastRects` slot-lock logic is untouched). The Board's `board-controls.ts` becomes a ten-line wrapper
that passes `messages.controls`; `settings-gate.ts` re-exports. The skeleton's `package-build` test
and `api` test list the new names.
### `seance-settings-dom.ts`
The behaviour is the Board's Requirement 13 and Requirement 6: the mode selector calls
`setMode`; the camera toggle is both a button and a target; a plain mouse click on the toggle also
works in non-mouse modes (with the same guard against a double toggle); a keyboard activation is
skipped in the two scan modes where Space is the switch; the Calibrate button is in the Settings
dialog and only works with the camera on; the first-run hint follows Board Requirement 13 AC 10 to
13. All of that is `mountInputControls`. Séance's own part is the Settings fields: Dwell time (number input, 400 to 3000, step 50, clamped on input), "Start
camera when the page opens" (checkbox), Calibrate, About (a few lines: what Séance is, the notice,
the version). The settings gate is the skeleton's `createSettingsGate`.
### `messages.ts`
All user-facing text, in one file. Wording rules: calm, friendly, no judging word (Requirement 3
AC 10). Examples: "The spirit is spelling…", "Next: L", "A longer hold may help. Try 2400 ms?",
"You stopped this round", "Accidental selections: a letter or word that was not the one the spirit
pointed to", "The Board now uses 2100 ms", and the notice: "Séance is a practice game. It is not a
medical device, not therapy, and not a replacement for an assessment by a speech-language
therapist." A test scans `messages.ts` for the judging words (wrong, fail, bad, lose, lost,
mistake, error, try harder) and for the language steering's banned stems.
## Target ids and roles
| Id | Role | Where | Registered |
| --- | --- | --- | --- |
| `letter-a` … `letter-z` (26) | `default` | board cells per the table | play view |
| `yes`, `no`, `goodbye` | `default` | board cells | play view |
| `stop` | `default` | side column, action row, column 0 | every view |
| `undo` | `undo` | action row, column 1 | every view |
| `cancel` | `cancel` | action row, column 2 | every view |
| `suggest-apply`, `suggest-dismiss` | `default` | suggestion row, columns 0 and 1 | only while a Suggestion is open; otherwise dashed placeholders at the same place |
| `camera-toggle` | `default` | camera row, column 0 | every view |
| `sound-toggle` | `default` | camera row, column 1 | every view |
| `rest-area` | `rest-area` | camera row, column 2 | every view |
| `next-round` | `default` | Summary, row 5, columns 4 to 6 | Summary |
| `carry-dwell` | `default` | Summary, row 5, columns 0 to 2 | Summary, only when offered (Requirement 5 AC 1); otherwise a text in its place |
No target auto-repeats (`autoRepeat: false` for all). Scan order: the skeleton's reading-order
default (no order passed).
## Views and viewport layout
Two views share the page. The page is two columns, as the Board's: the left column holds the
spelled-so-far line (80 px high, 48 px text, one line, scrolls inside if longer) over the board
or the Summary; the right column is the side column.
**Scaling.** The page is the Board's two-column page with no prediction strip, so it uses the same fit,
now shared from the skeleton (`renderedCellSize(profileSize, gap, 0, viewport, 80)`; the Board's
`board-scale.ts` re-exports it and its tests did not change). The page applies the result as
`--target-size` and `--target-gap` on the root; the grid is `8s + 5g` wide, so cells are `(8s - g) / 7`
wide and `s` high, and every target rectangle is read back from the page, not computed.
**Arithmetic at 1366 x 768 with the default sizes (s = 96, g = 16):**
- Horizontal: 12 + 848 + 16 + 478 + 12 = 1366. The grid is 848 px: 7 cells and 6 gaps of 16 px,
  so a cell is (848 - 96) / 7 = 107.4 px wide and 96 px high.
- Left column vertical: 80 (line) + 16 + (6 x 96 + 5 x 16 = 656) = 752; with 8 px top and bottom, 768.
- Side column (478 px, three cells of (478 - 32) / 3 = 148.7 x 96): suggestion row 96 + 16 + action row
  96 + 16 + camera row 96 = 320; Controls row 48, Status panel 112 and notice 112 plus three 16 px gaps =
  640 in all, 112 px less than the left column.
**At 1920 x 1080:** s = 148 (the left column limits: (1080 - 16 - 80 - 96) / 6 = 148), so the page is
8 x 148 + 96 + 502 = 1782 px wide, centred, and 1080 high. Cells are (1184 - 16) / 7 = 166.9 x 148.
Wide targets: YES and NO span 3 columns, GOODBYE 5. The tests read the rectangles from a real page at
both sizes (Task 16), and a property test (Property 18) checks the size rule.
**Summary view** (replaces the board; the line shows "Round complete: MOTH" or "You stopped this
round"): one bordered panel, `6s + 5g` high, filling the board's area at both sizes. Top to bottom: three
figure cards (letters, time, accidental selections) with the value at 0.75 s px, then the lines for what an
accidental selection is, taken back, and the input (with the Dwell time only in head + dwell), then the Board
line, then at the bottom the two actions in two columns three gaps apart: Carry on the left (only when
offered) and "Another round" on the right. At 1366 x 768 the actions are 376 x 96 px at (30, 646) and
(454, 646); the figures take the space between, so there is no large empty panel.
**Marker and support** (CSS only, driven by attributes the page sets):
- `[data-next="true"]` on the next target. Level 0: 4 px lantern border and halo. The spirit's
  planchette is one `#glide` element (an inline `<svg>`, `aria-hidden`) positioned by script at the next
  target's top-right corner (6 px in from the right, 4 px down; 24 px at level 0, 28 px at levels 1 and 2). It
  moves with a 600 ms transform transition only inside `@media (prefers-reduced-motion: no-preference)`; a new
  Round, a resize and a level change place it without a transition. It stays in the corner, clear of the
  label, which is centred (a 40 px letter in a 107 px cell ends at about 73 px from the left; the glyph starts
  at 77 px or later). Travelling, it passes over other cells for under a second and rests on none.
- `.page[data-support="1"]` and `"2"`: 8 px border, a 28 px glyph with a thicker stroke, and the callout in the line.
- `.page[data-support="2"]`: also unmarked letters switch from `--bone` to `--dim-text`
  (`#9a96a8`, 5.6:1 on `--surface`, 4.9:1 on `--surface-2`) and keep their borders. Dimming is a colour
  token, never `opacity`, so the contrast is exactly what the colour test computes. The marked target is
  told apart by a border 2x to 4x thicker, a halo and the glyph, not by colour alone.
- Dwell progress: `createDwellRing` with the `outline` shape. Scan highlight: `createScanHighlight`.
- Empty Suggestion slots: `visibility: hidden` (no border, no box, no focus), still in the grid.
## Theme
A candle-lit dark board. Tokens (all in `seance.css` `:root`; the values below are proposals whose
contrast against the surfaces was computed during design, and the colour test re-checks them):
| Token | Value | Use | Contrast on `--surface` / `--surface-2` |
| --- | --- | --- | --- |
| `--ground` | `#12141f` | page background (near-black blue, never #000) | n/a |
| `--surface` | `#1c2030` | board cells | n/a |
| `--surface-2` | `#262b40` | pressed, hover, Summary panels | n/a |
| `--bone` | `#f1ede2` | primary text | 13.8 / 12.0 |
| `--muted` | `#b9b4a6` | secondary text | 7.8 / 6.8 |
| `--dim-text` | `#9a96a8` | unmarked letters at Support level 2 | 5.6 / 4.9 |
| `--lantern` | `#f2b84b` | the marker, focus, dwell progress | 9.0 / 7.8 |
| `--moss` | `#8fae7e` | the planchette glyph's trim, decorative ring | 6.6 / 5.7 |
| `--edge` | `#6f7694` | target borders | 4.1 on `--ground`, 3.6 on `--surface` |
The skeleton's dwell outline uses its own fixed colours (white edge, `#111111` track, `#ffd400` arc). On
these dark cells the dark track is not itself visible against the surface; the white edge (3:1 or better
against `--edge`) and the arc (3:1 or better against the track) carry the progress, and the colour test checks
those two pairs. The Board's stricter track-against-background rule (its Requirement 9 AC 12) is not asked of
Séance.
The moon, fog and glow are CSS gradients on the page, behind the board, with `aria-hidden` and
contrast never taken below the table's. The marker is an outline and a glyph, so it is visible
without colour. A slow glow (opacity 0.85 to 1 over 4 s) on the glyph, the glide, and the fog's slow drift are the only motion; all of it is
off under `prefers-reduced-motion`. The fog is a soft ellipse (`radial-gradient(ellipse closest-side …, transparent 100%)`) with no edge. Fonts: `Georgia, 'Times New Roman', serif` for the spirit's
line, `system-ui` for the rest. The planchette glyph, moon and board border are original inline SVG
and CSS.
## Data models
| Key | Shape | Version | Written by |
| --- | --- | --- | --- |
| `planchette-seance:settings` | `{ version: 1, profile: Partial<Profile> }` | 1 | Séance, on a Profile change |
| `planchette-board:settings` | the Board's `{ version: 1, profile, board }` | 1 | Séance only on a Carry or its Undo |
Nothing else is stored. No Round, count, time, Message or Support level is ever written.
## Correctness properties
Each is a fast-check test (`apps/seance/test/<file>.props.test.ts`, 100 runs or more), tagged
`Feature: seance, Property N: …`. Generators draw Messages from the bundled list and input
sequences of `select` (any of the 29 Board targets, weighted toward the current Step's),
`undo`, `stop`, with non-decreasing and also arbitrary (possibly repeated or backwards)
timestamps.
1. **A Round always ends.** For any Message and any input prefix, `stop` ends the Round; and
   appending the correct target for each remaining Step (with increasing timestamps) ends it
   as complete. Once ended, every later input returns `[]` and changes nothing (absorbing).
2. **No double counting.** For any sequence, `hits + misses` equals the number of accepted
   `select` inputs (those with a timestamp later than the last accepted one, while playing).
   Feeding the same sequence twice in a row with the same timestamps adds nothing the second
   time. Control inputs never change `hits`, `misses` or `takenBack`.
3. **Progress is a prefix.** `0 <= index <= steps.length` always; `index <= hits`; the targets
   behind the standing Hits equal `steps.slice(0, index)`.
4. **A Miss never lowers the Support level.** Over any generated sequence of Support inputs,
   the level after a `miss` is `>=` the level before it.
5. **Support falls only on calm Hits.** The level never exceeds 2 or goes below 0; it
   decreases only on a `hit` that makes `hitStreak >= calmAfterHits`, by exactly 1; `miss`,
   `round-start`, `accept` and `dismiss` never decrease it.
6. **Suggestions are safe.** Any `suggest.ms` is `> dwellMs`, `<= 3000`, a multiple of 50, and
   appears at most once per Round (between two `round-start`s); no `apply-dwell` event is ever
   emitted except directly after `accept` with a Suggestion open; no event sequence without
   `accept` produces `apply-dwell`.
7. **Undo.** A `select` of the current target then `undo` restores `index`, leaves `misses`
   unchanged and adds 1 to `takenBack`; `undo` at `index 0` returns `[]` and changes nothing; no
   sequence makes `index` negative.
8. **Time.** Every `stepMs` entry is `-1` or `>= 0`; `endedAt - startedAt >= 0`; adding a constant
   to every timestamp (including `startedAt`) gives identical counts, `index` and `stepMs`; two runs
   that differ only in how many extra, ignored (stale-timestamp) inputs were interleaved give the
   same result (frame rate does not matter).
9. **Message choice.** `pickMessage` is deterministic for the same arguments; the result is in the
   bundled list (or YES, NO, GOODBYE on every 4th Round, in order); never equals `previousId`
   (word Rounds); Round 1 is a 3-letter word.
10. **The list is valid.** Every word: A to Z only, length 3 to 6, unique, no adjacent equal
    letters, not in the Board's offensive-word list; every letter A to Z appears at least once;
    `steps` equals `text` mapped to target ids and every id is in `BOARD_CELLS`.
11. **Carry.** With a spy storage: nothing is written until `carryDwellToBoard` is called. For any
    valid Board record: after a Carry, parsed JSON equals the original except `profile.dwellTime`
    (deep equal on everything else); the written dwell is 400 to 3000 and a multiple of 50. For any
    unreadable value (non-JSON, wrong version, wrong shape): `ok: false`, the value is unchanged.
    For a missing key: a record the Board's `readSettings` accepts. `undoCarry` after a Carry
    restores the exact previous raw value (or removes the key), and returns `changed-since`
    without writing when the stored value no longer equals `writtenRaw`.
12. **Séance storage.** For any string (valid JSON of any shape, truncated JSON, non-JSON) as the
    stored value, `readSeanceProfile` returns without throwing and yields a usable profile.
13. **Camera unavailable.** With a fake Planchette host, for each failure cause (permission denied,
    load failure, no face) and each of the scan and mouse modes, delivering `select` events for the
    correct targets completes a Round without throwing.
14. **No network.** With `fetch`, `XMLHttpRequest`, `WebSocket` and `sendBeacon` spied, running
    generated Rounds through the pure modules, `seance-storage.ts`, `board-link.ts` and
    `sound-plan.ts` makes no call.
15. **Sound plans.** For any event, `lastToneEndS` and `nowS`: every tone has `gain <= maxGain`,
    `durS <= maxToneS`, `durS >= 2 × minFadeS`, the first tone's `startS >= lastToneEndS + minGapS`, and each
    later tone starts at least `minGapS` after the previous tone ends; Miss,
    Undo and Stop are not `SoundEvent`s (no plan exists for them).
16. **Layout stability.** With a fake host recording `registerTarget`/`updateTarget`, across
    generated sequences of Rounds, Support levels, mode changes and Sound toggles, every Board
    target is registered at the same id and rectangle whenever it is registered (the rectangle is
    a function of the viewport only); every rectangle is at least the target size and the gaps are
    at least the target spacing.
17. **Arrival guard.** For any rect set and any pointer position, `guardedTargets` puts exactly
    the targets whose rect contains the pointer into `held` and the rest into `register`; with
    `null` it holds none; after a `pointer-move` outside a held rect, that rect is released.
18. **Rendered cell size.** For any viewport of 1366 x 768 or more and any gap, `seanceCellSize` is at least the
    Profile size; where the page fits at the Profile size it fits at the chosen size, and one px more would not
    fit; it never decreases as the viewport grows.
## Error handling
| Case | Behaviour |
| --- | --- |
| Camera permission denied, MediaPipe load failure, no face | The Board's behaviour: plain-language message in the Status panel, the toggle reads "Start camera", scanning and mouse still work (Requirement 7 AC 7) |
| `localStorage` unavailable or full | The Séance Profile is not saved; the page keeps working. A Carry shows "The Board's settings could not be saved. Nothing was changed." |
| Séance key corrupt | Defaults, silently (Requirement 8 AC 5) |
| Board key unreadable | No Carry offered; the Summary says the Board's settings could not be read and nothing was changed |
| Board key changed since the Carry | Undo does nothing and says so; no overwrite |
| `AudioContext` constructor missing or throws | Sound stays off; the toggle reads "Sound off"; nothing else changes |
| A selection arrives with an old timestamp | Ignored (Requirement 2 AC 2) |
## Testing strategy
**Unit** (`apps/seance/test/*.test.ts`, Vitest): the message list, `pickMessage` examples (Round 1,
Round 4 = YES, 8 = NO, 12 = GOODBYE), `stepRound` and `stepSupport` examples including the spec's
thresholds, `summarise`, `canOfferCarry` (each of its four conditions alone), `board-link` (the three
read states, Carry, Undo, storage throwing), the contract test with the Board's reader,
`seance-storage`, `seance-layout` (cell table, no overlap, extent at 1366 and 1920, spans), the
judging-word and banned-stem scan of `messages.ts`, jsdom tests of the shared controls in `skeleton/test` (first-run hint
shows and clears; `startCamera` never called), the Settings dialog, the sound wrapper with a fake
`AudioContext` (none created before `setOn(true)`), the colour contrast test over the `seance.css`
tokens (every pair in Requirement 10 AC 3, including level 2), and `skeleton-imports.test.ts` (the
Board's test, pointed at `apps/seance/src`).
**Property** (`*.props.test.ts`): Properties 1 to 17 above. Properties 1 to 9 and 11 to 12 are
pure; 13 and 16 use a fake host; 14 spies globals.
**End-to-end** (Playwright, `apps/seance/test/*.e2e.ts`, projects `seance` (dev server) and
`seance-built` (built output, so the CSP is checked there too)):
- `seance-round.e2e.ts`: mouse mode. Finds the next target through `[data-next="true"]`, clicks it,
  plays a full Round; checks the spelled line, the Summary figures, "Another round"; Stop; Undo;
  a Miss (clicking a wrong letter) raises the count, adds no penalty text, and after enough Misses
  the level and the Suggestion appear; "Not now" and "Hold longer" (the Profile's dwell changes only
  on the latter); Carry in head + dwell mode (mode set through the selector, selection fed with
  `planchette.feedSamples` through `window.planchetteSeance.planchette`, no camera) with the Board
  key unchanged until the press, then Undo.
- `seance-scan.e2e.ts`: scan mode. Space as the switch; the test presses Space until the
  highlighted target (read from the skeleton's highlight, as `board.e2e.ts` does) is the next
  target, then plays a short Round to the Summary.
- `seance-a11y.e2e.ts`: axe-core on every view (Requirement 16 AC 4), `prefers-reduced-motion`
  emulated (no running animation), tab order, accessible names.
- `seance-viewport.e2e.ts`: at 1366×768 and 1920×1080, no scroll and all targets inside the
  viewport, in play, play with the Suggestion open, Summary completed, Summary stopped.
- `seance-privacy.e2e.ts`: no `getUserMedia` call; no `AudioContext` until Sound is pressed; no
  request to any other origin (a `page.on('request')` list); `localStorage` keys are only the two
  allowed; the Board key is unchanged until Carry.
Playwright config gains the two projects, like the Board's (`testDir: 'apps/seance/test'`), and
`apps/seance/test/playwright-config.test.ts` pins them.
**Layout validation** (below).
## Layout validation (dwell-sim-mcp)
Why this belongs in the design: the game asks the player to find a letter and then point at it,
which is the `reads-while-pointing` situation the Board's gate was built for. A search across a
grid of 26 equal cells is more exposed to it than the Board's grouped layout.
**Export.** `tools/dwell-sim-mcp/scripts/export-seance-layout.ts` (pattern: `export-board-layout.ts`)
serves the built `dist/seance/index.html`, opens it at 1920×1080 and 1366×768 and reads
`window.planchetteSeance.planchette.getTargets()`:
- `seance-layout-play-<size>.json`: the playing view at Support level 0 (29 Board targets and the
  side column; the suggestion targets are not registered).
- `seance-layout-summary-<size>.json`: the Summary after a completed Round in head + dwell (so
  `carry-dwell` is registered). The script plays a 3-letter Round through the page's own Planchette
  with `feedSamples` (head + dwell, no camera: timestamps start at `performance.now()` plus a margin
  and increase), then reads the targets. If this proves unworkable, the task stops and asks; it does
  not add a test-only switch to the app.
Four files, next to the Board's, with the same `{ screen, targets }` shape.
**Run.** `run-seance-presets.ts` imports `runDemoPresets` the way `run-board-presets.ts` does, passes
the four layouts, `{ eachTarget: 2 }`, and the profile `{ dwellTime: 2100 }`, and runs the six
presets. Entries go to `docs/kiro-journal.md` and a table to `docs/seance-gate.md`.
**Gate.** `reads-while-pointing` `accidentalPer100Intended <= 10` on all four layouts at 2100 ms, for
seed 1 and for the worst of seeds 1 to 10. This is the rule the Board's final default was chosen by.
Séance keeps the Board's 2100 ms as its default because the person practising here is likely to
use the Board next; the gate is what tells us whether 2100 ms is also right for this layout.
**If the gate is missed**, the work stops and reports the preset, layout, seed, rate and the causes
(the simulator's cause labels), with options. It does not try other dwell times on its own, change the
layout, or loosen the number. Options to put to the user in that case: a different default dwell (with
the Board's sweep method), more space between letter rows, grouping the letters in blocks with a wider
gap, or a rest strip inside the grid.
**Counterexamples.** An accidental selection whose cause is not `reading-pause` at a low rate is
pinned in `apps/seance/test/layout-regressions.test.ts` (optional, as the Board's 36.3) and logged.
## Notes and open questions
1. **App B (decided by the user at review): Séance replaces `apps/game`.** See Requirement 18. Original
   note: `product.md`, `structure.md`, `tech.md` and the README
   name App B as `apps/game`, "a hands-free haunted target game (aim and time, no text)", at `/game/`,
   with its game design deferred to a later spec. Séance is a text-spelling game at `/seance/`. This
   spec does not touch the stub or the steering files. Proposed: Séance becomes the second app; the
   `apps/game` stub and `/game/` page are removed, and the three steering files and README are
   updated, in one small change after you approve. Alternative: keep `apps/game` as a future third
   app. Either way `vite.config.ts` gains a `seance` page in Task 1.
2. **"Measured dwell time" (confirmed at review).** Read as: the Dwell time in force when the Round ended (after
   any accepted Suggestion), offered only for a completed head + dwell Round. It is what the person
   used, shown beside their accidental count, and not an estimate of their best setting. An
   alternative is to derive a recommendation from per-letter times; I did not, because per-letter
   time says little about accidental selections.
3. **Controls are shared (decided at review).** They move into `skeleton/ui` (Requirement 17) before
   Séance's controls are built. Risk: the move touches the skeleton's public API and the Board; the
   Board's unchanged tests are the check.
4. **Gate rule.** "Same ≤ 10 per 100 rule" is read as the Board's final rule: worst of seeds 1 to 10
   at the default dwell. The Board's earlier gate used seed 1 only, which this includes.
5. **Alphabetical, not the Board's frequency order (confirmed at review).** Chosen for a first-time player. If you want
   motor memory to carry into the Board's letter board, the cell table can use the Board's order
   instead; the 6-column table would change the geometry above.
6. **Sound is never saved.** Off on every load, per product.md ("sound off until the player turns it
   on"), at the cost of pressing it each visit.
7. **Camera on load (decided at review): kept**, default off, as in the Board.
8. **"Accidental selection" wording.** The Summary uses the brief's term and defines it as "not the
   one the spirit pointed to". A player who is exploring would not call that accidental; the
   definition line keeps the term honest.
9. **No scaling to the viewport in the first cut.** At 1920×1080 the page stays at its 1366-wide size,
   centred (optional Task O1, which may reuse the Board's scale logic if the shared controls make that natural). The gate still exports a 1920×1080 layout, so it measures what is shown.
