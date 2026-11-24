# Implementation Plan: communication board (App A)

## Overview

Tasks build the pure stores first (Message/undo, core vocabulary, letter board,
prediction, quick phrases, storage, speech), each with its unit and property tests,
then wire them together behind the DOM layer, then add the data files
(`THIRD_PARTY.md` entries), then the Playwright/axe-core end-to-end suite, and finish
with the dwell-sim-mcp layout validation gated on the `reads-while-pointing`
acceptance target from design.md. Each task names the file(s) it writes and the test
file next to it. Unit tests are `apps/board/test/<thing>.test.ts`, property tests are
`<thing>.props.test.ts`. Each of the fourteen properties in design.md is its own
required sub-task, placed right after the component it checks.

Convert the feature design into a series of prompts for a code-generation LLM that
will implement each step with incremental progress. Make sure that each prompt builds
on the previous prompts, and ends with wiring things together. There should be no
hanging or orphaned code that isn't integrated into a previous step. Focus ONLY on
tasks that involve writing, modifying, or testing code.

## Tasks

- [ ] 1. Core-vocabulary and letter-board data

  - [-] 1.0 Wire apps/board into the workspace.
    - Create `apps/board/package.json`: `"private": true`, `"type": "module"`, name
      `@planchette/board`, dependency `@planchette/skeleton` `*` (as
      `tools/dwell-sim-mcp` does), devDependencies `vitest` 5.1.1, `fast-check` 4.10.3,
      `typescript` 7.0.2 (the exact versions `skeleton/package.json` uses) and
      `@types/node` 24.19.2 (for the import-boundary test), and
      `"test": "vitest run --passWithNoTests"`.
    - Create `apps/board/tsconfig.json`: same strict options as
      `tools/dwell-sim-mcp/tsconfig.json` (`noEmit`, `moduleResolution: bundler`,
      `noUnusedLocals`, and so on), `paths` mapping `@planchette/skeleton` to
      `../../skeleton/src/index.ts` and `@planchette/skeleton/ui` to
      `../../skeleton/src/ui/index.ts`, `types: ["node"]`, `include` `src` and `test`.
    - Create `apps/board/vitest.config.ts`: `resolve.alias` for both skeleton names to
      the skeleton source (the `/ui` alias listed first so it wins), `test.include`
      `test/**/*.test.ts`.
    - Root `package.json`: add `apps/board` to `workspaces`; append
      `&& tsc --noEmit -p apps/board/tsconfig.json` to `typecheck`; add
      `--workspace=apps/board` to the workspace list in `test`. Run `npm install` so
      the lockfile picks up the new workspace.
    - Leave `vite.config.ts` as is: it already aliases both skeleton names and has the
      `board/index.html` page input. Confirm `npm run build` still produces
      `dist/board/index.html` with the new package present.
    - Write `apps/board/test/skeleton-imports.test.ts`: read every `.ts` file under
      `apps/board/src` and collect each import/export/dynamic-import specifier; every
      specifier that mentions `skeleton` is exactly `@planchette/skeleton` or
      `@planchette/skeleton/ui`; none contains a relative path into `skeleton/` or a
      `@planchette/skeleton/` subpath other than `ui`. Test it against a small inline
      sample with a violating specifier to show the check fails when it should.
    - _Requirements: none (build and test infrastructure)_

  - [ ] 1.1 Write the fixed core-vocabulary table.
    - Create `apps/board/src/core-vocabulary.ts`: the `CoreButton` type and the
      `CORE_VOCABULARY` literal array (the 36 Universal Core vocabulary words, CC BY
      4.0, CLDS/UNC, alphabetical row-major into a fixed 6×6 grid), per design.md
      "Components and Interfaces" → `core-vocabulary.ts`.
    - Write `apps/board/test/core-vocabulary.test.ts`: exactly 36 entries; every word
      from the Core word list in requirements.md is present exactly once; every `row`
      is 0–5 and every `col` is 0–5; no two entries share a `(row, col)`.
    - _Requirements: 2.1, 2.2_

  - [ ] 1.2 Write the fixed letter-board table.
    - Create `apps/board/src/letter-board.ts`: the `LetterKey` type and the
      `LETTER_BOARD` literal array (26 letters in frequency order E T A O I N S H R D
      L C U M W F G Y P B V K J X Q Z, then Space, then Backspace, fixed 6×5 grid).
    - Write `apps/board/test/letter-board.test.ts`: exactly 28 entries (26 letters +
      Space + Backspace); the letter order matches the documented frequency order
      exactly; every `(row, col)` is unique.
    - _Requirements: 3.3_

  - **Covers:** Req 2 AC 1, 2; Req 3 AC 3; build and test wiring (1.0).

