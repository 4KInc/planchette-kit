# Implementation Plan: communication board (App A)

## Overview

Tasks build the pure stores first (Message/undo, core vocabulary, letter board,
prediction, quick phrases, storage, speech), each with its unit and property tests,
then wire them together behind the DOM layer, then add the data files
(`THIRD_PARTY.md` entries), then the Playwright/axe-core end-to-end suite, and finish
with the dwell-sim-mcp layout validation gated on the `reads-while-pointing`
acceptance target from design.md. Each task names the file(s) it writes and the test
file next to it. Unit tests are `apps/board/test/<thing>.test.ts`, property tests are
`<thing>.props.test.ts`. Each of the eighteen properties in design.md is its own
required sub-task, placed right after the component it checks.

Convert the feature design into a series of prompts for a code-generation LLM that
will implement each step with incremental progress. Make sure that each prompt builds
on the previous prompts, and ends with wiring things together. There should be no
hanging or orphaned code that isn't integrated into a previous step. Focus ONLY on
tasks that involve writing, modifying, or testing code.

## Tasks

- [x] 1. Core-vocabulary and letter-board data

  - [x] 1.0 Wire apps/board into the workspace.
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

  - [x] 1.1 Write the fixed core-vocabulary table.
    - Create `apps/board/src/core-vocabulary.ts`: the `CoreButton` type and the
      `CORE_VOCABULARY` literal array (the 36 Universal Core vocabulary words, CC BY
      4.0, CLDS/UNC, alphabetical row-major into a fixed 6×6 grid), per design.md
      "Components and Interfaces" → `core-vocabulary.ts`.
    - Write `apps/board/test/core-vocabulary.test.ts`: exactly 36 entries; every word
      from the Core word list in requirements.md is present exactly once; every `row`
      is 0–5 and every `col` is 0–5; no two entries share a `(row, col)`.
    - _Requirements: 2.1, 2.2_

  - [x] 1.2 Write the fixed letter-board table.
    - Create `apps/board/src/letter-board.ts`: the `LetterKey` type and the
      `LETTER_BOARD` literal array (a fixed grid of 6 columns × 5 rows; the 26 letters
      in frequency order E T A O I N S H R D L C U M W F G Y P B V K J X Q Z placed
      in plain row-major order, then Space at (4,2) and Backspace at (4,3); cells
      (4,4) and (4,5) are empty and have no entry).
    - Write `apps/board/test/letter-board.test.ts`: exactly 28 entries (26 letters +
      Space + Backspace); the letter order matches the documented frequency order
      exactly and each letter sits at row `floor(i / 6)`, column `i % 6`; Q is at
      (4,0) and Z at (4,1); Space is at (4,2); Backspace is at (4,3); no key exists at
      (4,4) or (4,5); every `(row, col)` is unique and within 0–4 and 0–5.
    - _Requirements: 3.3_

  - **Covers:** Req 2 AC 1, 2; Req 3 AC 3; build and test wiring (1.0).

- [x] 2. Message model and undo

  - [x] 2.1 Implement `createBoardModel`.
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

  - [x]* 2.2 Write the property test for Clear then undo.
    - In `apps/board/test/board-model.props.test.ts`, generate arbitrary message
      strings (including empty, whitespace-only, and unicode) and assert
      `dispatch({type:'clear'})` then `undo()` restores the exact original message.
    - **Property 2: Clear then undo is identity**
    - **Validates: Requirements 1.6, 1.7**

  - [x]* 2.3 Write the property test for any undoable action then undo.
    - In the same file, generate an arbitrary message and an arbitrary non-no-op
      `BoardAction`; assert dispatch-then-undo restores the exact original message.
    - **Property 3: Any undoable action then undo is identity**
    - **Validates: Requirements 1.4, 1.5, 1.7, 7.2**

  - **Covers:** Req 1 AC 2, 4, 5, 6, 7; Req 3 AC 4, 5, 6; Req 7 AC 2; P2, P3.

- [x] 3. Checkpoint - message model complete
  - Run the root `npm test` (typecheck, build, then every workspace's tests, including
    `apps/board`) and confirm the Task 1–2 tests pass. Ensure all tests pass, ask the user
    if questions arise.

- [x] 4. Bundled prediction word list

  - [x] 4.1 Verify the licence, then generate the bundled word-list asset.
    - **First step, before anything is copied or built:** fetch the README of
      <https://github.com/hermitdave/FrequencyWords> and confirm it still states
      "CC-by-sa-4.0 for content" (and MIT for code). If it does not say CC BY-SA, **stop
      and tell the user**; do not copy the file or run the build.
    - Commit an unmodified copy of `content/2018/en/en_50k.txt` as
      `apps/board/data/source/en_50k.txt` (no download at build or run time).
    - Write `apps/board/scripts/build-prediction-word-list.ts`: reads only that
      committed file and writes `apps/board/data/prediction-word-list.json`
      (`{ word: normalisedFrequency }`). Rules, in order: lower-case; keep only
      entries that start with a letter, then continue with letters or apostrophes, of
      length 2 or more (`/^[a-z][a-z']+$/`); drop every
      `CORE_VOCABULARY` word; keep the first 5,000 remaining entries in source order;
      frequency is `1 / (rank + 1)` scaled to [0, 1], with 0-based rank (the top entry
      is exactly 1), so every value is already in (0, 1].
    - Add an npm script `build:wordlist` to `apps/board/package.json` that compiles
      `scripts/build-prediction-word-list.ts` with `tsc` to a temporary directory
      outside the repository and runs the compiled `.js` with plain `node` (no Node
      TypeScript stripping).
    - Write `apps/board/data/prediction-word-list.LICENSE.md`: the CC BY-SA 4.0 notice
      (source repository and file, author Hermit Dave, OpenSubtitles 2018 via OPUS,
      link to <https://creativecommons.org/licenses/by-sa/4.0/>, the changes made:
      trimmed, lower-cased, filtered, re-ranked, and that the result is shared under
      CC BY-SA 4.0).
    - Write `apps/board/test/build-prediction-word-list.test.ts`: the JSON has exactly
      5,000 entries given the committed source; no entry equals a `CORE_VOCABULARY`
      word; every key matches `/^[a-z][a-z']+$/`; a named test (`drops tokenizer
      fragments`) checks that `'s` and `'t` from the committed source are absent, and
      that `don't` is kept if present in the source; frequencies are strictly
      decreasing with rank; the build reads no network (spy on `fetch`); the licence file exists
      next to the JSON and contains "CC BY-SA 4.0", "Hermit Dave", and "OpenSubtitles".
    - _Requirements: 4.3, 4.8_

  - [x] 4.2 Record both data sources in THIRD_PARTY.md.
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

  - [x] 4.3 Verify the licence, then generate the bundled Exclusion list asset.
    - **First step, before anything is copied or built:** fetch the README and LICENSE
      of <https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words>
      and confirm they state Creative Commons Attribution 4.0 International
      (copyright 2012-2020 Shutterstock, Inc.). If they do not, **stop and tell the
      user**; do not copy the file or run the build.
    - Commit an unmodified copy of the file `en` as
      `apps/board/data/source/ldnoobw-en.txt` (no download at build or run time).
    - Write `apps/board/scripts/build-offensive-words.ts`: reads only that committed
      file and writes `apps/board/data/offensive-words.json` (a JSON array of strings).
      Rules, in order: lower-case; drop every entry that is not made only of a-z and
      apostrophes (this drops every multi-word entry, which could never equal a single
      predicted word); de-duplicate.
    - Write `apps/board/data/offensive-words.LICENSE.md`: the CC BY 4.0 notice (source
      repository and file `en`, copyright 2012-2020 Shutterstock, Inc., link to
      <https://creativecommons.org/licenses/by/4.0/>, the changes made: single-word
      entries only, lower-cased, de-duplicated).
    - Write `apps/board/test/build-offensive-words.test.ts`: every entry matches
      `/^[a-z']+$/`; no duplicates; no entry contains a space; a sample multi-word line
      in a small inline input is dropped and a sample single-word line is kept; the
      build reads no network (spy on `fetch`); the licence file exists next to the JSON
      and contains "CC BY 4.0", "Shutterstock", and "LDNOOBW".
    - _Requirements: 4.16, 4.17_

  - [x] 4.4 Record the Exclusion list in THIRD_PARTY.md.
    - Add to the "Data files" section of `THIRD_PARTY.md` an entry for the Exclusion
      list: file path, licence CC BY 4.0, copyright 2012-2020 Shutterstock, Inc., the
      changes made, and links to the source repository and the licence.
    - Extend `apps/board/test/third-party-board.test.ts`: `THIRD_PARTY.md` contains
      "LDNOOBW", "Shutterstock", and "CC BY 4.0" for the Exclusion list entry.
    - _Requirements: 4.16_

  - **Covers:** Req 2 AC 5; Req 4 AC 3, 8, 16, 17.

