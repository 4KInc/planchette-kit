# Implementation Plan: Planchette Kit Kiro power

## Overview
Order: dependencies and the bundle first (the riskiest part), then the manifest and
config, then the skills, then the hook and README, then the full run and the push.
Tests sit next to the thing they check. Each task names the requirement it covers.
Nothing is written until the spec is approved.

## Tasks
- [x] 1. Approvals and fixtures (Req 9.1, 7.1)
  - [x] 1.1 Pin `esbuild` 0.28.1 and `ajv` 8.20.0 as dev dependencies of
    `tools/dwell-sim-mcp`; run `npm install`; confirm `ajv` stays at 8.20.0 in the lockfile.
  - [x] 1.2 Licence check done (Apache-2.0 for the schemas). Save the two schemas verbatim from
    the specification repository to `tools/dwell-sim-mcp/test/fixtures/agent-plugins/`, with the
    Apache-2.0 text and a `README.md` giving source URLs, licence and fetch date; record them in
    `THIRD_PARTY.md`.

- [x] 2. The Bundle (Req 2.4 to 2.8, 7.3 to 7.6)
  - [x] 2.1 Write `tools/dwell-sim-mcp/scripts/bundle-power.ts` with exported `buildBundle()` and
    a `main` that writes `power-planchette/dwell-sim-mcp.mjs`; add the `bundle:power` scripts
    (design §7). Run it. Check the file size and that it starts with `node` from `/tmp`.
    **Stop and report if the bundle is unexpectedly large or needs a workaround.**
  - [x] 2.2 Write `power-bundle.test.ts` (tools list, equal `simulate` result, both path
    resolutions, no stdout noise).
  - [x] 2.3 Write `power-stale.test.ts` (esbuild pin check first, then the rebuild comparison;
    messages name the hook "Rebuild power bundle" and `npm run bundle:power`); prove both
    checks can fail (a changed source line; a wrong pin value in a scratch run), then restore.
  - [x] 2.4 Add the bundled packages and `esbuild` and `ajv` to `THIRD_PARTY.md`; write
    `power-licences.test.ts`.

- [x] 3. Manifest and MCP config (Req 1, 2.1 to 2.3, 3, 7.1)
  - [x] 3.1 Write `power-planchette/plugin.json` and `LICENSE` (copy of the root file).
  - [x] 3.2 Write `power-planchette/mcp.json` (design §4, primary entry).
  - [x] 3.3 Write `power-manifest.test.ts`.

- [x] 4. Skills (Req 4, 5, 6, 7.2)
  - [x] 4.1 `check-dwell-layout`: `SKILL.md`, `references/export-targets.js` (tested in jsdom
    against a small fixture page: it returns the same ids and rects as the page), the two gate
    examples copied verbatim, `report-template.md`.
  - [x] 4.2 `compare-dwell-settings`: `SKILL.md`, `references/board-1400-to-2100.md`. Run the
    steps once on a real Board layout (`tools/dwell-sim-mcp/board-layout-core-1366x768.json`)
    through the Bundle, to confirm the described tool arguments are right.
  - [x] 4.3 `build-on-the-skeleton`: `SKILL.md`, `references/accessibility-rules.md` (each rule
    with its source), `references/api-cheatsheet.md` (checked against the exported names).
  - [x] 4.4 Write `power-skills.test.ts` and `power-references.test.ts`.
  - [x] 4.5 Check all skill text against product.md (no "new input layer", no eye tracking,
    simulator is a model, not a medical device).

- [x] 5. Hook and README (Req 7.8, 8)
  - [x] 5.1 Add the manual hook "Rebuild power bundle" (`.kiro/hooks/rebuild-power-bundle.json`)
    running `npm run bundle:power`. Do not touch the sim-src hook or `on-src-save.sh`.
  - [x] 5.2 Add the "Kiro power" section to `README.md` with both install paths, the Node 20
    requirement, the fallback entry, `npm run bundle:power` and the manual hook.

- [x] 6. Checkpoint: full run (Req 9)
  - [x] 6.1 Run `npm test`, `npm run build`, `npm run test:e2e`. Report any failure; do not
    change code outside this spec to make them pass.
  - [x] 6.2 Run `date`, add one dated line to `docs/kiro-journal.md`.

- [ ] 7. Commit and push
  - [ ] 7.1 `git log -1 --format='%an <%ae>'` for the previous commit's author and set the
    commit's author to the same through git's existing configuration (no email typed in any
    command or file). Check `git status` for files that are not mine and leave them.
  - [ ] 7.2 Commit and `git push origin main` (no force). If the push is rejected, stop and
    report.

- [ ] 8. Hand-off: stop and tell the user (Req 3.4)
  - The exact clicks to import from the folder (Powers panel, Add Custom Power, Import power
    from a folder, select `power-planchette`, Install).
  - What to type to check activation, for example "My dwell targets keep selecting by accident,
    can you check my layout for accidental selections?", and where `planchette` and the three
    tools `list_users`, `simulate`, `compare` should appear.
  - The panel checks and the fallback entry from design §4.
