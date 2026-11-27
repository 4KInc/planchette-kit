# Implementation Plan: Séance
## Overview
Tasks build the pure game logic first (messages, Round, Support, Summary, Carry, storage,
layout, sound plan), each with its unit and property tests, then the DOM layer and the input
controls, then the theme, then the end-to-end and axe suite, then the dwell-simulator gate. Unit
tests are `apps/seance/test/<thing>.test.ts`, property tests `<thing>.props.test.ts`. Each of the
seventeen properties in design.md is its own required sub-task, placed with the component it
checks.
**Budget: about two days (15.25 working hours).** The first plan was a day and a half (12.25 h). The
user then made the shared input controls (Task 11, 3 h) and the App B replacement (Task 14, 0.5 h)
required, and Séance's own controls task shrank by 0.5 h because it uses the shared ones. Estimates are
on each task. Anything beyond the required tasks is under "Optional" at the end, marked `*`. Checkpoint
run time (the sweep, `npm test`, e2e) is not counted; allow about 10 minutes each.
**Checkpoint rules** (the Board's, applied at every checkpoint task below). In this order:
1. Run `date` and use its output for the journal line. Do not guess the date.
2. Run the seed sweep: `bash tools/dwell-sim-mcp/scripts/seed-sweep.sh` (the "Seed sweep" hook).
   Report the summary table and any failing file, test and assertion. Do not edit code or tests to
   make it pass without saying so.
3. Run `npm test` (typecheck, build, every workspace's tests), then `npm run build`, then
   `npm run test:e2e`. All must exit 0. The e2e run never starts a camera or makes a sound.
4. Append one dated line to `docs/kiro-journal.md`: what Kiro did, anything that went wrong or
   surprised us, what changed, and the commit or counterexample it links to. A counterexample found
   by a property test is also kept as a fixed regression test and logged (tech.md).
5. Check the author, without naming an address anywhere: before committing, `git config user.email`
   must equal `git log -1 --format=%ae` (the previous commit's author email); after committing,
   `git log -1 --format=%ae` (the new commit) must equal it too. Never run `git config` to set or
   change it. If they differ, stop and report.
6. Commit with a message starting `seance: checkpoint N, …`. Stage files by name. Do not stage
   `.kiro/specs/board/planchette-kit.code-workspace` (untracked, not part of this work) unless told.
If a checkpoint step fails, stop and report. Do not continue to the next task.
Convert the feature design into a series of prompts for a code-generation LLM that will implement
each step with incremental progress. Each prompt builds on the previous ones and ends with wiring.
No orphaned code. Focus only on tasks that involve writing, modifying or testing code.
## Tasks
- [x] 1. Wire apps/seance into the workspace (0.75 h)
  - [x] 1.1 Package, config, page stub, test projects.
    - Create `apps/seance/package.json`: `"private": true`, `"type": "module"`, name
      `@planchette/seance`, dependency `@planchette/skeleton` `*`, devDependencies the exact versions
      `apps/board/package.json` uses (`vitest` 5.1.1, `fast-check` 4.10.3, `jsdom` 29.1.1,
      `typescript` 7.0.2, `@types/node` 24.19.2), and `"test": "vitest run --passWithNoTests"`. No new
      dependency, so `THIRD_PARTY.md` does not change.
    - Create `apps/seance/tsconfig.json` and `apps/seance/vitest.config.ts` as the Board's, with the
      two skeleton aliases (the `/ui` alias first).
    - Root `package.json`: add `apps/seance` to `workspaces`, append
      `&& tsc --noEmit -p apps/seance/tsconfig.json` to `typecheck`, add `--workspace=apps/seance` to
      `test`. Run `npm install` so the lockfile picks up the workspace.
    - `vite.config.ts`: add `seance: resolve(import.meta.dirname, "seance/index.html")` to the build
      inputs. Do not touch `game`.
    - Create `seance/index.html` (title "Séance", the Board's Content-Security-Policy meta tag, one
      heading, `<script type="module" src="../apps/seance/src/main.ts">`) and a `main.ts` that only
      sets `window.planchetteSeance = { planchette }` from `createPlanchette`, so the page loads. No
      camera, no game yet.
    - `playwright.config.ts`: add projects `seance` (dev server, `testDir: 'apps/seance/test'`,
      `testMatch: '**/*.e2e.ts'`) and `seance-built` (built output), as the Board's two.
    - Write `apps/seance/test/skeleton-imports.test.ts` (the Board's test, scanning
      `apps/seance/src`; also fails on any import from `apps/board`) and
      `apps/seance/test/playwright-config.test.ts` (the two projects exist with the right `testDir`
      and `baseURL`).
    - Confirm `npm run build` produces `dist/seance/index.html`, and that the skeleton's package-build
      test still passes with the new workspace.
    - _Requirements: 7.11, 13.2_
- [x] 2. Checkpoint 1: workspace wired (first checkpoint)
  - Follow the checkpoint rules. This checkpoint also commits the uncommitted Board tick: the
    `- [ ]`→`- [x]` change to task 38 in `.kiro/specs/board/tasks.md` and the matching entry in
    `.kiro/specs/board/tasks.meta.json` (the Kiro bookkeeping file that changed with it). Stage
    exactly these files by name: the two Board spec files, `.kiro/specs/seance/requirements.md`,
    `design.md`, `tasks.md`, and the Task 1 files. Check `git diff` for the two Board files first
    and confirm nothing but the tick and the metadata entry is in them.
  - Journal line: workspace wired, Board tick committed, spec added, any surprise.
- [x] 3. Messages (0.5 h)
  - [x] 3.1 The bundled list and the chooser.
    - Create `apps/seance/src/spirit-messages.ts`: the `Message` type, `WORDS` (the 32 words in
      design.md), `messageFor(text)` that builds a word Message with step ids `letter-<a-z>`, and
      `pickMessage(seed, roundNumber, previousId)` as specified (Round 1 is a 3-letter word; every 4th
      Round is YES, NO, GOODBYE in turn; the inline `mulberry32` PRNG; no clock, no `Math.random`).
    - Write `apps/seance/test/spirit-messages.test.ts`: examples for Rounds 1, 4, 8, 12, 16; the exact
      step ids for one word; the three single-step Messages.
    - _Requirements: 1.1, 1.9, 14.1, 14.5_
  - [x] 3.2 Property 10: the list is valid.
    - Write `apps/seance/test/spirit-messages.props.test.ts` (Property 10): length 3 to 6, A to Z,
      unique, no adjacent equal letters, every letter A to Z appears, `steps` matches `text`, every step
      id is a Board target id. A unit test reads `apps/board/data/offensive-words.json` as data and
      checks no word is in it. Tag `Feature: seance, Property 10`.
    - _Requirements: 14.2, 14.3, 14.4_
  - [x] 3.3 Property 9: message choice.
    - In the same file (Property 9): deterministic for equal arguments; the result is in the list (or the
      fixed YES/NO/GOODBYE on every 4th Round); never equals `previousId` on word Rounds; Round 1 is
      3 letters.
    - _Requirements: 1.9, 14.5_
- [x] 4. Round state machine (1.5 h)
  - [x] 4.1 `round.ts`.
    - Create `apps/seance/src/round.ts`: `createRound`, `stepRound(state, input, now)`, `cloneRound`,
      the types in design.md, and the rules in their stated order (absorbing end, `stop` always
      accepted, stale timestamps ignored, Hit, Miss, Undo).
    - Write `apps/seance/test/round.test.ts`: a full Round; a Miss keeps the Step and the counts add
      up; Undo steps back and adds Taken back; Undo at 0 does nothing; `stop` ends a Round; inputs after
      the end return `[]`; a stale timestamp is ignored; `stop` with an old timestamp still ends it;
      `stepMs` values for a known timeline; one-step Messages (YES, GOODBYE).
    - _Requirements: 1.2 to 1.8, 2.1 to 2.6_
  - [x] 4.2 Properties 1, 2, 3.
    - Write `apps/seance/test/round.props.test.ts`. Property 1 (a Round always ends; absorbing).
      Property 2 (no double counting; replay adds nothing; control inputs change no count).
      Property 3 (progress is a prefix; `index <= hits`). Generators: Messages from the list, inputs
      from all 29 Board targets weighted toward the current Step, with increasing and with arbitrary
      timestamps.
    - _Requirements: 1.7, 2.1, 2.2, 2.6_
  - [x] 4.3 Properties 7 and 8.
    - In the same file. Property 7 (Undo restores the index, never changes `misses`, no-op at 0).
      Property 8 (times are `-1` or non-negative; shifting every timestamp by a constant gives the same
      counts and `stepMs`; interleaving extra stale inputs changes nothing).
    - _Requirements: 2.4, 2.5_
- [x] 5. Support (adaptation) state machine (1.0 h)
  - [x] 5.1 `support.ts`.
    - Create `apps/seance/src/support.ts`: `SEANCE_CONFIG`, `createSupport`, `stepSupport`,
      `cloneSupport` and the types, per design.md. The Suggestion arithmetic is the one formula in the
      design.
    - Write `apps/seance/test/support.test.ts`: two Misses give level 1; four give level 2 and one
      `suggest`; at `dwellMs` 3000 no Suggestion; the Suggestion appears once per Round and again after
      `round-start`; three Hits drop one level; a Hit with a lower streak does not; `accept` emits
      `apply-dwell` once; `dismiss` emits `suggestion-closed`; the level carries across `round-start`.
    - _Requirements: 3.1, 3.4 to 3.8_
  - [x] 5.2 Properties 4, 5, 6.
    - Write `apps/seance/test/support.props.test.ts`. Property 4 (a Miss never lowers the level).
      Property 5 (range 0 to 2; falls only on a Hit that completes `calmAfterHits`, by exactly 1).
      Property 6 (every `suggest.ms` is above `dwellMs`, at most 3000, a multiple of 50, at most once
      per Round; no `apply-dwell` without an `accept` that had an open Suggestion).
    - _Requirements: 3.5, 3.6, 3.7, 3.8_
- [x] 6. Checkpoint 2: game core complete
  - Follow the checkpoint rules. Confirm Properties 1 to 10 pass in the `apps/seance` suite.
  - Journal line.
- [ ] 7. Summary, Carry to the Board, storage (1.25 h)
  - [ ] 7.1 `summary.ts`.
    - Create `apps/seance/src/summary.ts`: `summarise` and `canOfferCarry`.
    - Write `apps/seance/test/summary.test.ts`: figures for a completed and a stopped Round (seconds to one
      decimal); `canOfferCarry` is true only when all four conditions hold, and each condition alone
      makes it false.
    - _Requirements: 4.1, 4.3, 4.6, 5.1_
  - [ ] 7.2 `board-link.ts` and its tests.
    - Create `apps/seance/src/board-link.ts`: `BOARD_KEY`, `readBoard`, `carryDwellToBoard`, `undoCarry`
      per design.md, all storage access in try/catch.
    - Write `apps/seance/test/board-link.test.ts`: the three read states; Carry on a valid record keeps
      every other field; Carry on a missing key writes a full record; Carry on garbage writes nothing;
      rounding and clamping; a storage that throws; Undo restores the exact previous string, or removes
      the key; Undo after a later change returns `changed-since` and writes nothing.
    - Write `apps/seance/test/board-link.contract.test.ts`: imports `readSettings` from
      `../../board/src/board-storage.js` (the one test that does), writes with `carryDwellToBoard` into an
      in-memory storage, and asserts `usedDefault: false` and the carried dwell time for the `none` and
      `ok` paths. Add a comment saying why this one test crosses apps.
    - _Requirements: 5.2 to 5.10_
  - [ ] 7.3 Property 11: Carry.
    - Write `apps/seance/test/board-link.props.test.ts` (Property 11) with a spy storage: nothing is
      written until `carryDwellToBoard` is called; for any valid generated Board record only
      `profile.dwellTime` differs after a Carry; the written dwell is 400 to 3000 and a multiple of 50;
      any unreadable value is left unchanged; Undo restores exactly.
    - _Requirements: 5.3, 5.4, 5.6, 5.7, 5.8_
  - [ ] 7.4 `seance-storage.ts` and Property 12.
    - Create `apps/seance/src/seance-storage.ts` (`KEY_SEANCE`, `readSeanceProfile`, `writeSeanceProfile`,
      `resolveInitialProfile`).
    - Write `apps/seance/test/seance-storage.test.ts` (round trip; missing key gives `{ dwellTime: 2100 }`
      from `resolveInitialProfile`; a saved dwell of 1000 stays 1000; write failure swallowed) and
      `seance-storage.props.test.ts` (Property 12: any stored string reads without throwing).
    - _Requirements: 8.3, 8.4, 8.5, 8.7_
- [ ] 8. Layout, arrival guard, sound plan (1.0 h)
  - [ ] 8.1 `seance-layout.ts` and Property 17.
    - Create `apps/seance/src/seance-layout.ts`: `BOARD_CELLS` (the table in requirements.md),
      `boardExtent`, `insideRect`, `guardedTargets`.
    - Write `apps/seance/test/seance-layout.test.ts`: 29 targets and 4 decorative cells; no two cells
      overlap; spans as specified; `boardExtent(96, 16, 848)` gives a cell width of 107.4 and a height of
      656; at 1366 the page arithmetic in design.md holds (848 + 478 + padding = 1366; 80 + 16 + 656 + 16
      = 768).
    - Write `apps/seance/test/seance-layout.props.test.ts` (Property 17): for any rects and pointer,
      `held` is exactly the targets containing the pointer; `null` holds none; a pointer outside every
      rect holds none.
    - _Requirements: 4.7, 6.1, 6.3, 6.5_
  - [ ] 8.2 `sound-plan.ts`, `sound.ts` and Property 15.
    - Create `apps/seance/src/sound-plan.ts` (`SOUND_LIMITS`, `planSound`) and `sound.ts`
      (`createSound(win)`: no `AudioContext` until `setOn(true)`; gain ramps of at least 20 ms;
      `setOn(false)` silences within 20 ms; a missing or throwing constructor leaves sound off).
    - Write `apps/seance/test/sound-plan.test.ts` (examples) and `sound.test.ts` (a fake `AudioContext`:
      none created at load; created once on `setOn(true)`; `setOn(false)` ramps to 0; constructor that
      throws leaves the wrapper off, no throw) and `sound-plan.props.test.ts` (Property 15).
    - _Requirements: 12.1 to 12.5_
  - [ ] 8.3 Property 14: no network.
    - Write `apps/seance/test/no-network.props.test.ts` (Property 14): spy on `fetch`, `XMLHttpRequest`,
      `WebSocket` and `sendBeacon`; run generated Rounds through `round.ts`, `support.ts`, `summary.ts`,
      `board-link.ts`, `seance-storage.ts` and `sound-plan.ts`; no call.
    - _Requirements: 13.1_
- [ ] 9. Checkpoint 3: pure layer complete
  - Follow the checkpoint rules. Confirm Properties 1 to 12, 14, 15 and 17 pass.
  - Journal line.
- [ ] 10. Page and Round loop (2.0 h)
  - [ ] 10.1 Strings and static markup.
    - Create `apps/seance/src/messages.ts` (every user-facing string; the notice; the Summary labels;
      no judging words). Replace the stub `seance/index.html` with the real markup: spelled line, board
      container, Summary container, side column (suggestion row, action row, camera row, Controls row,
      Status panel, notice), the Settings dialog shell, a polite live region. Real buttons and
      `data-planchette-target` attributes as in `board/index.html`.
    - Write `apps/seance/test/messages.test.ts`: no judging word (wrong, fail, bad, lose, lost, mistake,
      error, try harder) and none of the language steering's banned stems appear in any string.
    - _Requirements: 3.10, 10.5, 11.3_
  - [ ] 10.2 `seance-dom.ts` and `main.ts`.
    - Create `apps/seance/src/seance-dom.ts`: draw the board from `BOARD_CELLS`; register targets with the
      ids and roles in design.md (`autoRepeat: false`); the Round loop (select → `stepRound` →
      `stepSupport` → draw, live region, sound); `data-next`, `data-support`, the callout; the Summary
      (figures, Carry and its Undo, "Another round"); the view change with `guardedTargets` and
      `pointer-move`; `cancel` closes a Suggestion; `mode-change` sets `modeChangedDuringRound`; the
      settings gate; re-registration on resize with `updateTarget`.
    - Create `apps/seance/src/settings-gate.ts` (the Board's) and complete `main.ts`: the page seed from
      `crypto.getRandomValues`, the initial Profile through `resolveInitialProfile`, `setProfile`,
      saving the Profile on change, `createDwellRing` (outline shape) and `createScanHighlight`, and
      `window.planchetteSeance = { planchette }`. The camera is not started here (Task 12).
    - Write jsdom tests with a fake host (`apps/seance/test/seance-dom.test.ts`): a Round played by
      dispatching `select` events reaches the Summary; a Miss changes the count and no text; level and
      Suggestion appear after the configured Misses; "Hold longer" calls `setProfile` once and "Not now"
      never does; Carry writes the Board key only when `carry-dwell` is selected; Undo in the Summary
      restores it; held targets are not registered until the pointer leaves; targets are unregistered
      when the Round ends.
    - _Requirements: 1.2 to 1.11, 2.3, 3.2 to 3.10, 4.1 to 4.8, 5.2 to 5.8, 6.2, 12.2_
  - [ ] 10.3 Properties 13 and 16.
    - Write `apps/seance/test/seance-dom.props.test.ts` with a fake host that records
      `registerTarget`/`updateTarget`/`unregisterTarget`. Property 16: across generated sequences of
      Rounds, Support levels, mode changes and Sound toggles, each Board target is registered at the
      same rectangle every time, every rectangle is at least the target size, gaps at least the spacing.
      Property 13: for each camera failure cause and each of scan and mouse mode, delivering `select`
      events for the correct targets completes a Round without error.
    - _Requirements: 6.2, 6.3, 7.7_
- [ ] 11. Move the input controls into the skeleton (3.0 h)
  - [ ] 11.1 Add the shared exports to `skeleton/src/ui`.
    - Create `skeleton/src/ui/input-controls.ts` (`mountInputControls`, `ControlsHost`,
      `InputControlsOptions`, `InputControlsText`, `InputControls`) from `apps/board/src/board-controls.ts`:
      same logic, strings taken from the `text` option, the Board-specific error text generalised.
      Create `skeleton/src/ui/settings-gate.ts` (`createSettingsGate`, `SettingsGate`) and
      `skeleton/src/ui/dom-targets.ts` (`elementRect`, `roleOptionsOf`, `createTargetRegistry`).
      Export them with their types from `skeleton/src/ui/index.ts`. Nothing runs on import.
    - Update `skeleton/test/package-build.test.ts` `EXPECTED_UI_EXPORTS`, and any `api` test that lists the
      `./ui` names. Write skeleton tests: `input-controls.test.ts` (the Board's controls tests that cover
      behaviour, re-pointed at `mountInputControls` with a test `text`: first-run hint, camera toggle,
      failures, Calibrate, clicks per mode, destroy), `settings-gate.test.ts`, `dom-targets.test.ts`
      (rect, roles, registry register/unregister/update).
    - _Requirements: 17.1, 17.2, 17.4_
  - [ ] 11.2 Switch the Board to them, with no behaviour change.
    - Make `apps/board/src/board-controls.ts` a wrapper: `mountBoardControls` calls `mountInputControls`
      with `messages.controls`, and the same names (`mountBoardControls`, `BoardControls`, `ControlsHost`,
      `BoardControlsOptions`) are exported. `apps/board/src/settings-gate.ts` re-exports. In
      `board-dom.ts`, replace `rectOf` and the role lookup with `elementRect` and `roleOptionsOf`.
    - Do not edit any Board test, e2e or viewport test. Run the whole `apps/board` unit suite and the
      `board` and `board-built` Playwright projects; all must pass as they are. If one needs an edit, stop
      and report.
    - Record the one-sentence amendment to the input-core design's "UI helpers" paragraph in the
      checkpoint report, and make it in `.kiro/specs/input-core/design.md` only if it is a pure addition
      of the new names (no change of meaning).
    - _Requirements: 17.3, 17.5_
- [ ] 12. Controls row, Settings, first-run hint (0.75 h)
  - [ ] 12.1 Mount the shared controls and the camera rule.
    - In `main.ts`, call `mountInputControls` (from `@planchette/skeleton/ui`) with Séance's `text` from
      `messages.ts`, `createSettingsGate` for the dialog, and `createTargetRegistry` /`elementRect` /
      `roleOptionsOf` in `seance-dom.ts` in place of any local copy. `main.ts` calls `startCamera()` once
      on load only when the saved Profile's `startCameraOnLoad` is on; nothing else starts it.
    - Write `apps/seance/test/seance-controls.test.ts` (jsdom, fake host with a `startCamera` spy) for
      Séance's wiring: hint shows on a fresh Profile; hides after a select; never shows with a saved
      Profile; `startCamera` is not called by load, mode change, Round start or the hint; the toggle reads
      "Start camera" again after each of the three failure causes; the Séance page has every element id
      the shared controls expect.
    - _Requirements: 7.1 to 7.10, 17.2_
  - [ ] 12.2 Settings dialog.
    - Create `apps/seance/src/seance-settings-dom.ts`: Dwell time (number input 400 to 3000 step 50,
      clamped), "Start camera when the page opens", Calibrate (says the camera must be on when it is
      off; closes the dialog and calls `startCalibration` when on), About (what Séance is, the notice,
      the version), Close, Escape, focus return, Tab wrap. Save the Profile on change.
    - Write `apps/seance/test/seance-settings-dom.test.ts`: fields clamp; Calibrate with the camera off
      keeps the dialog open and says why; selections are ignored while open and for a `select` stamped at
      or before the last close; Escape closes and returns focus to the Settings button.
    - _Requirements: 8.1 to 8.6_
- [ ] 13. Theme (0.75 h)
  - [ ] 13.1 `seance.css`, art, reduced motion.
    - Create `apps/seance/seance.css`: the tokens in design.md as custom properties; the two-column
      page and 7-column grid with the arithmetic in design.md; cell and label styles (letters at least
      40 px, other text 24 px or more); the marker (`[data-next]`, 4 px outline, inline SVG glyph), the
      level 1 and level 2 styles (`--dim-text`, no `opacity`); the Summary; the moon, fog and board
      border as CSS gradients; the slow glow; `@media (prefers-reduced-motion: reduce)` removes every
      animation and transition. No image file, no font file, no inline style attribute.
    - Write `apps/seance/test/seance-colours.test.ts`: parse the custom properties, compute contrast, and
      assert every text and background pair in Requirement 10 AC 3 (bone, muted, dim-text, lantern on
      surface and surface-2; edge on ground and surface at 3:1), including level 2. Assert that the stylesheet
      has no `opacity` rule on letters, that every `animation` and `transition` declaration sits inside
      `@media (prefers-reduced-motion: no-preference)`, and that no `url(` points to a non-local file.
    - _Requirements: 3.2, 3.3, 6.4, 10.3, 10.4, 10.6, 10.7, 11.1, 11.2, 11.5, 11.6_
- [ ] 14. Séance is App B: remove the game stub, update steering and README (0.5 h)
  - [ ] 14.1 Remove and update.
    - Delete `apps/game/`, `game/index.html`, and the `game` entry of `vite.config.ts`. Search the repo
      (`rg -n "apps/game|/game/|game/index"`, excluding `.git`, `node_modules`, `dist` and the journal's
      history) and fix every remaining reference (README, docs, tests such as a build-output or CSP test
      that lists the pages).
    - Edit `product.md`, `structure.md`, `tech.md` and `README.md`: App B is Séance, a spooky head-pointer
      practice game, `/seance/`, sources in `apps/seance`; the folder tree, the page list, the theme rule
      and the "deferred to later specs" list change accordingly (the App B game design is no longer
      deferred). In `accessibility.md`, reword "This applies to the haunted game too" so it names no app
      ("This applies to every app and theme"). Keep each file's other content as it is.
    - Add a test or extend `build-output.test.ts` so the built `dist/` has `seance/index.html` and no
      `game/` folder.
    - _Requirements: 18.1 to 18.4_
- [ ] 15. Checkpoint 4: playable app
  - Follow the checkpoint rules. In addition, open the built page by hand in a browser (mouse mode, no
    camera) and play one Round: report in the journal line what looked wrong, if anything.
  - Journal line.
- [ ] 16. End-to-end and accessibility (1.25 h)
  - [ ] 16.1 Round in mouse and scan mode.
    - Write `apps/seance/test/seance-round.e2e.ts` and `seance-scan.e2e.ts` as designed ("Testing
      strategy"): mouse mode (full Round via `[data-next="true"]`; Stop; Undo; a Miss; Suggestion shown and
      "Not now" / "Hold longer"; Summary figures; Another round; Carry and its Undo with the Board key
      untouched before the press, in head + dwell with `feedSamples` and no camera); scan mode (Space as the
      switch, play a short Round to the Summary). Patterns copied from `apps/board/test/board.e2e.ts`.
    - _Requirements: 16.2, 16.5_
  - [ ] 16.2 Axe on every view, viewport, privacy.
    - Write `seance-a11y.e2e.ts` (axe-core, no violations: play at level 0; play at level 2 with the
      Suggestion open; Summary completed; Summary stopped; Settings dialog; a camera-failure message
      showing; reduced motion emulated and no running animation), `seance-viewport.e2e.ts` (1366×768 and
      1920×1080: no scroll, every target inside the viewport, in play, play with Suggestion, both
      Summaries; no label overflows its element) and `seance-privacy.e2e.ts` (no `getUserMedia`; no
      `AudioContext` until Sound is pressed; only same-origin requests; only the two allowed storage keys;
      the Board key unchanged until Carry).
    - Run all of `seance` and `seance-built`.
    - _Requirements: 6.4, 7.9, 9.1 to 9.5, 10.5, 10.9, 12.1, 12.6, 13.1 to 13.3, 16.3, 16.4_
- [ ] 17. Layout export and the six-preset gate (0.75 h)
  - [ ] 17.1 Export the four layouts.
    - Write `tools/dwell-sim-mcp/scripts/export-seance-layout.ts` (pattern: `export-board-layout.ts`): serve
      `dist/seance/index.html` with `vite preview`, open it at 1920×1080 and 1366×768, read
      `window.planchetteSeance.planchette.getTargets()` for the play view, then play a 3-letter Round in
      head + dwell with `feedSamples` (no camera; timestamps from `performance.now()` plus a margin,
      increasing) and read the Summary view. Write `seance-layout-play-<size>.json` and
      `seance-layout-summary-<size>.json` next to the Board's. Add `demo:export:seance` to the package's
      scripts. If playing the Round through `feedSamples` does not work, stop and ask. Do not add a
      test-only switch to the app.
    - Write `tools/dwell-sim-mcp/test/export-seance-layout.test.ts` (the pure conversion, as the Board's).
    - _Requirements: 15.1_
  - [ ] 17.2 Run the six presets and apply the gate.
    - Write `tools/dwell-sim-mcp/scripts/run-seance-presets.ts` (imports `runDemoPresets` as
      `run-board-presets.ts` does; four layouts; `{ eachTarget: 2 }`; profile `{ dwellTime: 2100 }`) and
      `tools/dwell-sim-mcp/test/run-seance-presets.test.ts` (a stub handler is called 24 times with the
      documented task). Add `seance:run` to the package scripts. Run all six presets on all four layouts at
      seed 1, then `reads-while-pointing` on seeds 1 to 10 on each layout.
    - Append the entries to `docs/kiro-journal.md` and write `docs/seance-gate.md` (tables as
      `docs/board-gate.md`).
    - **Acceptance gate**: `reads-while-pointing` `accidentalPer100Intended` at or below 10 on every
      layout at 2100 ms, worst of seeds 1 to 10. **If it is missed: stop and report to the user** the
      preset, layout, seed, rate and causes, with the options in design.md. Do not loosen the gate, change
      the default dwell, or change the layout without the user's approval. Do not start Task 18 until the
      user replies.
    - _Requirements: 15.2 to 15.5_
- [ ] 18. Final checkpoint (0.25 h)
  - Follow the checkpoint rules. Confirm the Task 17.2 gate still passes (the metrics are deterministic
    for a fixed seed, so it needs a rerun only if source under `apps/seance/` or the layout changed since).
  - Add one line to `README.md` listing Séance at `/seance/` as the second app, and nothing else there.
    Do not change `product.md`, `structure.md`, `tech.md` or the `apps/game` stub: that is the open
    question in design.md (Notes, item 1) and waits for the user.
  - Journal line, including the final test counts.
## Optional (beyond the two days)
Marked `*`, outside the 15.25 h above. **Order, if time allows, after Task 18: O6, then O1, then O5.**
O2 and O7 are skipped unless a property test finds a counterexample (then pinning it, O2, is required
anyway, because tech.md says to keep it as a regression test).
- [ ]* O6. Moving planchette (1 h). A glyph that slides between targets as the spirit "spells", off under
  reduced motion, never covering a label or changing a target's position. No data in it (decoration only),
  hidden from assistive technology.
- [ ]* O1. Scale to the viewport at 1920×1080 (about 2 h). A `seance-scale.ts`: cells grow to fill the
  viewport height. Check first whether the Board's `renderedCellSize` logic can move to the skeleton as a
  small pure export now that the controls have moved (it is natural only if it can drop its Board-specific
  arguments: prediction-strip rows and the Message-bar heights); if not, write Séance's own and say so.
  Every figure in Requirements 6 and 9 must hold at the scaled size, the 1920 layouts are re-exported, and
  the Task 17.2 gate is rerun. Needs a property test for the rendered cell size.
- [ ]* O5. `compare` run (0.5 h). A `compare` of Séance's play layout at 1400 ms against 2100 ms, same seed
  and task, appended to the journal, to show the time cost as the Board's Task 37 did.
- [ ]* O2. Pin counterexamples (0.5 h). `apps/seance/test/layout-regressions.test.ts`, as the Board's 36.3;
  required if the gate run or a property finds an accidental selection or failure with an unexpected cause.
- [ ]* O7. Longer messages (1 h). Skipped. Words of 7 or more letters unlock after clean Rounds; needs the
  letter count in the requirements to change first.
## Notes
- Task 1 touches the root `package.json`, `vite.config.ts` and `playwright.config.ts`. The existing
  Board, skeleton and dwell-sim projects must still pass at Checkpoint 1.
- `apps/seance/src/main.ts` is extended in Tasks 10 and 12. No task leaves it in a state that does not
  compile or run.
- Task 11 changes the skeleton's public `./ui` API and the Board's wiring. Its proof of "no behaviour
  change" is that no Board test is edited. Task 14 changes steering files; its edits are limited to the App B
  statements and the one accessibility.md wording named there.
- The dwell simulator is used, not changed. If the gate asks for a change to the simulator, stop and report.
- No task adds a dependency. If one seems needed, ask first (tech.md).
- The user asked to stop and report at Checkpoint 4 (Task 15, playable app) for a browser check, and at any
  failure.