- [x] 5. Prediction strip model

  - [x] 5.1 Implement `createPredictionStrip`.
    - Create `apps/board/src/prediction.ts`: `SlotState`, `SlotLock`,
      `PredictionStrip`, `OffensiveWordFilter`, `createPredictionStrip` (taking the
      filter as its fourth argument), the ranking formula
      (`normalizedFreq + recencyWeight`), the core-exclusion filter, the offensive-word
      filter (when `filter.enabled()` is true, drop candidates that are in
      `filter.excluded` and not in the history; history words are never dropped), the prefix rule
      (non-empty `partialWord`: only words starting with it, history words first), and
      the lock-respecting fill rule from design.md; `recompute(message, partialWord,
      isLocked)`.
    - Write `apps/board/test/prediction.test.ts`: exact score values for a small
      example: a word with history count 1 scores its `normalizedFreq` + 1, and count 3
      scores `normalizedFreq` + `1 + ln(3)`; a history-only word (not in the bundled
      list) scores `recencyWeight` alone; the tie-break order on equal score is history
      words first, then bundled-list rank, then lexicographic for history-only words;
      with an empty history, ranking
      follows word-list frequency only; with a history entry, that word's score rises;
      a slot held locked across two `recompute` calls keeps its original word even
      when a higher-ranked candidate becomes available; `predictionSlotCount` at 2 and
      at 8 both produce a slots array of that exact length; a ranked list shorter than
      `slotCount` leaves the remaining unlocked slots `null`; with partial word `"he"`,
      a spoken `"hello"` ranks ahead of a higher-frequency bundled `"help"`, and no
      candidate lacks the prefix; clearing the partial word returns to the
      whole-message ranking; with the filter on, an excluded bundled-list word is
      absent, the same word is present when it is in the history, and with the filter
      off it is present.
    - _Requirements: 4.1, 4.2, 4.6, 4.7, 4.9, 4.10, 4.11, 4.13, 4.14, 4.15_

  - [x]* 5.2 Write the property test for locked-slot stability.
    - In `apps/board/test/prediction.props.test.ts`, generate a message/word-list/
      history and an arbitrary subset of slot indices marked locked; call `recompute`
      and assert every locked slot's `word` is unchanged.
    - **Property 4: Prediction never changes a locked slot**
    - **Validates: Requirements 4.1, 4.5**

  - [x]* 5.3 Write the property test for unlocked-slot filling.
    - In the same file, for any message and any Partial word (empty or non-empty),
      assert every unlocked slot's word is absent from `CORE_VOCABULARY`, appears in no
      other slot, and unlocked slots are filled in non-increasing rank order (the
      whole-message score order when the Partial word is empty, the prefix ordering
      with the history group first when it is not).
    - **Property 5: Unlocked slots are filled from the ranked, deduplicated, core-excluding list**
    - **Validates: Requirements 4.3, 4.6, 4.7**

  - [x]* 5.4 Write the property test for recency monotonicity.
    - In the same file, generate a word `w` and two histories `h1`, `h2` where `h2`
      adds one more spoken occurrence of `w` to `h1`; assert `w`'s rank under `h2` is
      at or above its rank under `h1`.
    - **Property 6: Speaking a word never decreases its future rank**
    - **Validates: Requirements 4.7**

  - [x]* 5.5 Write the property test for prefix predictions.
    - In `apps/board/test/prediction.props.test.ts`, generate a word list, a history,
      a non-empty partial word (letters, mixed case), and an arbitrary locked-slot
      subset; call `recompute` and assert every unlocked slot's word, and every locked
      slot's word that already starts with the partial word, starts with the partial
      word (case-insensitive); a locked slot keeps its word even if it no longer
      matches. Assert every history word with that prefix that fits in the unlocked
      slots is placed ahead of every list-only word.
    - **Property 14: Prefix predictions start with the partial word**
    - **Validates: Requirements 4.10, 4.12**

  - [x]* 5.6 Write the property test for the offensive-word filter.
    - In `apps/board/test/prediction.props.test.ts`, generate a word list, a history,
      an Exclusion list (a random subset of the list's words plus some history words),
      a message and partial word, an arbitrary locked-slot subset, and the setting
      on/off. With the filter on, assert no word that is in the Exclusion list and not
      in the history appears in any unlocked slot (and in no slot when the setting and
      Exclusion list are unchanged since the slot was filled). Also check the toggle
      case on unlocked slots: turning the filter on leaves a locked slot's word
      unchanged, and the first `recompute` after the lock is released replaces it. With
      the filter off, assert the slots equal those computed with an empty Exclusion
      list.
    - **Property 15: Offensive-word filter**
    - **Validates: Requirements 4.13, 4.14, 4.15, 4.17**

  - **Covers:** Req 4 AC 1, 2, 6, 7, 9, 10, 11, 12, 13, 14, 15; P4, P5, P6, P14, P15.

- [x] 6. Storage layer

  - [x] 6.1 Implement `readJSON` / `writeJSON` and the storage keys.
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

  - [x]* 6.2 Write the property test for corrupt-storage fallback.
    - In `apps/board/test/board-storage.props.test.ts`, generate arbitrary strings
      (non-JSON text, valid JSON of the wrong shape, JSON missing `version`, JSON
      exceeding a key's size cap) as the stored raw value for each of the four keys;
      assert `readJSON` returns the documented default, `usedDefault: true`, and does
      not throw, and that a subsequent `dispatch`-equivalent call on the resulting
      default also does not throw.
    - **Property 12: Corrupt or partial storage never throws and falls back to the documented default**
    - **Validates: Requirements 10.4**

  - **Covers:** Req 10 AC 3, 4; P12.

- [x] 7. Checkpoint - prediction and storage complete
  - Run the full `apps/board` unit and property test suite. Ensure all tests pass,
    ask the user if questions arise.

- [x] 8. Quick phrases store

  - [x] 8.1 Implement `QuickPhrasesStore`.
    - Create `apps/board/src/quick-phrases.ts`: `QuickPhrase`, `QuickPhrasesStore`,
      backed by `board-storage.ts`'s `planchette-board:quick-phrases` key, seeded on
      first run from a short built-in starter list defined in `messages.ts`
      (Task 9.1).
    - Write `apps/board/test/quick-phrases.test.ts`: `add`/`update`/`remove` change
      only the targeted entry; `reorder` changes only the order, not the content;
      selecting a quick phrase (via `board-model.dispatch({type:'replace', ...})`,
      wired in Task 10) does not call any `QuickPhrasesStore` mutator.
    - _Requirements: 7.1, 7.2_

  - [x]* 8.2 Write the property test for quick-phrase order stability.
    - In `apps/board/test/quick-phrases.props.test.ts`, generate a quick-phrases list
      and a sequence of Board actions that never calls `add`/`update`/`remove`/
      `reorder`; assert the order of phrase ids is unchanged after the sequence.
    - **Property 11: Quick-phrase order is stable under non-edit actions**
    - **Validates: Requirements 7.4**

  - **Covers:** Req 7 AC 1, 2, 4; P11.

- [x] 9. Speech output

  - [x] 9.1 Write `messages.ts` (user-facing text) and `speech.ts`.
    - Create `apps/board/src/messages.ts`: every Board-facing string in one place
      (per structure.md), including the not-a-medical-device notice (the sentence from
      requirements.md's introduction), the speech-unavailable message ("Speech output
      is unavailable on this device."), the quick-phrases starter list (exactly "Yes",
      "No", "Thank you", "I need help", "Please wait", "I want to rest", in that
      order), and the Settings labels ("Voice", "Speech rate", "Number of suggestions",
      "Edit quick phrases", "Filter offensive words from suggestions"), plus the
      About-screen link URLs already in `THIRD_PARTY.md`.
    - Create `apps/board/src/speech.ts`: `pickLocalVoice`, `speak`, per design.md
      (`end` resolves spoken true; `error` resolves spoken false; a watchdog of
      `max(10000, 150 * text.length / rate)` ms calls `synth.cancel()` and resolves
      spoken false; settles once; optional fourth argument `timers` with `setTimeout`
      and `clearTimeout`, defaulting to the globals).
    - Write `apps/board/test/speech.test.ts`: `pickLocalVoice` with a fake voice list
      containing only `localService: false` entries returns `null`; with a mix,
      returns a `localService: true` entry; `speak` with a `null` voice resolves
      `{ spoken: false }` and never calls `synth.speak`; `speak` with a voice calls
      `synth.speak` exactly once with the given rate and voice; an `end` event
      resolves `{ spoken: true }`; an `error` event (including `interrupted`)
      resolves `{ spoken: false }`; when no event fires, firing the injected timer
      calls `synth.cancel` and resolves `{ spoken: false }` (fake timers passed in, no
      real waiting), and the delay requested is `max(10000, 150 * length / rate)`; the
      promise settles once, so an `end` after the watchdog is ignored.
    - Write `apps/board/test/messages.test.ts`: the starter list equals the six
      phrases in the order above; the speech-unavailable message equals the exact
      text above.
    - _Requirements: 8.1, 8.2, 8.3_

  - [x]* 9.2 Write the property test for local-service-only voice selection.
    - In `apps/board/test/speech.props.test.ts`, generate arbitrary voice lists
      (0–10 entries, random `localService` booleans and `voiceURI` strings) and a
      `preferredURI`; assert `pickLocalVoice` never returns a `localService: false`
      voice and returns `null` only when no local-service voice exists.
    - **Property 9: Local-service-only voice selection**
    - **Validates: Requirements 8.1, 8.2, 8.4**

  - [x]* 9.3 Write the property test for voice/rate application.
    - In the same file, generate arbitrary `BoardOnlySettings` and messages; assert
      every `speak()` call's utterance uses the resolved voice and the configured
      rate.
    - **Property 10: Chosen voice and rate are used on every speak call**
    - **Validates: Requirements 8.4, 8.5**

  - **Covers:** Req 8 AC 1, 2, 3, 4, 5; P9, P10.

- [x] 10. Wire the pure stores: history updates and settings model

  - [x] 10.1 Implement `board-settings.ts` and the history-update rule.
    - Create `apps/board/src/board-settings.ts`: `BoardOnlySettings`,
      `BoardProfileFields`, `BoardExport`, export/import functions that call the
      skeleton's `exportProfile`/`importProfile` for the `profile` part and apply the
      same clamp-or-default-and-report rule to `predictionSlotCount` (2–8) and
      `speechRate` (0.5–2.0), and to `filterOffensiveWords` (boolean, default `true`;
      a missing or non-boolean value becomes `true` and is reported). `main.ts` passes
      `() => settings.filterOffensiveWords` and the Set loaded from
      `offensive-words.json` to `createPredictionStrip`.
    - In `apps/board/src/main.ts` (first version: wiring only the pure stores, no DOM
      yet), add the rule that a word is appended to the Spoken-word history only after
      a `speak()` call resolves `{ spoken: true }`, splitting the spoken message into
      normalised words per design.md "Spoken-word normalisation" (a
      `normaliseSpokenWord` helper, also used for history lookups).
    - Write `apps/board/test/board-settings.test.ts`: export then import an in-range
      `BoardExport` returns an equal object; `resolveInitialProfile`: with a saved
      or imported profile whose `dwellTime` is 1000 the board keeps 1000, and with a
      saved `dwellTime` of 1400 or 600 it keeps that value; with no saved profile
      (`usedDefault: true`) it applies 2100 (was 1400 ms until 27 Nov 2026; see design.md lever 1); an out-of-range `predictionSlotCount`
      (for example 1 or 9) is clamped to 2 or 8 on import and reported; a missing
      `speechRate` falls back to 1.0 and is reported; `filterOffensiveWords` defaults
      to `true` with no saved settings, survives export then import when `false`, and
      a non-boolean value (for example `"no"`) falls back to `true` and is reported.
    - Write `apps/board/test/main-history.test.ts`: selecting a predicted word alone
      does not change history; a `speak()` call that resolves `spoken: true` adds each
      word of the message to history; a `speak()` call that resolves `spoken: false`
      does not change history; normalisation examples: speaking "Hello, don't José!
      1234 'quoted' 😀" adds exactly `hello`, `don't`, `josé`, and `quoted` (the
      `1234` and emoji-only tokens are dropped), and speaking "Hello" then "hello,"
      raises the single history key `hello` to count 2.
    - Also in `board-settings.ts`: `resolveInitialProfile(saved)` per design.md
      "Design levers used", lever 1; `main.ts` calls it before the first `setProfile`.
    - _Requirements: 4.4, 4.9, 6.2, 6.3, 6.5, 6.6, 6.7, 6.8, 8.6, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

  - [x]* 10.2 Write the property test for settings export/import round trip and clamping.
    - In `apps/board/test/board-settings.props.test.ts`, generate arbitrary valid
      `BoardExport` values and arbitrary malformed ones (out-of-range or wrong-typed
      `board` fields); assert the round-trip and clamp-or-default behaviour from
      design.md Property 7.
    - **Property 7: Settings export/import round trip and clamping**
    - **Validates: Requirements 6.5, 6.6, 6.7, 11.1, 11.2, 11.3**

  - [x]* 10.3 Write the property test for history updates on successful speech only.
    - In `apps/board/test/main-history.props.test.ts`, generate a sequence of
      predicted-word selections and `speak()` calls with randomised `spoken` results;
      assert history changes exactly for the `spoken: true` calls.
    - **Property 8: Spoken-word history updates only on successful speech**
    - **Validates: Requirements 4.4, 4.9, 8.1, 8.2, 8.6**

  - **Covers:** Req 4 AC 4, 9; Req 6 AC 2, 3, 5, 6, 7; Req 8 AC 6; Req 11 AC 1–6; P7, P8.

- [x] 11. Checkpoint - all pure stores complete
  - Run the root `npm test` (includes `apps/board`) and `npm run typecheck`.
    Ensure all tests pass, ask the user if questions arise.

- [x] 12. No-network property across the pure layer

  - [x]* 12.1 Write the no-network property test.
    - In `apps/board/test/no-network.props.test.ts`, spy on global `fetch`,
      `XMLHttpRequest`, `WebSocket`, and `navigator.sendBeacon`; generate a sequence of
      Board actions and drive them through `board-model.ts`, `prediction.ts`,
      `quick-phrases.ts`, `board-settings.ts`, `board-storage.ts`, and `speech.ts`
      (with a fake `SpeechSynthesis`); assert zero calls to any of the four spies.
    - **Property 13: No network calls**
    - **Validates: Requirements 10.1, 10.3**

  - **Covers:** Req 10 AC 1, 3; P13.

- [x] 13. DOM layer: Message bar, action row, and target registration

  - [x] 13.1 Implement the Message bar and action targets.
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

- [x] 14. DOM layer: core-vocabulary grid and Spell mode

  - [x] 14.1 Render the Core-vocabulary grid and register its targets.
    - Extend `board-dom.ts`: render `CORE_VOCABULARY` as a fixed 6×6 grid of buttons
      (`data-planchette-target="core-<id>"`), sized and spaced from the current
      Board/skeleton profile's `targetSize`/`targetSpacing` (CSS custom properties, as
      the skeleton demo does), and register each as a `default`-role target wired to
      `board-model.dispatch({type:'add-word', text})`.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 9.1, 9.2_

  - [x] 14.2 Render the Letter board and Spell-mode toggle.
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

  - [x]* 14.3 Write the property test for fixed-grid position stability.
    - In `apps/board/test/board-dom-grid.props.test.ts`, using the fake `Planchette`
      host, generate a sequence of Board actions, Spell-mode toggles, Settings
      changes, and resize events; assert every `CORE_VOCABULARY` target's recorded
      `(row, col, label)` is unchanged whenever Spell mode is off both before and
      after the sequence, and every `LETTER_BOARD` target's is unchanged whenever
      Spell mode is on both before and after.
    - **Property 1: Fixed-grid position stability**
    - **Validates: Requirements 2.2, 2.3, 2.4, 3.3, 3.7**

  - **Covers:** Req 2 AC 1–4; Req 3 AC 1, 2; Req 9 AC 1, 2; P1.

