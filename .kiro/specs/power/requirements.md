# Requirements Document
Planchette Kit Kiro power ("planchette")

## Introduction
The power lets a developer who is building a hands-free web app (head pointer, dwell,
switch scanning) install one package into Kiro and then do two things:

- (a) check their layout for accidental dwell selections, using the dwell simulator
  (`dwell-sim-mcp`) and the same gate this repository applies to its own apps;
- (b) build on the skeleton correctly, following the accessibility rules that this
  repository enforces with steering.

Steering files cannot ship in a power, so the rules the skills need are copied into the
power's `references/` folders.

The format is Agent Plugins, as the Kiro docs describe it (checked on the day this spec was
written): [Create powers](https://kiro.dev/docs/powers/create/) and
[Install powers](https://kiro.dev/docs/powers/installation/). That means `plugin.json`
(required), `mcp.json` (optional) and `skills/<name>/SKILL.md` (optional). It is not the
legacy `POWER.md` format. The normative text is the
[Agent Plugins specification](https://agent-plugins.org/specification) (version 1.0.0).

The power does not claim the input layer is new, makes no eye-tracking claim, and is not a
medical device (product.md).

## Glossary
- **Power**: the folder `power-planchette/` at the repository root.
- **Bundle**: the single file `power-planchette/dwell-sim-mcp.mjs`, the dwell simulator with
  its dependencies and the skeleton inlined. Committed, because `dist/` is gitignored.
- **Gate**: the rule from `docs/board-gate.md`: for the preset `reads-while-pointing`, at
  most 10 accidental selections per 100 intended selections, on every layout, for the worst of
  seeds 1 to 10.
- **Multi-seed rule**: the default dwell time is the smallest tested dwell time whose worst
  seed, over seeds 1 to 10, meets the gate on every layout.
- **Plugin root**: the folder holding `plugin.json`, as the specification defines it.
- **Schema**: the Agent Plugins 1.0.0 JSON Schemas `plugin.schema.json` and `mcp.schema.json`.

## Requirements

### Requirement 1: The manifest
**User Story:** As a developer, I want Kiro to recognise and activate the power from words I
actually use.

#### Acceptance Criteria
1. THE Power SHALL contain `plugin.json` at its root with `$schema`
   `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`, `name` `planchette`,
   `version` `0.1.0`, a one-sentence `description`, `author` `{ "name": "4KInc" }` with no
   `email`, `repository` and `homepage` both `https://github.com/4KInc/planchette-kit`, and
   `license` `MIT`.
2. THE `keywords` SHALL be terms a developer would type, including: `dwell`, `dwell time`,
   `head pointer`, `head tracking`, `switch scanning`, `single switch`, `hands-free`,
   `AAC`, `accidental selection`, `Midas touch`, `planchette`. The broad terms
   `accessibility` and `assistive technology` are NOT keywords: they would activate the power
   on any accessibility question.
3. THE `plugin.json` SHALL validate against the fetched Schema, with `additionalProperties`
   false honoured (no fields outside the Schema).
4. THE manifest SHALL NOT claim a medical purpose or eye tracking.

### Requirement 2: The simulator as an MCP server
**User Story:** As a developer, I want the three simulator tools to appear after install,
with nothing to build or configure.

#### Acceptance Criteria
1. THE Power SHALL contain `mcp.json` with `$schema`
   `https://agent-plugins.org/schemas/1.0.0/mcp.schema.json` and one stdio server,
   `dwell-sim`, that runs the Bundle with `node`.
2. THE `mcp.json` SHALL validate against the fetched Schema and follow the specification's
   rules the Schema cannot express: `command` is a single bare token; no placeholder in
   `command`; `${PLUGIN_ROOT}` only in `args`, `env` values or `cwd`.
3. THE `mcp.json` SHALL contain no absolute path, no username, no secret and no `env`
   value other than what is needed (none is needed).
4. THE Bundle SHALL be one self-contained ES module file. It SHALL start with `node
   dwell-sim-mcp.mjs` on Node 20 or later, with no `node_modules` and no network access, from
   any working directory.
5. THE Bundle SHALL be built from `tools/dwell-sim-mcp/src/server.ts` and the skeleton's
   source, by a script, and SHALL be committed.
6. THE Bundle SHALL expose exactly the tools `list_users`, `simulate` and `compare`, and its
   result for one `simulate` call SHALL equal the workspace build's result for the same call.
7. THE Bundle SHALL keep the licence notices of everything inlined (the bundler's legal
   comments), and every bundled package and its licence SHALL be recorded in
   `THIRD_PARTY.md`. Only MIT, Apache-2.0, BSD or ISC licences (tech.md).
8. THE Bundle SHALL write nothing but protocol messages to stdout (as the workspace build does).

### Requirement 3: The path question
**User Story:** As the author, I want the server to start whichever way Kiro resolves paths
in `mcp.json`, because the Kiro docs do not say.

#### Acceptance Criteria
1. THE `mcp.json` SHALL use the form the Agent Plugins specification defines (§7.2.1, §9.2):
   `${PLUGIN_ROOT}` in `args`.
2. THE Bundle SHALL not depend on the working directory, so that a client that starts the
   server in the plugin root, the workspace or elsewhere can all find it once the path
   argument is resolved.
3. WHERE the panel shows the server failing to start, THE design SHALL give one documented,
   tested fallback entry (design §4) and the exact check to run.
4. THE implementation report SHALL state what to check in the Powers panel (design §4).

### Requirement 4: Skill `check-dwell-layout`
**User Story:** As a developer, I want to know whether my layout makes accidental
selections for people with tremor, slow movement or a small head range.

#### Acceptance Criteria
1. THE skill SHALL have `SKILL.md` frontmatter with `name: check-dwell-layout` and a
   `description` saying when to use it (words a developer would use), and a step-by-step body.
2. THE steps SHALL cover: (1) export every target's rectangle and role from the running app
   at 1366×768 and at 1920×1080, with a snippet that reads `data-planchette-target` and
   `data-role` elements and needs no Planchette instance; (2) call `list_users`; (3) call
   `simulate` for every preset with seeds 1 to 10, task `{ eachTarget: 2 }`, 30 fps, 10
   trials, the app's own dwell time; (4) apply the Gate (worst ≤ 10 accidental per 100
   intended) per layout; (5) if the Gate fails, pick the dwell time by the Multi-seed rule,
   trying the next higher value until it passes, and say when none passes; (6) report one
   table.
3. THE report SHALL show per preset and layout: dwell time, worst, median and best
   accidental per 100 intended over the seeds, and the median time to select; and one
   verdict line (pass or fail) with the dwell time chosen.
4. THE skill SHALL say that simulated users are models from published group averages, not
   real people, and that the result compares layouts and settings, not a person.
5. THE skill SHALL reference worked examples: the Board gate and the Séance gate, as
   copies in `references/` and as links to `docs/board-gate.md` and `docs/seance-gate.md` in
   the repository. THE copied tables SHALL be verbatim from those documents.
6. THE skill SHALL state that the simulator needs a layout with a rest area, and that a
   passing result at a dwell time is for that layout and that task only.

### Requirement 5: Skill `compare-dwell-settings`
**User Story:** As a developer choosing between two dwell times, I want to see what I buy
and what it costs.

#### Acceptance Criteria
1. THE skill SHALL have `name: compare-dwell-settings` and a step-by-step body that calls
   `compare` for two dwell values on the same layout and users, with the same seed and task.
2. THE report SHALL show accidents saved per 100 intended and the time cost per selection
   (change in time to select, in ms and in percent), per preset, and a plain sentence on the
   trade.
3. THE skill SHALL use the Board's 1400 ms to 2100 ms result as its worked example, with the
   numbers copied verbatim from `docs/board-gate.md`.
4. THE skill SHALL say that a longer dwell is slower and that "prefer slower and correct over
   faster and wrong" is the project's rule, while the person can adjust it (product.md).

### Requirement 6: Skill `build-on-the-skeleton`
**User Story:** As a developer, I want to make a new app on the skeleton that follows the
rules without reading the whole repository.

#### Acceptance Criteria
1. THE skill SHALL have `name: build-on-the-skeleton` and steps that cover: adding the
   skeleton and its `createPlanchette` call; marking elements with
   `data-planchette-target="<id>"` and optional `data-role` (`default`, `cancel`, `undo`,
   `rest-area`); registering and updating targets (`createTargetRegistry`); mounting the
   input controls (`mountInputControls`); ignoring a `select` stamped before the settings
   dialog closed (`createSettingsGate`); and fitting the layout to the viewport
   (`fitCellSize`, `PAGE_FIT`).
2. THE skill SHALL use only the public API (`@planchette/skeleton` and
   `@planchette/skeleton/ui`) and SHALL say that the skeleton is a template until it is
   published to npm (docs/npm-package-plan.md).
3. THE skill's `references/` SHALL carry the accessibility rules as a copy (steering cannot
   ship in a power), and SHALL include at least: no camera until a press (or the person has
   turned on camera on load); text contrast 4.5:1 and UI parts 3:1; respect
   `prefers-reduced-motion`; no scroll at 1366×768 and 1920×1080; the not-a-medical-device
   wording; a rest area in every layout; cancel and undo in every input mode; no flashing
   above 3 per second; every timing from the profile.
4. THE skill SHALL end with a step that runs `check-dwell-layout` on the result.
5. THE skill SHALL not call the input layer new, and SHALL not claim eye tracking.

### Requirement 7: Tests
**User Story:** As the author, I want the power to break loudly when it goes out of date.

#### Acceptance Criteria
1. WHEN `npm test` runs, THE tests SHALL check that `plugin.json` validates against the
   fetched Schema and that `mcp.json` validates against the fetched MCP Schema, with both
   `$schema` versions equal (specification §10.1). The Schemas are committed test fixtures, so
   no test uses the network.
2. THE tests SHALL check that every `skills/*/SKILL.md` has frontmatter with `name` (equal to
   its folder name, lowercase, digits and hyphens, at most 64 characters) and a non-empty
   `description` (at most 1024 characters), and that every `references/` file a skill links
   to exists.
3. THE tests SHALL start the Bundle over stdio from a temporary working directory, list the
   tools and require exactly `list_users`, `simulate` and `compare`.
4. THE tests SHALL call `simulate` on the Bundle and on the workspace build with the same
   arguments and require equal results.
5. THE tests SHALL, in `power-stale.test.ts`, first check that the installed esbuild is the
   pinned version and FAIL with a clear message naming both versions if not (a different
   esbuild can produce different output, so the next check would mean nothing). THEN they
   SHALL rebuild the Bundle in memory and FAIL if it differs from the committed file, with a
   message naming both the manual hook "Rebuild power bundle" and the script
   `npm run bundle:power`.
6. THE tests SHALL check that every package inlined in the Bundle appears in
   `THIRD_PARTY.md` with an allowed licence, that the Bundle and `mcp.json` contain no
   absolute home path, and that copied tables in `references/` are verbatim from the
   documents they cite.
7. THE tests SHALL spawn the server exactly as `mcp.json` says, with `${PLUGIN_ROOT}`
   expanded, and also with the fallback entry (design §4).
8. THE existing sim-src hook SHALL NOT change. A new manual hook "Rebuild power bundle"
   (`.kiro/hooks/`) SHALL run `npm run bundle:power`.

### Requirement 8: README and install
**User Story:** As a developer, I want two clear ways to install it.

#### Acceptance Criteria
1. THE README SHALL have a "Kiro power" section with both install paths: Powers panel, Add
   Custom Power, Import power from a folder (select `power-planchette`); and Import power
   from a repository URL
   (`https://github.com/4KInc/planchette-kit/tree/main/power-planchette`).
2. THE section SHALL say that Node.js 20 or later must be on the PATH, what the three skills
   do, that the simulator models published group averages and not real people, and that it
   is not a medical device.
3. THE section SHALL say how to rebuild the Bundle (`npm run bundle:power`).

### Requirement 9: Constraints
1. THE work SHALL add no dependency other than those approved at spec review (design §2):
   `esbuild` (an exact version published at least two weeks before it is pinned, and not the
   newest if that is younger) and `ajv` 8.20.0, both dev-only, exact versions, MIT, in
   `THIRD_PARTY.md`.
1a. THE Agent Plugins schema files SHALL be committed as test fixtures only after their licence
   is checked and allows copying; the licence and source SHALL be recorded in
   `THIRD_PARTY.md`. IF the licence does not allow copying, the work stops and is reported.
2. THE power SHALL contain no secret, no absolute path and no email address.
3. THE power SHALL not change the skeleton, the simulator's behaviour or the Board and
   Séance apps.
4. THE docs/kiro-journal.md SHALL get one dated line for the task (run `date` first).
5. EVERY skill and the README section SHALL follow product.md: no claim that the input
   layer is new, no eye-tracking claim, and the simulator is described as a model.