- [ ] 2. Message model and undo

  - [ ] 2.1 Implement `createBoardModel`.
    - Create `apps/board/src/board-model.ts`: the `BoardAction` type, `BoardModel`
      interface, and `createBoardModel` (dispatch, undo, canUndo, subscribe), per
      design.md's spacing-insertion, backspace (word vs. letter), and no-op rules,
      with a bounded (cap 50) undo stack.
    - Write `apps/board/test/board-model.test.ts`: word-append inserts one space only
      when needed; letter/space append insert no extra space; grid-mode backspace
      removes the last word; spell-mode backspace removes one character; `partialWord` grows with each letter, resets on
      add-word, add-space, clear, replace, and grid-mode backspace, and shrinks by
      one on spell-mode backspace, and undo restores it with the message; Backspace,
      Speak, and Clear are no-ops on an empty message and push nothing onto the undo
      stack; `replace` (quick phrase) replaces the whole message.
    - _Requirements: 1.2, 1.4, 1.5, 1.6, 3.4, 3.5, 3.6, 7.2_

  - [ ]* 2.2 Write the property test for Clear then undo.
    - In `apps/board/test/board-model.props.test.ts`, generate arbitrary message
      strings (including empty, whitespace-only, and unicode) and assert
      `dispatch({type:'clear'})` then `undo()` restores the exact original message.
    - **Property 2: Clear then undo is identity**
    - **Validates: Requirements 1.6, 1.7**

  - [ ]* 2.3 Write the property test for any undoable action then undo.
    - In the same file, generate an arbitrary message and an arbitrary non-no-op
      `BoardAction`; assert dispatch-then-undo restores the exact original message.
    - **Property 3: Any undoable action then undo is identity**
    - **Validates: Requirements 1.4, 1.5, 1.7, 7.2**

  - **Covers:** Req 1 AC 2, 4, 5, 6, 7; Req 3 AC 4, 5, 6; Req 7 AC 2; P2, P3.

- [ ] 3. Checkpoint - message model complete
  - Run the root `npm test` (typecheck, build, then every workspace's tests, including
    `apps/board`) and confirm the Task 1–2 tests pass. Ensure all tests pass, ask the user
    if questions arise.