- [x] 15. Checkpoint - grid and Spell mode complete
  - Run the full `apps/board` test suite including the new DOM-layer tests. Ensure
    all tests pass, ask the user if questions arise.

- [x] 16. Spelling after a word

  - [x] 16.1 Insert a space before a new spelled word, and lower-case letters.
    - Change `apps/board/src/board-model.ts`: in the `add-letter` case, lower-case the
      character with `toLowerCase()` (the model does it, so every caller gets the same
      result and the Letter board's upper-case labels stay display-only), and when
      `partialWord === ''` and `message !== ''` and the message does not end in
      whitespace, insert one space before the letter. The new `partialWord` is the old
      one plus the lower-cased letter. The undo snapshot is still taken before the
      action, so Undo restores the exact previous message and partial word. `add-space`
      is unchanged. `board-dom.ts` keeps dispatching `k.label` unchanged.
    - Update `apps/board/test/board-model.test.ts`: a named test `starts a spelled word
      after a word: "I want" + H gives "I want h"`; continuing a word adds no space
      ("I want h" + E gives "I want he"); a letter on an empty message adds no space;
      a letter after a message that ends in whitespace adds no second space; letters are
      lower-cased in both the message and `partialWord`; Undo of the first letter
      restores "I want" with an empty `partialWord`; Undo of a continuing letter
      restores the previous message and `partialWord`; spell-mode Backspace of the
      first letter leaves "I want " and the next letter gives "I want k". Search
      `apps/board/test` for `add-letter` and fix any expectation that assumed upper-case
      or no separator (for example `board-dom-grid.test.ts`, `board-dom-actions.test.ts`,
      `prediction.test.ts`).
    - _Requirements: 1.2, 3.4, 3.8_

  - [x]* 16.2 Write the property test for spelling after a word.
    - In `apps/board/test/board-model.props.test.ts`, add: for any `CORE_VOCABULARY`
      label `w0` and any non-empty string of letters `s` (a-z, A-Z), `add-word` `w0` on
      an empty model then `add-letter` for each character of `s` gives the message
      `w0 + ' ' + s.toLowerCase()` and `partialWord` `s.toLowerCase()`.
    - Re-run the existing Property 2 and Property 3 tests unchanged (they must still
      pass: Undo restores the pre-action snapshot, so an inserted space is undone). If the
      Property 3 test does not already compare `partialWord`, extend it to, and make its
      generator reach non-empty messages without trailing whitespace before `add-letter`.
    - **Property 16: Spelling after a word**
    - **Validates: Requirements 3.4**

  - **Covers:** Req 1 AC 2; Req 3 AC 4, 8; P16 (P2, P3 re-checked).

- [x] 17. Quick-phrases cap: refuse, never evict

  - [x] 17.1 Refuse a new phrase at the cap and stop evicting.
    - `apps/board/src/messages.ts`: add `quickPhrases: { full: 'The quick-phrases list is
      full (100). Remove a phrase to add a new one.' }`.
    - `apps/board/src/quick-phrases.ts`: `add(text)` returns `{ added: true }` or, when
      the list already holds `QUICK_PHRASES_MAX` (100) phrases, `{ added: false, reason:
      'full' }` without changing the list, calling `writeQuickPhrases`, or notifying
      subscribers. Remove the `.slice(-QUICK_PHRASES_MAX)` eviction. Update the
      `QuickPhrasesStore` interface and its comments.
    - `apps/board/src/board-storage.ts`: `writeQuickPhrases` no longer slices or cuts: it
      writes the list as given and returns `true`, or, when given more than
      `QUICK_PHRASES_MAX` phrases, writes nothing and returns `false`. `readQuickPhrases`
      keeps the first 100 entries and cuts each text to `QUICK_PHRASE_MAX_CHARS` instead of
      falling back to the default (`usedDefault: false`, reason `'truncated'`); an entry
      that is not `{ id: string, text: string }`, a wrong shape, or a bad version still
      falls back to the default. Fix the comment that says the oldest entries are evicted.
      The store does not write a shortened list back on load; only a later edit writes.
    - Update `apps/board/test/board-storage.test.ts` (the 6.1 cap tests): the history
      cap test stays; the quick-phrases test now checks that writing 101 phrases writes
      nothing and returns `false`, that a stored list of 150 reads back as its first 100
      with `usedDefault: false`, that a stored text of 600 characters reads back cut to
      500, and that a list with one malformed entry reads as the default.
    - Update `apps/board/test/quick-phrases.test.ts` (the 8.1 tests): fill the store to
      100, `add` returns `{ added: false, reason: 'full' }`, `phrases` and the stored
      value are unchanged, no subscriber is called, and no existing phrase text or id
      changed; after `remove`, `add` succeeds again; a loaded list of 150 phrases shows
      100 and the stored value stays at 150 until an edit.
    - _Requirements: 7.5, 7.6, 10.4_

  - [x]* 17.2 Update the corrupt-storage property test for the amended Property 12.
    - In `apps/board/test/board-storage.props.test.ts`, change the quick-phrases
      over-cap generators: a well-formed list over 100 entries, or with a text over 500
      characters, reads back as its first 100 entries with texts cut to 500, not as the
      default, and never throws. Every other generated case (non-JSON, wrong shape, bad
      version, malformed entries, message and history over their caps) still expects the
      documented default.
    - **Property 12: Corrupt or partial storage never throws and falls back to the documented default** (amended for quick phrases)
    - **Validates: Requirements 10.4, 7.6**

  - **Covers:** Req 7 AC 5, 6; Req 10 AC 4; P12 (amended).

- [x] 18. Start-camera setting and saving the Profile

  - [x] 18.1 Expose "Start camera when the page opens" through the Profile, and save the Profile.
    - Decision (design.md "Input controls"): the setting is the skeleton Profile's
      existing `startCameraOnLoad` field (default off), not a second Board-only field,
      because `importProfile` already applies the missing-or-non-boolean-becomes-default
      rule and reports it, and Requirement 11 AC 4 forbids a duplicate field. Do not add
      a field to `BoardOnlySettings`.
    - `apps/board/src/messages.ts`: add `settings.startCameraOnLoad: 'Start camera when
      the page opens'`.
    - `apps/board/src/board-settings.ts`: add `shouldStartCameraOnLoad(profile)` (true
      only when `profile.startCameraOnLoad === true`) and a comment on
      `BoardOnlySettings` that it deliberately has no start-camera field.
      `apps/board/src/board-storage.ts`: no schema change (the field lives in the stored
      `profile` part); update the comment on `DEFAULT_SETTINGS` to say the Profile's
      defaults, including `startCameraOnLoad: false`, apply when `profile` is empty.
    - `apps/board/src/main.ts`: add `saveProfile(profile)` to `BoardApp` (it calls
      `writeSettings({ profile, board })` with the current Board settings). `startBoard`
      (completed in Task 19.1) calls it with `JSON.parse(planchette.exportProfile())` on
      `mode-change` and when calibration ends, so the mode and the 2100 ms default (was 1400 ms until 27 Nov 2026; see design.md lever 1) are
      remembered; the Settings screen and import call it too (Task 25.1).
    - Extend `apps/board/test/board-settings.test.ts` (the 10.1 tests): the exported
      `profile` holds `startCameraOnLoad: false` by default; importing `startCameraOnLoad:
      true` gives `true`; a missing value and a non-boolean value (`"yes"`, `1`) give
      `false` and the report names `startCameraOnLoad`; `Object.keys(DEFAULT_BOARD_SETTINGS)`
      has no `startCameraOnLoad`. Add `apps/board/test/main-profile.test.ts`: `saveProfile`
      writes the settings key; a fresh `createBoardApp` on that storage returns the saved
      profile as `initialProfile` unchanged (a saved `mode: 'mouse'` and a saved
      `dwellTime` of 1400 are kept); with nothing saved, `initialProfile` is `{ dwellTime:
      2100 }` (was 1400 ms until 27 Nov 2026; see design.md lever 1) and `startCameraOnLoad` stays at the skeleton default `false`.
    - _Requirements: 6.9, 6.10, 11.4, 11.8, 13.8_

  - [x]* 18.2 Extend the settings round-trip property test for `startCameraOnLoad`.
    - In `apps/board/test/board-settings.props.test.ts` (the 10.2 test), add
      `profile.startCameraOnLoad` (boolean) to the generated valid exports and check it
      survives export then import; generate malformed exports whose
      `profile.startCameraOnLoad` is missing or not a boolean and check the import gives
      `false` and reports it.
    - **Property 7: Settings export/import round trip and clamping**
    - **Validates: Requirements 6.9, 6.6, 11.8**

  - **Covers:** Req 6 AC 9, 10; Req 11 AC 4, 8; Req 13 AC 8; P7 (extended).

- [x] 19. Input controls row

  - [x] 19.1 Build the Controls row and wire the camera, modes, ring and highlight.
    - `board/index.html`: add the Controls row (`<label for="mode">Input mode</label>` and
      `<select id="mode">`, `<button id="calibrate">`, and the camera toggle `<button
      class="target" data-planchette-target="camera-toggle">`) and the Status panel
      (`<div id="camera-status">` for the skeleton's tracking indicator and `<p
      id="controls-message" role="status">`). Move the existing `#camera-status` out of the
      header into the panel. Placement is done in Task 20.1.
    - Create `apps/board/src/board-controls.ts`: `mountBoardControls({ host, document,
      saveProfile })`, following `skeleton/demo/main.ts` and design.md "Input controls":
      the five modes in the selector (labels: Head + dwell, Head + gesture, Switch
      scanning, Gesture scanning, Mouse), `setMode` on change, the selector refreshed on
      `mode-change` and when calibration ends, the camera toggle (target `camera-toggle`,
      "Start camera" / "Stop camera") calling `startCamera()` / `stopCamera()` on `select`,
      reset to "Start camera" on a `tracking-status` failure, Calibrate (refuses with a
      message when the camera is off, else `startCalibration()`), the calibration step
      text, the head-modes-need-the-camera hint (shown only while the indicator is empty),
      and `saveProfile()` after a mode change and after calibration ends. The mode
      selector and Calibrate are not targets.
    - `apps/board/src/messages.ts`: every label and sentence the controls show (Input mode,
      the five mode labels, Start camera, Stop camera, Calibrate, Camera stopped., the
      calibrate-needs-camera sentence, the hint, the calibration step texts).
    - `apps/board/src/main.ts` (`startBoard`): call `createDwellRing(planchette)` and
      `createScanHighlight(planchette)` (from `@planchette/skeleton/ui`), mount the
      controls, and start the camera on load only when
      `shouldStartCameraOnLoad(planchette.getProfile())` is true (catch the rejection: the
      indicator shows the failure). The camera is started nowhere else.
      `board-dom.ts`'s existing registration loop registers `camera-toggle`; make sure
      `syncTargets` covers it and that `ACTIONS` has no entry for it.
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 5.8, 5.9, 9.3, 9.8_

  - [x] 19.2 Test the controls without a real camera.
    - Write `apps/board/test/board-controls.test.ts` (jsdom, a fake Planchette with spy
      `startCamera`, `stopCamera`, `setMode`, `startCalibration`, and a way to emit
      `mode-change`, `tracking-status`, `calibration-step`, `select`): the selector lists
      exactly the five modes; changing it calls `setMode` with that value; a `mode-change`
      event updates the selector; `startCamera` is not called on mount with the default
      Profile, is not called by a mode change, is called once when the camera toggle is
      selected while off, and is called on mount only when `startCameraOnLoad` is `true`;
      the toggle selected while on calls `stopCamera` and reads "Start camera"; a
      `tracking-status` failure resets the toggle; Calibrate with the camera off does not
      call `startCalibration` and shows the message; with it on, it does; `camera-toggle`
      is the only control registered as a target (the selector and Calibrate carry no
      `data-planchette-target`); the mode is saved (the `saveProfile` spy runs on
      `mode-change`).
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.9_

  - **Covers:** Req 13 AC 1–9; Req 5 AC 8, 9; Req 9 AC 3, 8.

- [x] 20. Viewport-fitting layout and equal-width cells

  - [x] 20.1 Lay the page out to fit 1366×768 and 1920×1080.
    - Restructure `board/index.html` and `apps/board/board.css` to the arrangement and
      numbers in design.md "Viewport layout" (defaults: target size 96, spacing 16,
      4 prediction slots): a two-column CSS grid, 12 px side and 8 px top and bottom page
      padding, a container of at most 1366 px centred with `margin: 0 auto`; left column
      Message bar (80 px high, `overflow-y: auto`, scrolled to its end after each change)
      above the active grid; right column in this order: `#prediction-strip` (reserved
      one-row space, 4 columns, present in the markup before any slot exists), the
      action row (3 columns × 2 rows), the camera toggle with the rest area spanning two
      columns (96 px high), the Controls row (48 px), the Status panel (112 px), the
      notice footer (112 px). The core and Letter sections occupy the same grid area.
      Drop the section borders and padding that cost height; keep each section's heading
      for screen readers as visually hidden text. Remove `body { min-height: 100vh }` and
      the old `.rest { min-height: 140px }`. The tracking indicator's failure state
      overlays the bottom of the right column (design.md "Status panel failure state").
    - Equal-width cells: replace `repeat(6, minmax(var(--target-size), max-content))`
      with `repeat(6, var(--cell-w))` and `grid-auto-rows: var(--target-size)`, with
      `--cell-w: calc(var(--target-size) * 4 / 3)`; grid targets and action targets use
      normal font weight at 24 px with a 2 px border and 2 px side padding; labels wrap
      at spaces only (no word splitting). Prediction slot buttons (created in Task 23.1)
      use `overflow-wrap: anywhere` at 24 px.
    - `apps/board/src/board-dom.ts`: after `showMessage`, set the Message bar's
      `scrollTop` to its `scrollHeight`. Keep `applyLayout` setting `--target-size` and
      `--target-gap` from the Profile.
    - Check the existing `board-dom-*.test.ts` helpers still find the elements they use
      (`apps/board/test/board-dom-helpers.ts`); fix them if the markup change breaks
      them.
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 9.1, 9.2_

  - [x] 20.2 Pin the layout structure in a unit test.
    - Write `apps/board/test/board-layout.test.ts` (jsdom): parse `board/index.html` and
      check the regions exist in the documented DOM order (Message bar, core section,
      letter section, `#prediction-strip` (present with no slot children), action row,
      camera toggle, rest area, Controls row, Status panel, footer notice); read
      `apps/board/board.css` as text and check that `--cell-w` is
      `calc(var(--target-size) * 4 / 3)`, that the grids use `repeat(6, var(--cell-w))`
      and `grid-auto-rows: var(--target-size)`, that `minmax(var(--target-size),
      max-content)` is gone, that grid and action targets are not bold, and that no
      font size below 24px appears for target text.
    - _Requirements: 14.4, 14.5, 14.6_

  - **Covers:** Req 14 AC 1–7; Req 9 AC 1, 2.

- [x] 21. Viewport end-to-end test and Playwright config

  - [x] 21.1 Make Playwright run the Board's specs.
    - Edit `playwright.config.ts` without touching the skeleton specs: keep the top-level
      `testDir: 'skeleton/test'` and the `chromium` and `built` projects exactly as they
      are, and add two projects with their own `testDir: 'apps/board/test'` and
      `testMatch: '**/*.e2e.ts'`: `board` (Desktop Chrome, the dev server at port 5199) and
      `board-built` (Desktop Chrome, `baseURL` the built output at port 5198, so the
      Content-Security-Policy is checked there too). Add a comment saying why.
    - Write `apps/board/test/playwright-config.test.ts` (Vitest): import the config and
      check that the top-level `testDir` is still `skeleton/test`, that the `chromium`
      and `built` projects are unchanged, and that `board` and `board-built` exist with
      `testDir` `apps/board/test`.
    - _Requirements: none (test infrastructure)_

  - [x] 21.2 Write the viewport end-to-end test.
    - Write `apps/board/test/board-viewport.e2e.ts` (pattern from
      `skeleton/test/demo.e2e.ts`: wrap `getUserMedia` to count and refuse calls). For
      each of 1366×768 and 1920×1080: open `/board/`, choose Mouse in `#mode` (the real
      selector), then in the Core view and again after clicking Spell: check
      `document.documentElement.scrollHeight <= innerHeight` and `scrollWidth <=
      innerWidth`; check every region (Message bar, active grid, `#prediction-strip`,
      action row, Controls row, Status panel, rest area, notice) lies inside the
      viewport; check every rectangle from `window.planchetteBoard.planchette.getTargets()`
      lies fully inside the viewport (28 grid targets in Spell mode, 36 in the Core view,
      plus the action, camera toggle, rest and Cancel/Undo targets); check no `.target`
      element overflows (`scrollWidth <= clientWidth`, `scrollHeight <= clientHeight`),
      using the longest labels ("different", "⌫ Backspace"); check the Message bar's
      rectangle is the same in the Core view and in Spell mode and is visible there;
      type a message longer than the bar and check the page still does not scroll and
      the bar shows its end; check `getUserMedia` was never called. No camera is started.
      The test runs in both the `board` and `board-built` projects.
    - The `window.planchetteBoard` hook already exists (`startBoard` in `main.ts`); do
      not add it again.
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 13.9_

  - **Covers:** Req 14 AC 1–5; Req 13 AC 9.

- [x] 22. Checkpoint - spelling, quick phrases, controls and layout complete
  - Run the full `apps/board` test suite, `npm run typecheck`, and `npm run test:e2e`
    (the new `board` and `board-built` projects with the existing skeleton ones). Ensure
    all tests pass, ask the user if questions arise.

- [x] 23. DOM layer: Prediction strip wiring

  - [x] 23.1 Register Prediction-strip targets and implement the slot-lock rule.
    - Extend `board-dom.ts`: render `predictionSlotCount` fixed-position slot buttons
      inside the `#prediction-strip` container reserved in Task 20.1 (do not add a new
      container),
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

  - [x] 23.2 Implement `complete-word` and use it for prediction-slot selection.
    - `apps/board/src/board-model.ts`: add `{ type: 'complete-word'; text: string }` to
      `BoardAction`. Empty `text` is a no-op (pushes nothing). When `partialWord === ''`
      it behaves exactly like `add-word`. Otherwise remove the trailing `partialWord`
      from the message (`message.slice(0, message.length - partialWord.length)`; the
      message always ends with a non-empty `partialWord`, see design.md), append `text`
      with the `add-word` spacing rule applied to the remainder, set `partialWord` to
      `''`, and push one undo snapshot through `apply`.
    - `apps/board/src/board-dom.ts`: the `prediction-slot-<i>` handler dispatches
      `{ type: 'complete-word', text: word }` instead of `add-word` (the pending-press
      lock stays). `apps/board/src/main.ts`: `BoardApp.selectPrediction` dispatches
      `complete-word` too (update its comment). Core-word selection stays `add-word`.
    - Update `apps/board/test/board-model.test.ts`: a named test `"he" then hello gives
      "hello"` (spell `h`, `e` on an empty model, `complete-word` `hello` gives message
      `hello`, `partialWord` `''`); a named test `"I want he" then help gives "I want
      help"` and Undo restores "I want he" with `partialWord` `'he'`; with an empty
      `partialWord` it equals `add-word` (including the spacing); empty text is a no-op
      and pushes nothing onto the undo stack; it is one undoable step; a spaced letter
      sequence after a space (`add-space`, then letters) completes without a doubled
      space.
    - Update `apps/board/test/board-dom-prediction.test.ts`: the test named "selecting a
      slot dispatches add-word..." now expects `complete-word` (rename it); add a case
      where a slot is selected while "ho" is spelled and the message equals that word
      alone (not "ho" followed by the word), `partialWord` `''`, and Undo brings "ho"
      back; the existing check that no slot moves during the press stays.
    - Update `apps/board/test/board-viewport.e2e.ts`: in the step that spells "he", after
      the existing slot checks, click the first non-empty slot (`#prediction-strip >
      button` with text) and check `#message-bar` has exactly that word as its text, then
      keep the existing `clear` step. Check any other test that asserts `add-word` from a
      slot (`apps/board/test/main-history*.test.ts` use `selectPrediction`; fix if they
      spell a partial word first).
    - _Requirements: 4.4, 4.18, 1.7_

  - [x]* 23.3 Write the property test for completing a word.
    - In `apps/board/test/board-model.props.test.ts`: generate `m0` (empty, or a string with
      no trailing whitespace), a non-empty letter string `p` (a-z, A-Z), and a non-empty word
      `w` (letters and apostrophes). Spell `p` after `m0` with `add-letter`, dispatch
      `complete-word` `w`, and compare with a second model that got `add-word` `w` on `m0`
      (same message, `partialWord` `''`); then `undo()` and check message
      `m0 + separator + p.toLowerCase()` and `partialWord` `p.toLowerCase()`, where the
      separator is one space when `m0` is non-empty and none otherwise.
    - Extend the Property 3 action generator (`actionArb`) with a `complete-word` arm
      (non-empty text), so the existing dispatch-then-undo property covers it.
    - **Property 17: Completing a word replaces the partial word**
    - **Validates: Requirements 4.18**

  - **Covers:** Req 4 AC 1, 4, 5, 18; Req 1 AC 7; P17 (P3 extended).

- [x] 24. DOM layer: Phrases view

  - [x] 24.1 Build the Phrases view, the Camera row, the view toggles and paging.
    - Decisions (requirements.md Req 7 AC 7 to 13; design.md "Input-mode integration",
      "Paging", "Phrase cell text", "Viewport layout"): three views `'core' | 'spell' |
      'phrases'`, one grid's targets registered at a time. `spell-toggle` takes core or
      phrases to spell and spell to core; `phrases-toggle` takes core or spell to
      phrases and phrases to core (toggle back always goes to Core). The Phrases view
      shows 10 phrases per page in 2 columns x 5 rows, row-major in list order (index `i`
      on a page at row `floor(i / 2)`, column `i % 2`), with `phrases-prev` (row 5,
      column 0) and `phrases-next` (row 5, column 1) on every page. A control with no
      page to go to is a dashed `aria-disabled` placeholder in the same place and is not
      registered. Entering the view shows page 0; an edit that removes the shown page
      shows the last page. Empty phrase cells are dashed placeholders with no target.
    - `board/index.html`: split the camera row into three columns: the camera toggle, a
      new `<button class="target" data-planchette-target="phrases-toggle"
      aria-pressed="false" data-text="actions.phrases">`, and the rest area. Add a third
      `<section class="board" hidden>` with `<div id="phrases-grid" class="phrases-grid"
      hidden>` in the grid area, and a visually hidden live region for "Page N of M".
      Change the rest area's visible text to `page.restArea` = "Rest area" and give the
      element `aria-label` = `page.restAreaHelp` ("Rest area. Nothing here is selected.").
    - `apps/board/src/messages.ts`: `actions.phrases: 'Phrases'`, `phrases.previous:
      'Previous'`, `phrases.next: 'Next'`, `phrases.pageOf: (n, m) => 'Page n of m'`,
      `page.phrasesTitle`, `page.restArea: 'Rest area'`, `page.restAreaHelp`.
    - `apps/board/board.css`: `.camera-rest` becomes `grid-template-columns: repeat(3,
      1fr)` with each item in one column (remove the `grid-column: 2 / span 2` rule, so
      the three targets are 148.7 x 96); `.phrases-grid { display: grid;
      grid-template-columns: repeat(2, calc((var(--cell-w) * 6 + var(--target-gap) * 4) /
      2)); grid-auto-rows: var(--target-size); gap: var(--target-gap) }` with
      `data-row`/`data-col` placement like the other grids; phrase cells: `display:
      -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow:
      hidden; text-align: left`, 24 px, normal weight, 2 px border, 4 px / 2 px padding.
    - `apps/board/src/board-dom.ts`: add `type View`, a `view` variable, `phrasesPage`,
      `PHRASES_PER_PAGE = 10`, and one `setView(next)` that unregisters the old view's
      grid targets and registers the new view's; `spellMode` is true only for `'spell'`
      (check that Spell-mode Backspace and the exit rules still hold). Render the page
      from `QuickPhrasesStore.phrases` (button text content = the full phrase, so the
      accessible name is the full phrase), register `quick-phrase-<id>` targets wired to
      `dispatch({type:'replace', text: phrase.text})` with the full text (one undoable
      action), register `phrases-prev` / `phrases-next` only when their page exists, and
      keep `aria-pressed` on both toggles in step with the view. Re-register phrase
      targets only on a store change, a page change, or a view change (subscribe to the
      store; never on message, prediction, speech or core/spell action). Update
      `syncTargets` so it covers the new view and `phrases-toggle` and has no `ACTIONS`
      entry gaps.
    - Update `apps/board/test/board-layout.test.ts` for the new camera-row structure: the
      DOM order (Message bar, core section, letter section, phrases section,
      `#prediction-strip`, action row, camera row holding `camera-toggle`,
      `phrases-toggle` and the rest area in that order, Controls row, Status panel,
      footer); CSS: `.camera-rest` has three equal columns and no `span 2`, `.phrases-grid`
      has two columns of `calc((var(--cell-w) * 6 + var(--target-gap) * 4) / 2)`, no font
      size below 24px for phrase cells; the rest area's visible text is "Rest area".
    - Write `apps/board/test/board-dom-quick-phrases.test.ts` (fake host, in-memory
      storage): entering the Phrases view registers exactly the first page's phrase
      targets plus `phrases-next` when there are more than 10 phrases, and unregisters
      the Core targets (and the reverse on toggling back); the toggle rules in all six
      transitions (core to spell, spell to core, core to phrases, phrases to core,
      phrases to spell, spell to phrases) with exactly one grid registered each time;
      cells are at row `floor(i / 2)`, column `i % 2`, `phrases-prev` / `phrases-next`
      at row 5 columns 0 and 1; with 25 phrases there are 3 pages, page 2 holds 5
      phrases, Previous is unregistered on page 0 and Next on page 2 (both drawn as
      `aria-disabled` placeholders in place), paging does not change any cell's
      position, and entering the view again shows page 0; selecting a phrase replaces
      the message with its full text (a 200-character phrase too) as one action undone
      by `board-model.undo()`, and the view does not change; a phrase over two lines has
      its full text as the button's text content; removing phrases so the shown page
      vanishes shows the last page; a prediction recompute, a core or letter selection, a
      Speak, and a message change do not re-register any phrase target (spy on
      `registerTarget`/`unregisterTarget`); an `add`/`remove`/`reorder` on the store
      re-registers them; `phrases-toggle` and `spell-toggle` `aria-pressed` follow the
      view.
    - _Requirements: 7.2, 7.3, 7.4, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.13, 3.1, 3.2, 14.8, 14.10_

  - [x] 24.2 Test the Phrases view and the Camera row at both viewport sizes.
    - Update `apps/board/test/board-viewport.e2e.ts` (both sizes, mouse mode, camera
      never started): after the existing Core and Spell checks, fill the Quick-phrases
      store with 25 phrases through the store the test hook exposes (add
      `window.planchetteBoard.quickPhrases` if the hook does not have it yet; do not
      write `localStorage` by hand), including one phrase longer than two lines (about
      150 characters), click Phrases, and check: no page scroll in either axis; every
      region and every target from `getTargets()` inside the viewport; exactly 10 phrase
      targets plus `phrases-next` on page 0, with the Message bar rectangle identical to
      the Core view's; each phrase cell and Previous/Next is 416 x 96 (within 0.5 px)
      and the rows are 96 apart + 16 gap; the page count is 3 (click Next twice, the last
      page holds 5 phrases and `phrases-next` is absent, `phrases-prev` present, and
      the placeholder is in the same place); no phrase cell overflows (`scrollHeight <=
      clientHeight` and `scrollWidth <= clientWidth`) and the long phrase's button text
      content is the full phrase, and clicking it makes `#message-bar` show the full text;
      the Camera row has three targets of 148.7 x 96 (within 0.5 px) with 16 px gaps, the
      rest area is at least 96 x 96, its visible text is one line ("Rest area") and not
      clipped; clicking Phrases again returns to the Core view and Spell from Phrases goes
      to the Letter board. Run in both the `board` and `board-built` projects.
    - _Requirements: 14.1, 14.2, 14.3, 14.8, 14.10, 7.7, 7.8, 7.9, 7.10, 7.11_

  - [x]* 24.3 Extend the fixed-grid property test to the Phrases view.
    - In `apps/board/test/board-dom-grid.props.test.ts`, extend the generator with
      Phrases-toggle, Spell-toggle, Next and Previous actions and a randomly sized,
      unedited phrase list (0 to 100 phrases). Assert, with the fake `Planchette`
      host's registry: exactly one view's grid targets registered after every step, and
      the view after each toggle follows the toggle rule; the Core targets keep their
      `(row, col, label)` whenever the Core view is shown at both ends, likewise the
      Letter targets in the Spell view; for each page, a phrase target's `(row, col,
      label)` is a function of its list index only (page `floor(n / 10)`, row
      `floor((n % 10) / 2)`, column `n % 2`) and `phrases-prev` / `phrases-next` are at
      (5, 0) and (5, 1) whenever registered; the same page shown at the start and the
      end of a sequence has identical registrations.
    - **Property 1: Fixed-grid position stability**
    - **Validates: Requirements 2.2, 2.3, 2.4, 3.3, 3.7, 7.4, 7.7, 7.8, 7.9, 7.10, 7.12**

  - **Covers:** Req 7 AC 2, 3, 4, 7–13; Req 3 AC 1, 2; Req 14 AC 1, 2, 3, 8, 10; Req 13 AC 1 (Camera row); P1 (extended).

- [x] 25. DOM layer: Settings screen

  - [x] 25.1 Build the Settings dialog, opened from the Controls row.
    - Layout change first (design.md "Controls row widths": the four controls need 598 px
      in a 478 px row, so Calibrate moves into the dialog). `board/index.html`: the
      Controls row holds `<label for="mode">`, `<select id="mode">` and a new plain
      `<button type="button" id="settings-button">` (label `controls.settings` =
      "Settings"), on one line, and no `#calibrate`; add `<dialog id="settings"
      aria-labelledby="settings-title">` containing the settings sections, the
      relocated `<button id="calibrate">` with its own message line, an "About" button,
      the `#about` section (shown in place of the settings sections, with a "Back"
      button) and a "Close" button. None of these is a `data-planchette-target`.
      `board-controls.ts`: bind `#calibrate` where it now is; with the camera on it closes
      the dialog, focuses `#settings-button`, then calls `startCalibration()`; with the
      camera off it keeps the dialog open and shows `calibrateNeedsCamera` in the
      dialog's message line (the step text still goes to `#controls-message`). Update
      `board-controls.test.ts` (Task 19.2's tests) for the new place, and
      `board-layout.test.ts` for the Controls row structure (label, select, Settings
      button, no Calibrate) and the dialog's presence in the DOM.
    - Dialog behaviour (design.md "Settings UI"): the Settings button calls
      `showModal()`; Escape and Close close it; on `close`, `board-dom` calls
      `settingsButton.focus()`; `board-dom` keeps a `settingsOpen` flag (set on open,
      cleared on `close`) and its `select` listener returns immediately while it is set,
      so no Target selection (any id, any input source) has an effect while the dialog is
      open; `cancel` is not ignored. The skeleton has no pause or modal API, so nothing
      else is done to the registered targets.
    - Extend `board-dom.ts` (or a new `apps/board/src/board-settings-dom.ts` if the
      file grows large): a keyboard-and-screen-reader-operable dialog with labelled
      controls for every Board/skeleton profile field (reusing the input-core Profile
      fields table's min/max as help text), the `voiceURI` `<select>` populated from
      `speechSynthesis.getVoices().filter(v => v.localService)`, the `speechRate`
      range input, the "Filter offensive words from suggestions" checkbox (on by
      default, changeable by the person or a carer, saved immediately), the "Start camera
      when the page opens" checkbox (bound to the Profile's `startCameraOnLoad`, off by
      default, saved with the Profile through `saveProfile` from Task 18.1; import also
      calls `saveProfile`), the Export/Import text box and buttons (mirroring the skeleton
      demo's profile box), and the Quick-phrases editor (add/edit/remove, Move
      up/Move down buttons for keyboard-operable reordering; when `add` returns `{ added:
      false }` the editor shows `messages.quickPhrases.full` and the list is unchanged).
    - Write `apps/board/test/settings-dom.test.ts` (jsdom, with a small stub for
      `HTMLDialogElement.showModal`/`close` that sets or clears `open` and fires
      `close`, because jsdom lacks them): the dialog has an accessible name; the
      Settings button opens it and Close closes it; **focus return**: after Close and
      after the stub's Escape-style close, `document.activeElement` is
      `#settings-button`; **selects ignored while open**: with the dialog open, firing
      `select` on the fake host for `core-*`, a prediction slot, `speak`, `clear`,
      `undo`, `spell-toggle`, `phrases-toggle`, `camera-toggle` and a phrase target
      changes nothing (message, view, page, no `startCamera`/`stopCamera`, no `speak()`
      call), and the same selects work again after it closes; Calibrate with the camera
      off leaves the dialog open and shows the message and does not call
      `startCalibration`; with the camera on it closes the dialog, focuses the Settings
      button and calls `startCalibration` once; opening and closing change neither the
      view nor the phrases page; the About button swaps in `#about` and Back returns;
      every control has an accessible name; Tab order reaches every control; the voice `<select>` shows
      "no local voices available" when `getVoices()` returns none with
      `localService: true`; Export populates the text box with the current
      `BoardExport` JSON; Import with a valid JSON string updates the model and
      reports no changes; Import with an out-of-range value reports the clamp.
    - Add the About screen (`#about`, a section of the Settings dialog opened by an About button inside it), text from
      `messages.ts`: version, not-a-medical-device notice, Universal Core vocabulary
      credit (CC BY 4.0, links), Prediction word list credit (hermitdave/FrequencyWords,
      Hermit Dave, OpenSubtitles 2018 via OPUS, CC BY-SA 4.0, changes made, links), the
      derivative-stays-CC-BY-SA and code-is-MIT statement, and the Exclusion list
      credit (LDNOOBW, copyright 2012-2020 Shutterstock, Inc., CC BY 4.0, changes
      made, links). In `settings-dom.test.ts`, also check: the start-camera checkbox has an accessible name,
      is unchecked on first run, and toggling it changes the Profile's
      `startCameraOnLoad` and saves it without starting the camera; adding a 101st phrase
      shows the full message and leaves the list unchanged; the checkbox has an
      accessible name, is checked on first run, and toggling it saves the setting and
      changes the Prediction strip's candidates without affecting the Message. Write
      `apps/board/test/about-dom.test.ts` (jsdom): the About button is reachable by Tab;
      the screen contains each credit, licence name, and link `href`, the notice, and a
      non-empty version string.
    - Write `apps/board/test/board-settings-dialog.e2e.ts` (Playwright, real
      Chromium, mouse mode, camera never started; runs in the `board` and `board-built`
      projects): **focus trapping**: after opening the dialog, press Tab more times than
      the dialog has controls and check `document.activeElement` is always inside
      `#settings`, and Shift+Tab from the first control wraps within it; the page
      controls behind it are not focusable (`#mode`, `#settings-button` are not reachable
      by Tab); **Escape**: Escape closes it (`dialog.open` false) and focus is on
      `#settings-button`; **focus return** also after the Close button; **selects ignored
      while open**: with a Message of "I" in the bar, open the dialog and mouse-click at
      the coordinates of a registered target's rectangle that lies under the dialog (read
      from `getTargets()`; the dialog is a modal, so the click lands on the dialog or its
      backdrop) and check the Message is unchanged and `getUserMedia` was not called; after
      closing, the same click on a core button adds its word; **layout**: at 1366 x 768
      and 1920 x 1080 the Settings button, the label and the mode selector lie in the
      Controls row, on one line (their `getBoundingClientRect().top` values are within 2
      px and none wraps), the row's `scrollWidth <= clientWidth`, and the Settings button
      is fully inside the viewport; the dialog itself fits inside the viewport or scrolls
      inside itself (the page does not scroll); an axe-core scan of the open dialog passes.
    - _Requirements: 6.1, 6.4, 6.8, 6.11, 6.12, 6.13, 6.14, 7.3, 8.4, 8.5, 9.9, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 13.1, 13.2, 13.6, 14.9_

  - **Covers:** Req 6 AC 1, 4, 11–14; Req 7 AC 3; Req 8 AC 4, 5; Req 9 AC 9; Req 12; Req 13 AC 1, 2, 6; Req 14 AC 9.

- [x] 26. Checkpoint - DOM layer complete
  - Run the full `apps/board` test suite and `npm run typecheck`. Ensure all tests
    pass, ask the user if questions arise.

- [x] 27. Accessibility, theme, and notice content

  - [x] 27.1 Apply calm styling, contrast, reduced motion, and the required notices.
    - Create `apps/board/demo.css`-equivalent stylesheet (named to match the app,
      e.g. `apps/board/board.css`) with: 24 CSS px minimum text size everywhere on the
      grid/strip/bar/list; measured 4.5:1 text contrast and 3:1 UI-part contrast
      against the page background (same measurement approach as
      `skeleton/test/demo.e2e.ts`); `prefers-reduced-motion` respected by relying on
      `createDwellRing`/`createScanHighlight`'s own built-in handling (no extra Board
      animation is added); no flashing element anywhere on the page.
    - Check the About screen from Task 25.1 uses the same 24 CSS px text size and
      contrast rules (the notice and credits come from `messages.ts`).
    - Write `apps/board/test/board-colours.test.ts` (jsdom + computed style, mirroring
      `demo.e2e.ts`'s contrast checks): every text colour/background pairing used on
      the grid, strip, bar, and Settings screen computes to at least 4.5:1; outlines
      and focus rings compute to at least 3:1.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.10_

  - **Covers:** Req 9 AC 1–7, 10.

- [x] 28. End-to-end tests (Playwright + axe-core)

  - [x] 28.1 Write the mouse- and keyboard-driven end-to-end suite.
    - Write `apps/board/test/board.e2e.ts` (pattern from `skeleton/test/demo.e2e.ts`;
      it runs under the `board` and `board-built` projects added in Task 21.1, so do not
      edit `playwright.config.ts` again): loads
      `/board/`, never starts the camera (the page's Start camera is not pressed); drives mouse clicks (core word → Message bar
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

- [x] 29. Checkpoint - end-to-end suite complete
  - Run `npm run test:e2e` and confirm the new Board specs pass alongside the existing
    skeleton ones. Ensure all tests pass, ask the user if questions arise.

- [x] 30. Dwell progress outline: no cover over the label, stroke contrast

  *(User decision, 27 Nov 2026: progress is drawn along the cell edge, not over the label. It
  replaces the "fill: none hardening" plan, which found no fill to remove. Design:
  design.md "Dwell progress outline".)*

  - [x] 30.1 Add the `outline` shape to `createDwellRing` in the skeleton.
    - Create `skeleton/src/ui/dwell-outline-geometry.ts` (pure, no DOM): `outlineGeometry(
      rect, border, radius)` returns the three strokes (edge 1 px `#ffffff`, track 4 px
      `#111111`, arc 2 px `#ffd400`), each with its inset from the border box (`border`,
      `border + 1`, `border + 3` as the centre line), its width, its corner radius
      (`max(0, radius - inset)`), and the arc's centre-line perimeter `2 (w + h) - 8 r + 2 pi r`.
      The width and radius come from the arguments; there is no magic number outside this
      file's constants.
    - Edit `skeleton/src/ui/dwell-ring.ts`: add `shape?: 'ring' | 'outline'` (default `'ring'`)
      and `elementFor?: (targetId: string) => HTMLElement | null` to `DwellRingOptions`
      (default: `data-planchette-target="<id>"`, else the id, as `scan-highlight.ts` does);
      export the `DwellRingShape` type from `skeleton/src/ui/index.ts`. With `shape` absent
      or `'ring'`, the existing code path, markup and behaviour must not change at all (the
      skeleton demo and `skeleton/test/demo.e2e.ts` depend on it). With `'outline'`, build
      the drawing in design.md "Dwell progress outline": one `position: fixed`,
      `pointer-events: none`, `aria-hidden` SVG with `data-planchette="dwell-ring"` and
      `data-shape="outline"`, placed on the element's `getBoundingClientRect()` (fallback:
      the rect from `planchette.getTargets()`, square corners, zero border); three `<rect>`
      elements with `fill="none"` and `style.fill = 'none'` (and `fill="none"` on the root);
      the arc starting after the top-left corner and running clockwise, its dash length
      `progress` of the computed perimeter; quarter steps through `shownProgress` and no
      transition under reduced motion; a closed full loop for 600 ms on a non-scan `select`,
      with no tick and no pulse; re-measure (rect, border width, radius, dash length) on each
      `dwell-progress`, on `resize` and `scroll` and after a `select` in the next animation
      frame, and through a `ResizeObserver` on the current element when it exists; remove
      every listener and the observer in `destroy()`. Set styles only through `style.*` and
      attributes on SVG elements (CSP-safe, as the file already does).
    - Do not edit anything under `.kiro/specs/input-core/`. The input-core design's "UI
      helpers" paragraph needs the amendment recorded in design.md ("Input-core impact"):
      the new options. That amendment is reported to the user, not made. If the skeleton
      has an API-surface test or doc that lists `DwellRingOptions` fields, update it for
      the two new optional fields.
    - _Requirements: 9.3, 9.11, 9.13_

  - [x] 30.2 Use the outline in the Board.
    - `apps/board/src/main.ts` (`startBoard`): replace `createDwellRing(planchette)` with
      `createDwellRing(planchette, { shape: 'outline' })`. `skeleton/demo/main.ts` keeps its
      call unchanged. No change to `board.css`: the outline is an overlay and takes no part
      in layout.
    - _Requirements: 9.3, 9.11, 9.13_

  - [x] 30.3 Test the outline in the skeleton.
    - Write `skeleton/test/dwell-ring.test.ts` (`// @vitest-environment jsdom`; `jsdom` is a
      root dependency already used by the Board's tests) with a fake Planchette that can
      emit `dwell-progress`, `select` and `getTargets()`: with `shape: 'outline'`, after
      progress 0.5 every `rect` has `fill` `none` (attribute and `style.fill`), the root has
      `fill="none"`, the markup has no `circle` and no element with another fill; a document
      rule `rect { fill: #fff }` does not change `style.fill`; the three rects take the
      element's stubbed rect, border width and `border-radius` with the insets above; after
      the stubbed rect changes, a `resize` and one frame, they follow it and the dash length
      is recomputed; the arc length is `progress` of the perimeter; `reducedMotion: true`
      gives quarter steps and no transition; a non-scan `select` shows a closed loop and no
      tick for 600 ms (fake timers) and a scan `select` shows nothing; `destroy()` removes
      the SVG and the listeners. The default shape still builds the unchanged circles and
      tick.
    - Write `skeleton/test/dwell-outline-geometry.test.ts` (examples from design.md: 128 x 96
      with border 2 and radius 8; 197 x 148 with border 4 and radius 8; 96 x 96 with border 0
      and radius 0; a radius larger than half the side): strokes inside the rect, adjacent,
      no negative radius, the perimeter formula.
    - _Requirements: 9.11, 9.13_

  - [x] 30.4 Test the outline's contrast on the Board page.
    - Write `apps/board/test/ring-contrast.test.ts` (Vitest, the contrast maths of
      `board-colours.test.ts`): read the track, edge and arc colours from an outline created
      in jsdom; take the backgrounds and `--accent` from `apps/board/board.css` (`--panel`,
      `--pressed`, `--bg`, `--accent`) and compose the scan highlight's `rgba(255, 212, 0,
      0.45)` tint over the normal and pressed ones (the tint is read from the skeleton's
      `scan-highlight.ts` source text, so the test fails if it changes); assert at least 3 for
      the track on each of the five states (normal, pressed, scan-highlighted, scan-highlighted
      and pressed, empty/dashed), for the edge against `--accent`, and for the arc against the
      track; also assert that the track against `--accent` alone is below 3 (documents why
      the edge exists).
    - _Requirements: 9.4, 9.12_

  - [x] 30.5 Test during a dwell that the label stays visible and the outline follows the cell.
    - Write `apps/board/test/board-dwell-outline.e2e.ts` (runs in the `board` and
      `board-built` projects; no camera; `getUserMedia` is wrapped and counted as in
      `board-colours.e2e.ts` and never called). Mouse mode has no dwell (the skeleton selects
      on a click there and emits no `dwell-progress`), so the dwell is driven in head + dwell
      mode with synthetic camera samples through `window.planchetteBoard.planchette.
      feedSamples`, copying the `lookAt` helper in `skeleton/test/demo.e2e.ts` (the start-up
      centre step first, then samples resting on the target's centre for about 40% of the
      dwell time).
    - Cell sizes, read from the page (`--target-size`), not hard-coded: 96 (1366 x 768), the
      scaled size at 1920 x 1080, and 148 (a saved Profile with `targetSize` 148, written to
      `planchette-board:settings` before load, at 1920 x 1080, where the page may scroll).
      At each: (a) for every registered target, with no dwell, the label's text box (a `Range`
      over the button's text, union of its client rects) lies inside the border box less
      `b + 5` px, `b` being the computed border width; (b) for "different" (Core grid),
      "Backspace" (Letter board, Spell view), a two-line phrase (Phrases view), a long
      prediction slot and the Spell toggle while pressed, during the dwell
      (`data-state="filling"`) `document.elementFromPoint` at the label's centre returns the
      button and every outline `rect` has a computed `fill` of `none`; (c) the outline's box
      equals the target's border box, and the target's size and every region's rectangle in
      `REGIONS` are unchanged from before the dwell (no reflow); (d) after setting the window
      size to another size mid-dwell, the outline's box equals the target's new box.
    - _Requirements: 9.11, 9.13, 14.12_

  - **Covers:** Req 9 AC 3, 4, 11, 12, 13.

- [x] 31. Scale the layout to the viewport

  *(At this step the Message bar is still 80 px high, so the 1920×1080 figures below (148,
  972 px, 976 px) are those of an 80 px bar. Task 33 changes them to 139 and 1077 px with a 131
  px bar and updates the tests named here.)*

  - [x] 31.1 Add `renderedCellSize` and use it in `applyLayout`.
    - Create `apps/board/src/board-scale.ts` (pure, no DOM): `renderedCellSize(profileSize,
      gap, stripRows, viewport)` returns `max(profileSize, floor(min(sFitHeight,
      sFitWidth)))` with `sFitHeight = min((vh - 96 - 6g) / 6, (vh - 288 - (k+5)g) /
      (k+3))` and `sFitWidth = (vw - 502 - 6g) / 8` (design.md "Scaling to the viewport"),
      a whole number, never below `profileSize`. Treat a non-finite result as
      `profileSize`.
    - `apps/board/src/board-dom.ts`: in `applyLayout`, call it with the Profile's
      `targetSize` and `targetSpacing`, `stripRows = max(1, ceil(strip.slots.length /
      4))` (1 when the app has no strip) and `{ width: innerWidth, height: innerHeight
      }`, and set `--target-size` to the result and `--target-gap` to the Profile's
      spacing, with `style.setProperty` only (no `style` attribute, so the page's
      Content-Security-Policy holds). `syncTargets` already calls `applyLayout()` before
      it re-reads every registered rectangle, on `resize`, `scroll` and `mode-change`, so
      the registered target rectangles follow the new size; keep that order and keep
      `host.setScreen` in the same function. Make the Settings Profile changes that alter
      the target size or spacing end in `syncTargets()` (they already do through
      `mountBoardSettings`).
    - `apps/board/board.css`: change `.page { max-width }` to `calc(var(--cell-w) * 6 +
      var(--target-gap) * 6 + 502px)` (1366 px at the defaults). Nothing else changes in
      the CSS: every size already reads `--target-size`. Update the comment above `.page`.
    - _Requirements: 14.6, 14.7, 14.11, 14.12, 14.13, 9.1_

  - [x] 31.2 Test the scale function, the CSS and the target rectangles.
    - Write `apps/board/test/board-scale.test.ts` (examples): 1366×768 with the defaults
      gives 96; 1920×1080 gives 148 (the arithmetic in design.md); 1920×1080 with
      `stripRows` 2 gives 136; a Profile size of 200 at 1920×1080 gives 200; a 100×100
      viewport gives the Profile size; a Profile size of 64 at 1366×768 gives 96.
    - Update `apps/board/test/board-layout.test.ts`: the `.page` `max-width` in
      `board.css` is the `calc(...)` above, and the file sets no `fill`, `width` or
      `height` in px for the grids.
    - Write `apps/board/test/board-dom-scale.test.ts` (jsdom, fake host, `innerWidth` and
      `innerHeight` set before and after a `resize` event): `--target-size` is `96px` at
      1366×768 and `148px` at 1920×1080; after the `resize` every registered id got an
      `updateTarget` call, made after `--target-size` was set; `--target-gap` stays the
      Profile's spacing; the document element has no `style` attribute written by
      `setAttribute`.
    - _Requirements: 14.6, 14.11, 14.12, 14.13_

  - [x]* 31.3 Write the property test for the rendered cell size.
    - In `apps/board/test/board-scale.props.test.ts`, generate a whole-number Profile
      size in 64 to 400, a whole-number spacing in 8 to 64, `stripRows` 1 or 2, and a
      viewport width and height from 1 to 4000; assert Property 18 as written in
      design.md: whole number, at least the Profile size, fits at `s` and does not fit
      at `s + 1` when `s` is above the Profile size, never decreases when the viewport
      grows, and 96 for the defaults at 1366×768.
    - **Property 18: Rendered cell size**
    - **Validates: Requirements 14.6, 14.11, 14.13**

  - [x] 31.4 Extend the viewport end-to-end test to 1920×1080.
    - In `apps/board/test/board-viewport.e2e.ts`: read the rendered size `s` from the page
      (`--target-size`) and replace the fixed numbers (cell 416×96, camera row 148.7×96,
      phrase rows 96 + 16 apart, the 1920×1080 bar) by expressions of `s` and the Profile
      gap; assert that the cell widths within each grid are equal, that `s` is 96 at
      1366×768 and 148 at 1920×1080, and that at 1920×1080 the `.page` bounding box is at
      least 90% of the viewport height (972 px) in the Core, Spell (976 px) and Phrases
      views, with the target rectangles from `getTargets()` matching the rendered
      elements at the new size. Every existing check (no scroll, regions and targets
      inside the viewport, no overflow, the Message bar unchanged between views) must still
      pass at both sizes in all three views, in the `board` and `board-built` projects. No
      camera is started.
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.10, 14.11, 14.12, 14.13_

  - **Covers:** Req 14 AC 1–13 (AC 11–13 are new); Req 9 AC 1.

- [x] 32. First-run hint

  - [x] 32.1 Show the hint until the first select or camera start.
    - `apps/board/src/messages.ts`: add `controls.firstRunHint` = "Choose an input mode,
      or press Start camera".
    - `apps/board/src/main.ts`: `createBoardApp` exposes `firstRun`, the `usedDefault`
      value of the `readSettings` result (true when no saved Profile was found);
      `startBoard` passes it to `mountBoardControls({ ..., firstRun })`.
    - `apps/board/src/board-controls.ts`: add the optional `firstRun` option (default
      `false`) and an in-memory `firstRunActive` starting at it. `showHint()` chooses, in
      this order: the first-run hint while `firstRunActive`, else the head-modes-need-
      the-camera hint when the mode needs the camera and the camera is off, else the privacy
      hint (design.md "First-run hint"), so two hints are never shown together and the
      existing message line is reused (no new element). `firstRunActive` becomes false on
      the first `select` event of any target, or the first time `setCameraOn(true)` runs,
      whichever comes first, and never returns to true on that page. The hint never calls
      `startCamera`: the camera still starts only on a press of the toggle, or on load when
      the Profile's `startCameraOnLoad` is on.
    - _Requirements: 13.5, 13.7, 13.10, 13.11, 13.12, 13.13_

  - [x] 32.2 Test the hint without a camera.
    - Extend `apps/board/test/board-controls.test.ts` (jsdom, the fake Planchette with
      spies): with `firstRun: true` the message line reads exactly the hint and not the
      needs-the-camera or privacy text; after a `select` of any target it shows the usual
      line for the mode and camera state; after the camera toggle is selected (and after
      `setCameraOn(true)`) it does the same; whichever comes first ends it and it does not
      return; a mode change does not end it; with `firstRun: false` (or no option) it is
      never shown; in every case `startCamera` is called only by the toggle selection,
      never by the hint, and never on mount with the default Profile.
    - Extend `apps/board/test/main-profile.test.ts`: `createBoardApp` over empty storage
      has `firstRun` true; over storage holding a saved Profile (a written
      `planchette-board:settings`) it is false; over corrupt settings it is true.
    - _Requirements: 13.10, 13.11, 13.12, 13.13_

  - [x] 32.3 Test that the hint fits, at both sizes.
    - In `apps/board/test/board-viewport.e2e.ts`, add a test run at 1366×768 and 1920×1080
      in a fresh browser context (no saved Profile), without choosing a mode first: the
      `#controls-message` text is the hint, the page does not scroll, the message line
      does not scroll inside itself (`scrollHeight <= clientHeight`), and the hint lies
      inside the Status panel. Then choose Mouse in `#mode`, select one Core target (the
      first select), and assert that the hint is gone and that the rectangles of every
      region in `REGIONS` are unchanged from before (no layout shift). Reload with the
      Profile now saved and assert the hint is not shown. `getUserMedia` is never called.
    - _Requirements: 13.10, 13.11, 13.12, 13.13_

  - **Covers:** Req 13 AC 10–13.

- [x] 33. Message bar text: 48 px, two lines where the viewport is tall

  *(User decision, 27 Nov 2026, option (a). Design: design.md "Message bar text".)*

  - [x] 33.1 Add `messageBarLayout` and use it in `applyLayout`.
    - `apps/board/src/board-scale.ts`: add the constants `BAR_TEXT_PX = 48`,
      `BAR_LINE_FACTOR = 1.3`, `BAR_BORDER_PX = 6`, `BAR_ONE_LINE_HEIGHT = 80` and
      `TWO_LINE_MIN_VIEWPORT_HEIGHT = 900`; give `renderedCellSize` an optional `barHeight`
      argument (default 80, so Task 31's calls and tests keep working) with
      `sFitHeight = min((vh - 16 - barHeight - 6g) / 6, (vh - 288 - (k+5)g) / (k+3))`; add
      the pure `messageBarLayout(profileSize, gap, stripRows, viewport)` returning `{ lines,
      barHeight, cellSize, pageMinHeight }` by the rule in design.md (131 = `ceil(2 * 1.3 *
      48) + 6` when `innerHeight >= 900` and the cell size with that bar is at least the
      Profile size; otherwise 80; `pageMinHeight = 16 + max(H + 6s + 6g, (k+3)s + (k+5)g +
      272)`). Treat a non-finite result as the one-line bar at the Profile size.
    - `apps/board/src/board-dom.ts`: in `applyLayout`, call `messageBarLayout` instead of
      `renderedCellSize`, and set `--target-size`, `--target-gap`, `--bar-height` (px),
      `--bar-lines` (`1` or `2`) and `--page-min-height` (px) with `style.setProperty` only
      (no `style` attribute, so the Content-Security-Policy holds); then scroll the Message bar
      to its end (`messageBar.scrollTop = messageBar.scrollHeight`). `syncTargets` already
      calls `applyLayout()` before it re-reads every registered rectangle, so every
      registered target's rectangle follows the new height after the bar changes height; keep
      that order. The Message bar is display-only and is not registered.
    - `apps/board/board.css`: `#message-bar { height: var(--bar-height, 80px); padding: 0 8px;
      font-size: 48px; line-height: calc((var(--bar-height, 80px) - 6px) / var(--bar-lines,
      1)) }` (the 3 px border and the other rules stay); `.page { grid-template-rows:
      var(--bar-height, 80px) auto; min-height: var(--page-min-height, 0); align-content:
      start }`; update the comments above `.page` and `#message-bar`.
    - _Requirements: 9.2, 14.3, 14.11, 14.12, 14.13, 14.14, 14.15, 14.16, 14.17_

  - [x] 33.2 Test the layout function, the CSS and the custom properties.
    - Extend `apps/board/test/board-scale.test.ts` with `messageBarLayout` examples (defaults
      unless stated): 1366×768 gives `{ lines: 1, barHeight: 80, cellSize: 96, pageMinHeight:
      768 }`; 1920×1080 gives `{ 2, 131, 139, 1077 }`; 1600×900 gives `{ 2, 131, 109, 897 }`;
      1599×899 gives a one-line bar and 117; 1920×1080 with `stripRows` 2 gives two lines and
      136; a Profile size of 200 at 1920×1080 gives a one-line bar and 200; a 100×100
      viewport gives the one-line bar and the Profile size. `renderedCellSize` with the
      default bar still gives 96 at 1366×768 and 148 at 1920×1080 (Task 31's examples
      stand).
    - Update `apps/board/test/board-layout.test.ts`: `#message-bar` declares `font-size:
      48px`, `height: var(--bar-height, 80px)` and a `line-height` that divides the text
      area by `--bar-lines`; `.page` reads `--bar-height` and `--page-min-height`; the 24 px
      minimum check still passes (48 is above it).
    - Update `apps/board/test/board-dom-scale.test.ts` (jsdom, fake host): at 1366×768
      `--bar-height` is `80px`, `--bar-lines` `1`, `--target-size` `96px`; at 1920×1080 they are
      `131px`, `2`, `139px`, and `--page-min-height` is `1077px`; after a `resize` from one to
      the other every registered id got an `updateTarget` call made after the custom
      properties were set (the Message bar is display-only and is not among them); the document element has
      no `style` attribute written by `setAttribute`.
    - _Requirements: 14.12, 14.14, 14.15, 14.17_

  - [x]* 33.3 Extend the property test for the rendered cell size.
    - In `apps/board/test/board-scale.props.test.ts` (created in Task 31.3), assert Property
      18 as now written in design.md for `messageBarLayout`: bar height 80 or 131, 131 only
      at a viewport height of at least 900 and a cell size at least the Profile size, whole
      number at least the Profile size, fits at `s` and not at `s + 1` with that bar,
      non-decreasing in the viewport when the bar height is the same, `pageMinHeight` equal
      to the page-height formula, and the two default-size results (1366×768 gives 80 and 96;
      1920×1080 gives 131 and 139).
    - **Property 18: Rendered cell size**
    - **Validates: Requirements 14.6, 14.11, 14.13, 14.15, 14.17**

  - [x] 33.4 Test the bar's text and height end to end, and update the viewport test.
    - Write `apps/board/test/board-message-bar.e2e.ts` (`board` and `board-built` projects,
      mouse mode, no camera; `getUserMedia` counted and never called), at 1366×768 and at
      1920×1080, as in design.md "Message bar text":
      (1) the computed `font-size` of `#message-bar` is at least twice that of `body`;
      (2) at 1920×1080 a message that wraps to two lines (Core words added until the bar's
      `scrollHeight` exceeds one line height) has `scrollHeight <= clientHeight`, the bar's
      `clientHeight` is at least 2 x its computed line height, `scrollWidth <= clientWidth`
      and the document does not scroll; a longer message is scrolled to its end
      (`scrollTop + clientHeight == scrollHeight`) and shows exactly two full lines;
      (3) at 1366×768 the bar is 80 px high with `clientHeight` equal to one line height, a
      long message (60 x "different") keeps `scrollHeight > clientHeight`, is scrolled to its
      end, shows its last word, and the document does not scroll in either axis;
      (4) at each size the Message bar's rectangle is identical in the Core, Spell and
      Phrases views, before and after the long message, and the `.page` box has the same
      height in the three views.
    - Update `apps/board/test/board-viewport.e2e.ts`. It has no 24 px or 80 px expectation
      for the bar (it compares the bar's rectangle between views, which must still hold), so
      the changes are the cell-size ones: `s` is 96 at 1366×768 and 139 at 1920×1080 (not
      148), the `.page` box is at least 90% of the viewport height (972 px) and in fact
      1077 px in the Core, Spell (not 976) and Phrases views, and every other expression of
      `s` and of the bar height is read from the page (`--target-size`, `--bar-height`)
      instead of a fixed number. Every existing check (no scroll, regions and targets inside
      the viewport, no overflow) must still pass at both sizes in all three views, in the
      `board` and `board-built` projects.
    - _Requirements: 9.2, 14.1, 14.2, 14.3, 14.13, 14.14, 14.15, 14.16, 14.17_

  - **Covers:** Req 14 AC 14–17 (new); Req 14 AC 3, 11–13; Req 9 AC 2.

- [x] 34. Checkpoint - ring, scaling, first-run hint and Message bar complete
  - Run the full `apps/board` test suite, the skeleton tests, `npm run typecheck` and
    `npm run test:e2e` (the `chromium`, `built`, `board` and `board-built` projects; the
    skeleton demo must still pass with its unchanged ring). Ensure all tests pass, ask the
    user if questions arise.

- [x] 35. MCP configuration for the dwell simulator

  - [x] 35.1 Add the workspace MCP configuration and verify the relative path.
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
      workspace file, and do not continue to Task 36 until the user replies.
    - Write `tools/dwell-sim-mcp/test/board-mcp-config.test.ts`: `.kiro/settings/mcp.json`
      parses as JSON, contains a `dwell-sim` entry whose `args` path does not start
      with `/` or a drive letter, and whose `command` is `node`.
    - _Requirements: none (design.md "Layout validation" infrastructure)_

  - **Covers:** design.md "Configuring the MCP server".

- [x] 36. Board layout export and the six-preset gate run

  - [x] 36.1 Export the Board's four layouts.
    - Write `tools/dwell-sim-mcp/scripts/export-board-layout.ts` (pattern from
      `export-demo-layout.ts`): serves the built `dist/board/index.html`, opens it at
      1920×1080 and 1366×768, reads `window.planchetteBoard.planchette.getTargets()`
      for the core-grid view, presses the Spell-mode toggle and reads targets again
      for the spell view, and writes the four `board-layout-*.json` files next to the
      existing demo-layout files.
    - Add a `demo:export:board` script to `tools/dwell-sim-mcp/package.json` running
      this script via `dist-scripts/export-board-layout.js`. The `window.planchetteBoard`
      test hook already exists in `apps/board/src/main.ts` (created with `startBoard`
      and used by Task 21.2); do not add it again. Export the layouts from the viewport
      layout built in Task 20.1 and scaled to the viewport in Tasks 31.1 and 33.1: the
      1920×1080 files hold the scaled layout (cells 139 px high at the defaults, with the
      131 px Message bar), not the 1366×768
      layout moved to the centre, so the gate measures what a person sees at that size.
      The script opens each page at its own size before reading `getTargets()`, so no
      extra step is needed; the test checks that the 1920×1080 core file has a 139 px
      high Core-grid cell and the 1366×768 file a 96 px one.
    - Write `tools/dwell-sim-mcp/test/export-board-layout.test.ts`: the pure
      `toLayoutJson`-equivalent conversion function used by the script produces the
      expected `{ screen, targets }` shape from a fixed sample input (unit test; the
      Playwright-driving `main` is excluded from this test, matching
      `export-demo-layout.ts`'s own test boundary).
    - _Requirements: none (design.md "Exporting the Board's layout")_

  - [x] 36.2 Generalise the preset runner and run the six-preset gate.
    - Write `tools/dwell-sim-mcp/scripts/run-board-presets.ts`: imports
      `runDemoPresets`/`DemoLayout`/`DemoHandler` from `run-demo-presets.ts` (no
      duplication), passes the four Board layouts and a `{ eachTarget: 2 }` task,
      and runs all six presets (`steady`, `slow`, `head-tremor`, `strong-head-tremor`,
      `small-range`, `reads-while-pointing`) at the Board's default profile (dwell
      time 2100 ms, per design.md's chosen lever 1; was 1400 ms until 27 Nov 2026) against each of the four layouts.
    - Write `tools/dwell-sim-mcp/test/run-board-presets.test.ts`: with a stub
      `DemoHandler`, `runBoardPresets` (the board-specific thin wrapper) calls the
      handler once per preset per layout (24 calls total) with the documented task and
      seed.
    - Append the run's `formatPresetEntry`-produced text to `docs/kiro-journal.md`
      (append step driven by the same `--append` flag pattern as
      `run-demo-presets.ts`).
    - **Acceptance gate**: the `reads-while-pointing` preset's `accidentalPer100Intended`
      metric must be at or below 10 on all four Board layouts, run at the Board default
      (2100 ms), seed 1. The rule is unchanged.
      **If it is missed: stop and report the numbers to the user** (the preset, the
      layout, `accidentalPer100Intended`, the causes found) with the options, and wait.
      Do not loosen the gate, and do not change the design levers in design.md's "Design
      levers used" section, without the user's approval. Do not proceed to Task 36.3
      until the user replies.
    - _Requirements: none (design.md "Running the six presets", "The acceptance target")_

  - [ ]* 36.3 Pin any surfaced counterexample.
    - WHERE a `simulate` run from Task 36.2 surfaces an accidental selection whose
      cause is not the expected `reading-pause` cause at or below the target rate,
      write `apps/board/test/layout-regressions.test.ts`: a fixed regression test that
      re-runs that exact `simulate` call (preset, layout file, seed, task) and asserts
      the metric now passes. Skip this sub-task entirely if no such counterexample is
      found.
    - No pins needed (27 Nov 2026): every accidental selection whose cause is not
      reading-pause is far below the rate (pass-over 9–13, waiting 2–6, other 1–3 per
      layout on reads-while-pointing; tremor-at-edge 1–3 on the tremor presets).
      small-range's "other" accidents (31–46 per layout) are logged as an open question.
    - _Requirements: none (design.md "Counterexample policy")_

  - **Covers:** design.md "Running the six presets", "The acceptance target", "Counterexample policy".

- [x] 37. Compare runs for layout-affecting changes made in this spec

  - [x] 37.1 Record a `compare` baseline-vs-chosen-defaults run.
    - Using the `compare` MCP tool (via a script or an ad hoc MCP call recorded in the
      journal, not a new source file, mirroring how dwell-sim-mcp's README documents
      `compare` usage), run two comparisons on the Board's core-grid layout, same seed,
      same task, for the `reads-while-pointing` preset, isolating the effect of lever 1
      (dwell time) from design.md: (a) 1400 ms against 2100 ms (the Board default) on
      core-1366x768, reporting reads-while-pointing (the demo comparison); and (b) the
      input-core global default dwell time (1000 ms) against the Board default
      (2100 ms).
    - Append the `compare` verdict and the `pairs` time-to-select deltas to
      `docs/kiro-journal.md`, including the expected `slow`-preset time-to-select
      trade-off noted in design.md: about +700 ms per selection (core-1366 `steady`
      median 2533 → 3233 ms, `slow` 3967 → 4667 ms).
    - _Requirements: none (design.md "Comparing layout changes")_

  - **Covers:** design.md "Comparing layout changes".

- [-] 38. Final checkpoint
  - Run `npm test` and `npm run build` and `npm run test:e2e` at the repository root.
    Confirm the Task 36.2 acceptance gate still passes (metrics are deterministic for
    a fixed seed, so this should not need re-running unless source changed since
    Task 36). Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` (property and regression tests) are optional sub-tasks and
  can be skipped for a faster MVP, except that skipping Task 36.3 is only valid when
  no counterexample was found (noted inline on that task). All eighteen numbered
  properties in design.md are implemented as required sub-tasks regardless of the
  `*` marking convention used elsewhere in this plan for clarity; the `*` here follows
  this workflow's own convention that test-only sub-tasks may be marked optional, but
  the properties listed in design.md are the ones explicitly requested and should not
  be skipped without reporting that gap to the user.
- `apps/board/src/main.ts` is extended incrementally across Tasks 10, 13, 14, 18, 19, 23,
  24, 25 and 32; no task leaves it in a state that does not compile or run.
- The Message-bar text size is decided (user decision, 27 Nov 2026, option (a)) and is Task
  33: 48 px text at every size, a 131 px two-line bar where the viewport is at least 900 px
  high (1920×1080: cells 139 px), an 80 px one-line bar that scrolls below that (1366×768:
  cells 96 px). Task 31 is built first with the 80 px bar (148 px cells at 1920×1080); Task 33
  then changes those figures and the tests that name them. The checkpoint and the tasks after
  it are numbered 34 to 38.
- The dwell progress outline (Task 30) is decided too (user decision, 27 Nov 2026). It adds an
  option to the skeleton's `createDwellRing`, so the input-core design's "UI helpers"
  paragraph needs a one-sentence amendment, which is reported to the user and not made in
  this spec. The skeleton demo keeps the ring.
- The dwell-sim-mcp package (`tools/dwell-sim-mcp`) is extended, not duplicated:
  Tasks 35–37 add Board-specific scripts and one config file, reusing
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
    { "id": 6, "tasks": ["4.2", "4.3", "5.1", "6.1"] },
    { "id": 7, "tasks": ["4.4", "5.2", "5.3", "5.4", "5.5", "5.6", "6.2"] },
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
    { "id": 21, "tasks": ["16.2", "17.1"] },
    { "id": 22, "tasks": ["17.2"] },
    { "id": 23, "tasks": ["18.1"] },
    { "id": 24, "tasks": ["18.2"] },
    { "id": 25, "tasks": ["19.1"] },
    { "id": 26, "tasks": ["19.2"] },
    { "id": 27, "tasks": ["20.1"] },
    { "id": 28, "tasks": ["20.2"] },
    { "id": 29, "tasks": ["21.1"] },
    { "id": 30, "tasks": ["21.2"] },
    { "id": 31, "tasks": ["22"] },
    { "id": 32, "tasks": ["23.1"] },
    { "id": 33, "tasks": ["23.2"] },
    { "id": 34, "tasks": ["23.3"] },
    { "id": 35, "tasks": ["24.1"] },
    { "id": 36, "tasks": ["24.2", "24.3"] },
    { "id": 37, "tasks": ["25.1"] },
    { "id": 38, "tasks": ["26"] },
    { "id": 39, "tasks": ["27.1"] },
    { "id": 40, "tasks": ["28.1"] },
    { "id": 41, "tasks": ["29"] },
    { "id": 42, "tasks": ["30.1", "31.1", "32.1"] },
    { "id": 43, "tasks": ["30.2", "30.3", "30.4", "31.2", "31.3", "32.2"] },
    { "id": 44, "tasks": ["30.5", "31.4"] },
    { "id": 45, "tasks": ["32.3"] },
    { "id": 46, "tasks": ["33.1"] },
    { "id": 47, "tasks": ["33.2", "33.3"] },
    { "id": 48, "tasks": ["33.4"] },
    { "id": 49, "tasks": ["34"] },
    { "id": 50, "tasks": ["35.1"] },
    { "id": 51, "tasks": ["36.1"] },
    { "id": 52, "tasks": ["36.2"] },
    { "id": 53, "tasks": ["36.3"] },
    { "id": 54, "tasks": ["37.1"] },
    { "id": 55, "tasks": ["38"] }
  ]
}
```