- [ ] 4. Bundled prediction word list

  - [ ] 4.1 Verify the licence, then generate the bundled word-list asset.
    - **First step, before anything is copied or built:** fetch the README of
      <https://github.com/hermitdave/FrequencyWords> and confirm it still states
      "CC-by-sa-4.0 for content" (and MIT for code). If it does not say CC BY-SA, **stop
      and tell the user**; do not copy the file or run the build.
    - Commit an unmodified copy of `content/2018/en/en_50k.txt` as
      `apps/board/data/source/en_50k.txt` (no download at build or run time).
    - Write `apps/board/scripts/build-prediction-word-list.ts`: reads only that
      committed file and writes `apps/board/data/prediction-word-list.json`
      (`{ word: normalisedFrequency }`). Rules, in order: lower-case; keep only
      entries of a-z and apostrophes with length 2 or more; drop every
      `CORE_VOCABULARY` word; keep the first 5,000 remaining entries in source order;
      frequency is `1 / (rank + 1)` scaled to [0, 1].
    - Write `apps/board/data/prediction-word-list.LICENSE.md`: the CC BY-SA 4.0 notice
      (source repository and file, author Hermit Dave, OpenSubtitles 2018 via OPUS,
      link to <https://creativecommons.org/licenses/by-sa/4.0/>, the changes made:
      trimmed, lower-cased, filtered, re-ranked, and that the result is shared under
      CC BY-SA 4.0).
    - Write `apps/board/test/build-prediction-word-list.test.ts`: the JSON has exactly
      5,000 entries given the committed source; no entry equals a `CORE_VOCABULARY`
      word; every key matches `/^[a-z']{2,}$/`; frequencies are strictly decreasing
      with rank; the build reads no network (spy on `fetch`); the licence file exists
      next to the JSON and contains "CC BY-SA 4.0", "Hermit Dave", and "OpenSubtitles".
    - _Requirements: 4.3, 4.8_

  - [ ] 4.2 Record both data sources in THIRD_PARTY.md.
    - Add to `THIRD_PARTY.md` (matching the style of the existing "Model files"
      section) a "Data files" entry for the prediction word list: file path, size
      (5,000 entries), licence CC BY-SA 4.0 (the derivative stays CC BY-SA 4.0; the
      Board's code is MIT), author Hermit Dave, OpenSubtitles 2018 via OPUS, the
      changes made, and links to <https://github.com/hermitdave/FrequencyWords> and
      the licence. Add an entry for the Universal Core vocabulary (CC BY 4.0, CLDS/UNC,
      <https://www.med.unc.edu/healthsciences/clds/universal-core-vocabulary/>).
    - Write `apps/board/test/third-party-board.test.ts`: `THIRD_PARTY.md` contains
      "FrequencyWords", "Hermit Dave", "CC BY-SA 4.0", and "5,000" for the word list
      entry, and "Universal Core vocabulary" and "CC BY 4.0" for the core-vocabulary
      entry.
    - _Requirements: 2.5, 4.8_

  - **Covers:** Req 2 AC 5; Req 4 AC 3, 8.

- [ ] 5. Prediction strip model

  - [ ] 5.1 Implement `createPredictionStrip`.
    - Create `apps/board/src/prediction.ts`: `SlotState`, `SlotLock`,
      `PredictionStrip`, `createPredictionStrip`, the ranking formula
      (`normalizedFreq + recencyWeight`), the core-exclusion filter, the prefix rule
      (non-empty `partialWord`: only words starting with it, history words first), and
      the lock-respecting fill rule from design.md; `recompute(message, partialWord,
      isLocked)`.
    - Write `apps/board/test/prediction.test.ts`: with an empty history, ranking
      follows word-list frequency only; with a history entry, that word's score rises;
      a slot held locked across two `recompute` calls keeps its original word even
      when a higher-ranked candidate becomes available; `predictionSlotCount` at 2 and
      at 8 both produce a slots array of that exact length; a ranked list shorter than
      `slotCount` leaves the remaining unlocked slots `null`; with partial word `"he"`,
      a spoken `"hello"` ranks ahead of a higher-frequency bundled `"help"`, and no
      candidate lacks the prefix; clearing the partial word returns to the
      whole-message ranking.
    - _Requirements: 4.1, 4.2, 4.6, 4.7, 4.9, 4.10, 4.11_

  - [ ]* 5.2 Write the property test for locked-slot stability.
    - In `apps/board/test/prediction.props.test.ts`, generate a message/word-list/
      history and an arbitrary subset of slot indices marked locked; call `recompute`
      and assert every locked slot's `word` is unchanged.
    - **Property 4: Prediction never changes a locked slot**
    - **Validates: Requirements 4.1, 4.5**

  - [ ]* 5.3 Write the property test for unlocked-slot filling.
    - In the same file, assert every unlocked slot's word is absent from
      `CORE_VOCABULARY`, appears in no other slot, and unlocked slots are filled in
      non-increasing rank order.
    - **Property 5: Unlocked slots are filled from the ranked, deduplicated, core-excluding list**
    - **Validates: Requirements 4.3, 4.6, 4.7**

  - [ ]* 5.4 Write the property test for recency monotonicity.
    - In the same file, generate a word `w` and two histories `h1`, `h2` where `h2`
      adds one more spoken occurrence of `w` to `h1`; assert `w`'s rank under `h2` is
      at or above its rank under `h1`.
    - **Property 6: Speaking a word never decreases its future rank**
    - **Validates: Requirements 4.7**

  - [ ]* 5.5 Write the property test for prefix predictions.
    - In `apps/board/test/prediction.props.test.ts`, generate a word list, a history,
      a non-empty partial word (letters, mixed case), and an arbitrary locked-slot
      subset; call `recompute` and assert every word in every slot starts with the
      partial word (case-insensitive), and every history word with that prefix that
      fits in the unlocked slots is placed ahead of every list-only word.
    - **Property 14: Prefix predictions start with the partial word**
    - **Validates: Requirements 4.10, 4.12**

  - **Covers:** Req 4 AC 1, 2, 6, 7, 9, 10, 11, 12; P4, P5, P6, P14.

- [ ] 6. Storage layer

  - [ ] 6.1 Implement `readJSON` / `writeJSON` and the storage keys.
    - Create `apps/board/src/board-storage.ts`: `StorageResult`, `readJSON`,
      `writeJSON`, and typed helpers for the four keys in design.md's "Storage keys,
      schema, and limits" table (`planchette-board:message`,
      `planchette-board:history`, `planchette-board:quick-phrases`,
      `planchette-board:settings`), each with its documented default, version number,
      and size cap.
    - Write `apps/board/test/board-storage.test.ts`: a missing key returns the
      documented default with `usedDefault: true`; a write then read round-trips a
      valid value; `writeJSON` does not throw when `localStorage.setItem` throws (a
      stub that throws `QuotaExceededError`); history and quick-phrases caps evict the
      oldest/least-recent entry once exceeded.
    - _Requirements: 10.3, 10.4_

  - [ ]* 6.2 Write the property test for corrupt-storage fallback.
    - In `apps/board/test/board-storage.props.test.ts`, generate arbitrary strings
      (non-JSON text, valid JSON of the wrong shape, JSON missing `version`, JSON
      exceeding a key's size cap) as the stored raw value for each of the four keys;
      assert `readJSON` returns the documented default, `usedDefault: true`, and does
      not throw, and that a subsequent `dispatch`-equivalent call on the resulting
      default also does not throw.
    - **Property 12: Corrupt or partial storage never throws and falls back to the documented default**
    - **Validates: Requirements 10.4**

  - **Covers:** Req 10 AC 3, 4; P12.

- [ ] 7. Checkpoint - prediction and storage complete
  - Run the full `apps/board` unit and property test suite. Ensure all tests pass,
    ask the user if questions arise.

- [ ] 8. Quick phrases store

  - [ ] 8.1 Implement `QuickPhrasesStore`.
    - Create `apps/board/src/quick-phrases.ts`: `QuickPhrase`, `QuickPhrasesStore`,
      backed by `board-storage.ts`'s `planchette-board:quick-phrases` key, seeded on
      first run from a short built-in starter list defined in `messages.ts`
      (Task 9.1).
    - Write `apps/board/test/quick-phrases.test.ts`: `add`/`update`/`remove` change
      only the targeted entry; `reorder` changes only the order, not the content;
      selecting a quick phrase (via `board-model.dispatch({type:'replace', ...})`,
      wired in Task 10) does not call any `QuickPhrasesStore` mutator.
    - _Requirements: 7.1, 7.2_

  - [ ]* 8.2 Write the property test for quick-phrase order stability.
    - In `apps/board/test/quick-phrases.props.test.ts`, generate a quick-phrases list
      and a sequence of Board actions that never calls `add`/`update`/`remove`/
      `reorder`; assert the order of phrase ids is unchanged after the sequence.
    - **Property 11: Quick-phrase order is stable under non-edit actions**
    - **Validates: Requirements 7.4**

  - **Covers:** Req 7 AC 1, 2, 4; P11.

- [ ] 9. Speech output

  - [ ] 9.1 Write `messages.ts` (user-facing text) and `speech.ts`.
    - Create `apps/board/src/messages.ts`: every Board-facing string in one place
      (per structure.md), including the not-a-medical-device notice, the
      speech-unavailable message, the quick-phrases starter list, and Settings labels.
    - Create `apps/board/src/speech.ts`: `pickLocalVoice`, `speak`, per design.md.
    - Write `apps/board/test/speech.test.ts`: `pickLocalVoice` with a fake voice list
      containing only `localService: false` entries returns `null`; with a mix,
      returns a `localService: true` entry; `speak` with a `null` voice resolves
      `{ spoken: false }` and never calls `synth.speak`; `speak` with a voice calls
      `synth.speak` exactly once with the given rate and voice.
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ]* 9.2 Write the property test for local-service-only voice selection.
    - In `apps/board/test/speech.props.test.ts`, generate arbitrary voice lists
      (0–10 entries, random `localService` booleans and `voiceURI` strings) and a
      `preferredURI`; assert `pickLocalVoice` never returns a `localService: false`
      voice and returns `null` only when no local-service voice exists.
    - **Property 9: Local-service-only voice selection**
    - **Validates: Requirements 8.1, 8.2, 8.4**

  - [ ]* 9.3 Write the property test for voice/rate application.
    - In the same file, generate arbitrary `BoardOnlySettings` and messages; assert
      every `speak()` call's utterance uses the resolved voice and the configured
      rate.
    - **Property 10: Chosen voice and rate are used on every speak call**
    - **Validates: Requirements 8.4, 8.5**

  - **Covers:** Req 8 AC 1, 2, 3, 4, 5; P9, P10.

- [ ] 10. Wire the pure stores: history updates and settings model

  - [ ] 10.1 Implement `board-settings.ts` and the history-update rule.
    - Create `apps/board/src/board-settings.ts`: `BoardOnlySettings`,
      `BoardProfileFields`, `BoardExport`, export/import functions that call the
      skeleton's `exportProfile`/`importProfile` for the `profile` part and apply the
      same clamp-or-default-and-report rule to `predictionSlotCount` (2–8) and
      `speechRate` (0.5–2.0).
    - In `apps/board/src/main.ts` (first version: wiring only the pure stores, no DOM
      yet), add the rule that a word is appended to the Spoken-word history only after
      a `speak()` call resolves `{ spoken: true }`, splitting the spoken message on
      whitespace.
    - Write `apps/board/test/board-settings.test.ts`: export then import an in-range
      `BoardExport` returns an equal object; `resolveInitialProfile`: with a saved
      or imported profile whose `dwellTime` is 1000 the board keeps 1000, and with a
      saved `dwellTime` of 1400 or 600 it keeps that value; with no saved profile
      (`usedDefault: true`) it applies 1400; an out-of-range `predictionSlotCount`
      (for example 1 or 9) is clamped to 2 or 8 on import and reported; a missing
      `speechRate` falls back to 1.0 and is reported.
    - Write `apps/board/test/main-history.test.ts`: selecting a predicted word alone
      does not change history; a `speak()` call that resolves `spoken: true` adds each
      word of the message to history; a `speak()` call that resolves `spoken: false`
      does not change history.
    - Also in `board-settings.ts`: `resolveInitialProfile(saved)` per design.md
      "Design levers used", lever 1; `main.ts` calls it before the first `setProfile`.
    - _Requirements: 4.4, 4.9, 6.2, 6.3, 6.5, 6.6, 6.7, 8.6, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [ ]* 10.2 Write the property test for settings export/import round trip and clamping.
    - In `apps/board/test/board-settings.props.test.ts`, generate arbitrary valid
      `BoardExport` values and arbitrary malformed ones (out-of-range or wrong-typed
      `board` fields); assert the round-trip and clamp-or-default behaviour from
      design.md Property 7.
    - **Property 7: Settings export/import round trip and clamping**
    - **Validates: Requirements 6.5, 6.6, 6.7, 11.1, 11.2, 11.3**

  - [ ]* 10.3 Write the property test for history updates on successful speech only.
    - In `apps/board/test/main-history.props.test.ts`, generate a sequence of
      predicted-word selections and `speak()` calls with randomised `spoken` results;
      assert history changes exactly for the `spoken: true` calls.
    - **Property 8: Spoken-word history updates only on successful speech**
    - **Validates: Requirements 4.4, 4.9, 8.1, 8.2, 8.6**

  - **Covers:** Req 4 AC 4, 9; Req 6 AC 2, 3, 5, 6, 7; Req 8 AC 6; Req 11 AC 1–6; P7, P8.

- [ ] 11. Checkpoint - all pure stores complete
  - Run the root `npm test` (includes `apps/board`) and `npm run typecheck`.
    Ensure all tests pass, ask the user if questions arise.

- [ ] 12. No-network property across the pure layer

  - [ ]* 12.1 Write the no-network property test.
    - In `apps/board/test/no-network.props.test.ts`, spy on global `fetch`,
      `XMLHttpRequest`, `WebSocket`, and `navigator.sendBeacon`; generate a sequence of
      Board actions and drive them through `board-model.ts`, `prediction.ts`,
      `quick-phrases.ts`, `board-settings.ts`, `board-storage.ts`, and `speech.ts`
      (with a fake `SpeechSynthesis`); assert zero calls to any of the four spies.
    - **Property 13: No network calls**
    - **Validates: Requirements 10.1, 10.3**

  - **Covers:** Req 10 AC 1, 3; P13.

- [ ] 13. DOM layer: Message bar, action row, and target registration

  - [ ] 13.1 Implement the Message bar and action targets.
    - Create `apps/board/src/board-dom.ts`: renders the Message bar, and registers
      `speak`, `backspace-action`, `clear`, `spell-toggle` targets (role `default`),
      `undo` (role `undo`), `cancel` (role `cancel`), and `rest-area` (role
      `rest-area`), per design.md's target table. Wires `select` events on these ids
      to the matching `board-model` call.
    - Update `apps/board/src/main.ts`: create the `Planchette` (screen size,
      `assetsUrl`, `trackingIndicator`), `createBoardModel`, and call into
      `board-dom.ts` to mount.
    - Update `board/index.html`: add the Message bar and action-row markup (mirroring
      `index.html`'s structure), the same Content-Security-Policy meta tag already
      present, and a `<link rel="stylesheet">` to a new `apps/board/demo.css`-style
      sheet (plain, calm styling, no spooky theme, per Requirement 9 AC 7).
    - Write `apps/board/test/board-dom-actions.test.ts` (jsdom, using a fake
      `Planchette` host that records `registerTarget`/`select` wiring, not a real
      browser): each action target id maps to exactly one `board-model` call; Cancel
      and Undo targets exist with the correct roles.
    - _Requirements: 1.1, 1.3, 1.8, 1.9, 5.5, 5.6, 5.7, 9.9, 9.10_

  - **Covers:** Req 1 AC 1, 3, 8, 9; Req 5 AC 5, 6, 7; Req 9 AC 9, 10.

- [ ] 14. DOM layer: core-vocabulary grid and Spell mode

  - [ ] 14.1 Render the Core-vocabulary grid and register its targets.
    - Extend `board-dom.ts`: render `CORE_VOCABULARY` as a fixed 6×6 grid of buttons
      (`data-planchette-target="core-<id>"`), sized and spaced from the current
      Board/skeleton profile's `targetSize`/`targetSpacing` (CSS custom properties, as
      the skeleton demo does), and register each as a `default`-role target wired to
      `board-model.dispatch({type:'add-word', text})`.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 9.1, 9.2_

  - [ ] 14.2 Render the Letter board and Spell-mode toggle.
    - Extend `board-dom.ts`: on `spell-toggle` selection, unregister the
      core-vocabulary targets and register `LETTER_BOARD` targets instead (letters →
      `dispatch({type:'add-letter', char})`, Space → `add-space`, Backspace →
      `backspace`), and the reverse on toggling back, per design.md's "Input-mode
      integration" table.
    - Write `apps/board/test/board-dom-grid.test.ts` (fake `Planchette` host): exactly
      36 targets registered in core-grid mode with ids matching `CORE_VOCABULARY`;
      exactly 28 in Spell mode matching `LETTER_BOARD`; toggling Spell mode twice
      returns to the exact same 36 core target registrations (same ids, rects,
      labels).
    - _Requirements: 3.1, 3.2_

  - [ ]* 14.3 Write the property test for fixed-grid position stability.
    - In `apps/board/test/board-dom-grid.props.test.ts`, using the fake `Planchette`
      host, generate a sequence of Board actions, Spell-mode toggles, Settings
      changes, and resize events; assert every `CORE_VOCABULARY` target's recorded
      `(row, col, label)` is unchanged whenever Spell mode is off both before and
      after the sequence, and every `LETTER_BOARD` target's is unchanged whenever
      Spell mode is on both before and after.
    - **Property 1: Fixed-grid position stability**
    - **Validates: Requirements 2.2, 2.3, 2.4, 3.3, 3.7**

  - **Covers:** Req 2 AC 1–4; Req 3 AC 1, 2; Req 9 AC 1, 2; P1.

- [ ] 15. Checkpoint - grid and Spell mode complete
  - Run the full `apps/board` test suite including the new DOM-layer tests. Ensure
    all tests pass, ask the user if questions arise.

- [ ] 16. DOM layer: Prediction strip wiring

  - [ ] 16.1 Register Prediction-strip targets and implement the slot-lock rule.
    - Extend `board-dom.ts`: render `predictionSlotCount` fixed-position slots,
      register `prediction-slot-<i>` targets (unselectable / no target when the slot's
      word is `null`), and implement `isLocked` from `pointer-move`'s last target hit,
      the current `highlight` event's `targetIds`, and a short pending-press flag
      cleared on the next animation frame, exactly as design.md specifies. Call
      `predictionStrip.recompute(message, partialWord, isLocked)` on every
      `board-model` change of message or `partialWord`.
    - Wire a `prediction-slot-<i>` selection to
      `dispatch({type:'add-word', text: slots[i].word})`.
    - Write `apps/board/test/board-dom-prediction.test.ts` (fake `Planchette` host
      that can emit synthetic `pointer-move`/`highlight`/`select` events): a slot
      reported as under the pointer at recompute time keeps its word; a slot with no
      lock is updated; selecting a slot dispatches `add-word` with that slot's word.
    - _Requirements: 4.1, 4.5_

  - **Covers:** Req 4 AC 1, 5.

- [ ] 17. DOM layer: Quick phrases

  - [ ] 17.1 Render and wire the Quick-phrases list in the Board view.
    - Extend `board-dom.ts`: render `QuickPhrasesStore.phrases` as fixed-position
      targets (`quick-phrase-<id>`), re-registered only on store changes (never on
      message/prediction changes), wired to
      `dispatch({type:'replace', text: phrase.text})`.
    - Write `apps/board/test/board-dom-quick-phrases.test.ts` (fake host): selecting a
      quick phrase replaces the message and is one undoable action (via
      `board-model.undo()`); a prediction recompute or a core-grid selection does not
      re-register quick-phrase targets.
    - _Requirements: 7.2, 7.3_

  - **Covers:** Req 7 AC 2, 3.

- [ ] 18. DOM layer: Settings screen

  - [ ] 18.1 Build the Settings panel.
    - Extend `board-dom.ts` (or a new `apps/board/src/board-settings-dom.ts` if the
      file grows large): a keyboard-and-screen-reader-operable panel with labelled
      controls for every Board/skeleton profile field (reusing the input-core Profile
      fields table's min/max as help text), the `voiceURI` `<select>` populated from
      `speechSynthesis.getVoices().filter(v => v.localService)`, the `speechRate`
      range input, the Export/Import text box and buttons (mirroring the skeleton
      demo's profile box), and the Quick-phrases editor (add/edit/remove, Move
      up/Move down buttons for keyboard-operable reordering).
    - Write `apps/board/test/settings-dom.test.ts` (jsdom): every control has an
      accessible name; Tab order reaches every control; the voice `<select>` shows
      "no local voices available" when `getVoices()` returns none with
      `localService: true`; Export populates the text box with the current
      `BoardExport` JSON; Import with a valid JSON string updates the model and
      reports no changes; Import with an out-of-range value reports the clamp.
    - Add the About screen (`#about`, opened from a Settings button), text from
      `messages.ts`: version, not-a-medical-device notice, Universal Core vocabulary
      credit (CC BY 4.0, links), Prediction word list credit (hermitdave/FrequencyWords,
      Hermit Dave, OpenSubtitles 2018 via OPUS, CC BY-SA 4.0, changes made, links), the
      derivative-stays-CC-BY-SA and code-is-MIT statement. Write
      `apps/board/test/about-dom.test.ts` (jsdom): the About button is reachable by Tab;
      the screen contains each credit, licence name, and link `href`, the notice, and a
      non-empty version string.
    - _Requirements: 6.1, 6.4, 7.3, 8.4, 8.5, 9.9, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - **Covers:** Req 6 AC 1, 4; Req 7 AC 3; Req 8 AC 4, 5; Req 9 AC 9; Req 12.

- [ ] 19. Checkpoint - DOM layer complete
  - Run the full `apps/board` test suite and `npm run typecheck`. Ensure all tests
    pass, ask the user if questions arise.

- [ ] 20. Accessibility, theme, and notice content

  - [ ] 20.1 Apply calm styling, contrast, reduced motion, and the required notices.
    - Create `apps/board/demo.css`-equivalent stylesheet (named to match the app,
      e.g. `apps/board/board.css`) with: 24 CSS px minimum text size everywhere on the
      grid/strip/bar/list; measured 4.5:1 text contrast and 3:1 UI-part contrast
      against the page background (same measurement approach as
      `skeleton/test/demo.e2e.ts`); `prefers-reduced-motion` respected by relying on
      `createDwellRing`/`createScanHighlight`'s own built-in handling (no extra Board
      animation is added); no flashing element anywhere on the page.
    - Check the About screen from Task 18.1 uses the same 24 CSS px text size and
      contrast rules (the notice and credits come from `messages.ts`).
    - Write `apps/board/test/board-colours.test.ts` (jsdom + computed style, mirroring
      `demo.e2e.ts`'s contrast checks): every text colour/background pairing used on
      the grid, strip, bar, and Settings screen computes to at least 4.5:1; outlines
      and focus rings compute to at least 3:1.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.10_

  - **Covers:** Req 9 AC 1–7, 10.

- [ ] 21. End-to-end tests (Playwright + axe-core)

  - [ ] 21.1 Write the mouse- and keyboard-driven end-to-end suite.
    - Write `apps/board/test/board.e2e.ts` (pattern from `skeleton/test/demo.e2e.ts`,
      added to `playwright.config.ts`'s `testDir`/`testMatch` if needed): loads
      `/board/`, never starts the camera; drives mouse clicks (core word → Message bar
      updates; Backspace/Clear/Undo/Speak behave per Requirement 1; Spell-mode toggle
      shows the Letter board and back) and keyboard/switch-scan selection (Space as
      the default switch binding advances and selects, Escape cancels); confirms
      Undo restores the message after Clear; confirms the not-a-medical-device notice
      is present; confirms no `getUserMedia` call is made unless the test explicitly
      starts the camera (none do).
    - Write `apps/board/test/board-a11y.e2e.ts`: axe-core scan of the core-grid view,
      the Spell-mode view, and the open Settings panel (pattern from
      `skeleton/test/ui.e2e.ts`).
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 3.1, 3.2, 5.1, 5.9, 9.9_

  - **Covers:** Req 1 AC 2–7; Req 3 AC 1, 2; Req 5 AC 1, 9; Req 9 AC 9.

- [ ] 22. Checkpoint - end-to-end suite complete
  - Run `npm run test:e2e` and confirm the new Board specs pass alongside the existing
    skeleton ones. Ensure all tests pass, ask the user if questions arise.

- [ ] 23. MCP configuration for the dwell simulator

  - [ ] 23.1 Add the workspace MCP configuration and verify the relative path.
    - Create `.kiro/settings/mcp.json` with the `dwell-sim` server entry using the
      **relative** command path `tools/dwell-sim-mcp/dist/server.js`, per design.md's
      "Configuring the MCP server" section (`command: "node"`, relative `args`,
      `disabled: false`). Never commit an absolute path.
    - **Verify first** that Kiro resolves the relative path against the workspace root:
      build with `npm run build:sim`, enable the `dwell-sim` server in Kiro and list its
      tools (`list_users`, `simulate`, `compare` must appear), or read the Kiro MCP
      docs and run an equivalent check. Record how it was checked in
      `docs/kiro-journal.md`.
    - **If it does not resolve: stop and tell the user.** Document a per-user config
      that is not committed (`~/.kiro/settings/mcp.json` with the user's own absolute
      path) in `tools/dwell-sim-mcp/README.md`, remove the relative entry from the
      workspace file, and do not continue to Task 24 until the user replies.
    - Write `tools/dwell-sim-mcp/test/board-mcp-config.test.ts`: `.kiro/settings/mcp.json`
      parses as JSON, contains a `dwell-sim` entry whose `args` path does not start
      with `/` or a drive letter, and whose `command` is `node`.
    - _Requirements: none (design.md "Layout validation" infrastructure)_

  - **Covers:** design.md "Configuring the MCP server".

- [ ] 24. Board layout export and the six-preset gate run

  - [ ] 24.1 Export the Board's four layouts.
    - Write `tools/dwell-sim-mcp/scripts/export-board-layout.ts` (pattern from
      `export-demo-layout.ts`): serves the built `dist/board/index.html`, opens it at
      1920×1080 and 1366×768, reads `window.planchetteBoard.planchette.getTargets()`
      for the core-grid view, presses the Spell-mode toggle and reads targets again
      for the spell view, and writes the four `board-layout-*.json` files next to the
      existing demo-layout files.
    - Add a `demo:export:board` script to `tools/dwell-sim-mcp/package.json` running
      this script via `dist-scripts/export-board-layout.js`, and wire a `window.planchetteBoard`
      test hook into `apps/board/src/main.ts` (mirroring the demo's
      `window.planchetteDemo`).
    - Write `tools/dwell-sim-mcp/test/export-board-layout.test.ts`: the pure
      `toLayoutJson`-equivalent conversion function used by the script produces the
      expected `{ screen, targets }` shape from a fixed sample input (unit test; the
      Playwright-driving `main` is excluded from this test, matching
      `export-demo-layout.ts`'s own test boundary).
    - _Requirements: none (design.md "Exporting the Board's layout")_

  - [ ] 24.2 Generalise the preset runner and run the six-preset gate.
    - Write `tools/dwell-sim-mcp/scripts/run-board-presets.ts`: imports
      `runDemoPresets`/`DemoLayout`/`DemoHandler` from `run-demo-presets.ts` (no
      duplication), passes the four Board layouts and a `{ eachTarget: 2 }` task,
      and runs all six presets (`steady`, `slow`, `head-tremor`, `strong-head-tremor`,
      `small-range`, `reads-while-pointing`) at the Board's default profile (dwell
      time 1400 ms, per design.md's chosen lever) against each of the four layouts.
    - Write `tools/dwell-sim-mcp/test/run-board-presets.test.ts`: with a stub
      `DemoHandler`, `runBoardPresets` (the board-specific thin wrapper) calls the
      handler once per preset per layout (24 calls total) with the documented task and
      seed.
    - Append the run's `formatPresetEntry`-produced text to `docs/kiro-journal.md`
      (append step driven by the same `--append` flag pattern as
      `run-demo-presets.ts`).
    - **Acceptance gate**: the `reads-while-pointing` preset's `accidentalPer100Intended`
      metric must be at or below 10 on all four Board layouts. If it is not, adjust the
      design levers in design.md's "Design levers used" section (dwell time, grouping,
      spacing) and re-run before proceeding to Task 24.3.
    - _Requirements: none (design.md "Running the six presets", "The acceptance target")_

  - [ ]* 24.3 Pin any surfaced counterexample.
    - WHERE a `simulate` run from Task 24.2 surfaces an accidental selection whose
      cause is not the expected `reading-pause` cause at or below the target rate,
      write `apps/board/test/layout-regressions.test.ts`: a fixed regression test that
      re-runs that exact `simulate` call (preset, layout file, seed, task) and asserts
      the metric now passes. Skip this sub-task entirely if no such counterexample is
      found.
    - _Requirements: none (design.md "Counterexample policy")_

  - **Covers:** design.md "Running the six presets", "The acceptance target", "Counterexample policy".

- [ ] 25. Compare runs for layout-affecting changes made in this spec

  - [ ] 25.1 Record a `compare` baseline-vs-chosen-defaults run.
    - Using the `compare` MCP tool (via a script or an ad hoc MCP call recorded in the
      journal, not a new source file, mirroring how dwell-sim-mcp's README documents
      `compare` usage), compare the Board's core-grid layout at the input-core global
      default dwell time (1000 ms) against the Board's chosen default (1400 ms, Task
      24.2), same seed, same task, for the `reads-while-pointing` preset, isolating
      the effect of lever 1 (dwell time) from design.md.
    - Append the `compare` verdict and the `pairs` time-to-select deltas to
      `docs/kiro-journal.md`, including the expected `slow`-preset time-to-select
      trade-off noted in design.md.
    - _Requirements: none (design.md "Comparing layout changes")_

  - **Covers:** design.md "Comparing layout changes".

- [ ] 26. Final checkpoint
  - Run `npm test` and `npm run build` and `npm run test:e2e` at the repository root.
    Confirm the Task 24.2 acceptance gate still passes (metrics are deterministic for
    a fixed seed, so this should not need re-running unless source changed since
    Task 24). Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` (property and regression tests) are optional sub-tasks and
  can be skipped for a faster MVP, except that skipping Task 24.3 is only valid when
  no counterexample was found (noted inline on that task). All fourteen numbered
  properties in design.md are implemented as required sub-tasks regardless of the
  `*` marking convention used elsewhere in this plan for clarity; the `*` here follows
  this workflow's own convention that test-only sub-tasks may be marked optional, but
  the properties listed in design.md are the ones explicitly requested and should not
  be skipped without reporting that gap to the user.
- `apps/board/src/main.ts` is extended incrementally across Tasks 10, 13, 14, 16, 17,
  and 18; no task leaves it in a state that does not compile or run.
- The dwell-sim-mcp package (`tools/dwell-sim-mcp`) is extended, not duplicated:
  Tasks 23–25 add Board-specific scripts and one config file, reusing
  `run-demo-presets.ts`'s exported functions and the existing `simulate`/`compare`
  MCP tools exactly as the dwell-sim-mcp spec built them.
- Scripts under `tools/dwell-sim-mcp/scripts/` compile to `dist-scripts/*.js` and run
  with plain `node`, matching the existing `export-demo-layout.ts` /
  `run-demo-presets.ts` convention; no new dependency is added for them.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.0"] },
    { "id": 1, "tasks": ["1.1", "1.2"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2", "2.3"] },
    { "id": 4, "tasks": ["3"] },
    { "id": 5, "tasks": ["4.1"] },
    { "id": 6, "tasks": ["4.2", "5.1", "6.1"] },
    { "id": 7, "tasks": ["5.2", "5.3", "5.4", "5.5", "6.2"] },
    { "id": 8, "tasks": ["7"] },
    { "id": 9, "tasks": ["8.1", "9.1"] },
    { "id": 10, "tasks": ["8.2", "9.2", "9.3"] },
    { "id": 11, "tasks": ["10.1"] },
    { "id": 12, "tasks": ["10.2", "10.3"] },
    { "id": 13, "tasks": ["11"] },
    { "id": 14, "tasks": ["12.1"] },
    { "id": 15, "tasks": ["13.1"] },
    { "id": 16, "tasks": ["14.1"] },
    { "id": 17, "tasks": ["14.2"] },
    { "id": 18, "tasks": ["14.3"] },
    { "id": 19, "tasks": ["15"] },
    { "id": 20, "tasks": ["16.1"] },
    { "id": 21, "tasks": ["17.1"] },
    { "id": 22, "tasks": ["18.1"] },
    { "id": 23, "tasks": ["19"] },
    { "id": 24, "tasks": ["20.1"] },
    { "id": 25, "tasks": ["21.1"] },
    { "id": 26, "tasks": ["22"] },
    { "id": 27, "tasks": ["23.1"] },
    { "id": 28, "tasks": ["24.1"] },
    { "id": 29, "tasks": ["24.2"] },
    { "id": 30, "tasks": ["24.3"] },
    { "id": 31, "tasks": ["25.1"] },
    { "id": 32, "tasks": ["26"] }
  ]
}
```
