# Design: Planchette Kit Kiro power

## 1. What the docs say (read on the day of the spec)
- Kiro's [Create powers](https://kiro.dev/docs/powers/create/) and
  [Install powers](https://kiro.dev/docs/powers/installation/): Agent Plugins format;
  `plugin.json` required; optional `mcp.json` and `skills/<name>/SKILL.md` (plus `scripts/`
  and `references/`); Kiro namespaces server names (`dwell-sim` becomes
  `power-planchette-dwell-sim`); with this format the MCP servers are managed by Kiro and are
  not added to `~/.kiro/settings/mcp.json`. Install paths: folder, or a repository URL that may
  point to a subdirectory, on `main` when no branch is named.
- The schemas the docs reference: `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`
  and `.../mcp.schema.json`. Fetched and read. `plugin.json`: `$schema` and `name` required;
  `name` matches `^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$`, at most 64 characters;
  `author` allows only `name`, `email`, `url`; no other top-level fields. `mcp.json`: `$schema`
  and `mcpServers`; stdio needs `type` and `command`; `args`, `env`, `cwd` optional; `env` may
  not name `PLUGIN_ROOT` or `PLUGIN_DATA`; `cwd` must start with `./` or `${PLUGIN_ROOT}`.
- Licence of the schema files (checked): the specification repository
  (`github.com/agentplugins/agent-plugins-spec`, `LICENSE.md`) licenses schemas, source code
  and scripts under Apache-2.0 and the specification text under CC-BY-4.0. The schemas carry
  no different notice. Copying them is allowed with attribution, so the fixtures folder also
  holds the Apache-2.0 text and a notice, and `THIRD_PARTY.md` records them as test
  fixtures (not bundled, not shipped in the power).
- Both schemas are copied into `tools/dwell-sim-mcp/test/fixtures/agent-plugins/` with their
  source URL and fetch date, so tests never use the network (the simulator's tests run with a
  no-network preload).

## 2. Layout and dependencies

```
power-planchette/
  plugin.json
  mcp.json
  dwell-sim-mcp.mjs            the Bundle (committed, generated)
  LICENSE                      MIT, copied, because a subfolder install lacks the root file
  skills/
    check-dwell-layout/        SKILL.md, references/{export-targets.js, board-gate-example.md, seance-gate-example.md, report-template.md}
    compare-dwell-settings/    SKILL.md, references/board-1400-to-2100.md
    build-on-the-skeleton/     SKILL.md, references/{accessibility-rules.md, api-cheatsheet.md}
tools/dwell-sim-mcp/scripts/bundle-power.ts     build script (compiled to dist-scripts like the others)
tools/dwell-sim-mcp/test/power-*.test.ts        the tests
tools/dwell-sim-mcp/test/fixtures/agent-plugins/{plugin,mcp}.schema.json
```

**Approval needed (tech.md: ask before adding a dependency).** Both are dev-only, exact
pins, MIT, to be recorded in `THIRD_PARTY.md`:
- `esbuild` pinned to **0.28.1** (published 11 Jun 2026; the newest, 0.28.2, is 8 Aug 2026;
  `npm view esbuild time` read on 28 Nov 2026; 0.28.1 is well over two weeks old and not the
  newest). It also installs a platform binary package (`@esbuild/<platform>`, MIT),
  recorded too.
- `ajv` 8.20.0, as a direct dev dependency of `tools/dwell-sim-mcp`, to validate against the
  2020-12 schemas. It is already in the lockfile as a transitive dependency of the MCP SDK, so
  this changes no installed version; it only stops tests importing a transitive package.

Alternative considered for the bundler: Vite 8's own bundler. It is not a direct dependency
and its library mode targets browsers; esbuild's `platform: node` fits a stdio server better.

## 3. The Bundle
`buildBundle()` in `bundle-power.ts` (exported, pure apart from reading the source tree)
calls esbuild's `build` with `write: false` and returns the text plus the list of inlined
packages (from the metafile). The script's `main` writes it to
`power-planchette/dwell-sim-mcp.mjs`. `npm run bundle:power` runs it.

| Option | Value | Why |
| --- | --- | --- |
| entry | `tools/dwell-sim-mcp/src/server.ts` | The real stdio entry, unchanged. |
| alias | `@planchette/skeleton` to `skeleton/src/index.ts` | The bundle does not depend on a built `dist/`, and the stale test needs no build order. The simulator still drives the skeleton's real engine (structure.md). |
| `bundle`, `platform: node`, `format: esm`, `target: node20` | | One file; top-level `await` in `server.ts` needs ESM. |
| `legalComments: eof` | | Keeps licence notices of inlined packages. |
| `sourcemap`, `minify` | off | Readable, diffable, deterministic. |
| `absWorkingDir` | repo root | Same output wherever it runs; no absolute paths in comments. |
| banner | `#!/usr/bin/env node` is not needed; the file is run as `node file` | |
| `metafile` | on | Package list for `THIRD_PARTY.md` and its test. |

The `server.ts` guard (`import("@planchette/skeleton")` in a try block) is inlined and
cannot fail in the Bundle. No change to `server.ts`.

Result of task 2.1 (28 Nov 2026): the bundle is 1.68 MB (about 0.3 MB gzipped; zod alone is
950 KB) and answers `tools/list` in about 90 ms from any directory (the workspace build: 130 ms).
No workaround was needed. Two things differ from the plan above: (1) `@mediapipe/tasks-vision`
is `external`: the skeleton's camera adapter loads it with a lazy `import()` that the simulator
never runs, and its npm package has no LICENSE file; a test checks that the reference stays lazy.
(2) esbuild keeps only `@license` comments, and none of the inlined packages has one, so the build
script appends each package's own LICENSE text at the end of the file (`legalComments` alone kept
nothing). (3) One `simulate` result is 65 to 340 KB, so `check-dwell-layout` ships
`scripts/sweep.mjs` (no dependencies), which starts the bundle itself and prints one table; a test
checks that it reproduces the numbers in `docs/board-gate.md`.

Risk checked first (task 2): esbuild must inline the MCP SDK and zod 4 without the
SDK's optional HTTP code (express, hono). The stdio entry imports only `server/mcp`,
`server/stdio` and zod, so I expect a small file. If the file is large or bundling needs a
workaround, I stop and report before going on.

## 4. `mcp.json` and the path question
Primary entry (the form the specification defines, §7.2.1 and §9.2). **Verified in Kiro on 28 Nov 2026:**
the power was imported from the folder, the Powers panel shows `power-planchette-dwell-sim` as Connected
with 3 tools, so Kiro expands `${PLUGIN_ROOT}` in `args`:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "dwell-sim": {
      "type": "stdio",
      "command": "node",
      "args": ["${PLUGIN_ROOT}/dwell-sim-mcp.mjs"]
    }
  }
}
```

What is known and not known:
- The **specification** says `${PLUGIN_ROOT}` expands in `args`, that the default `cwd` is the
  plugin root, and that `PLUGIN_ROOT` is set in the process environment. It also says a
  `command` that is a bundled executable must be `./`-relative; `node` is a bare name found on
  PATH, so that rule does not apply.
- The **Kiro docs** say none of this: their example uses only `npx` and environment-variable
  placeholders. The spec form was therefore unconfirmed when this section was written. It has
  since been confirmed in Kiro (see above). The docs still do not describe it.
  The sim's README records the same gap for workspace configs: the working directory was found
  by testing.
- The Bundle uses no relative reads, so it starts from any working directory, and the tests
  spawn it under both resolutions.

The tests cover two resolutions:
1. **Spec form:** `${PLUGIN_ROOT}` replaced by the power folder's absolute path, cwd anywhere.
2. **Relative form:** `node ./dwell-sim-mcp.mjs` with cwd set to the power folder (a client that
   starts servers in the plugin root and passes a relative path).

Fallback entry, documented in the README and tested but not shipped in `mcp.json`. It stays a
fallback: the spec form works in Kiro, so use this only if a future Kiro version stops expanding
`${PLUGIN_ROOT}` in `args`:

```json
"args": ["./dwell-sim-mcp.mjs"], "cwd": "${PLUGIN_ROOT}"
```

(`cwd` is the one field the schema restricts to `./` or `${PLUGIN_ROOT}`, so this is valid.)
If Kiro expands neither placeholder, the last resort is a one-line launcher that resolves the
file from the `PLUGIN_ROOT` environment variable or the working directory. I will not ship it
unless the panel check shows it is needed.

**What to check in the panel after install** (to be repeated in my final report):
1. Powers panel, `planchette`, MCP section: the server `power-planchette-dwell-sim` shows
   connected, not "Connection closed" or "Cannot find module '${PLUGIN_ROOT}/…'".
2. It lists exactly `list_users`, `simulate`, `compare`.
3. If the error text contains the literal `${PLUGIN_ROOT}`, Kiro does not expand it: use the
   fallback. If it says it cannot find `./dwell-sim-mcp.mjs`, the working directory is not the
   plugin root: tell me, because then neither entry works and the launcher is needed.

## 5. The skills
Each `SKILL.md` has frontmatter `name` and `description` only (the Agent Skills fields Kiro's
doc shows), numbered steps, and links to its `references/`. The description names the trigger
in a developer's words, so the skill activates on "check my layout for accidental selections".

**check-dwell-layout.** Steps: (1) confirm the app marks targets with
`data-planchette-target` and has a rest area; (2) run `references/export-targets.js` in the
running page at 1366×768 and 1920×1080 (browser MCP or devtools) to get `{ screen, targets }`;
(3) `list_users`; (4) `simulate` per preset and seed 1 to 10, `{ eachTarget: 2 }`, 30 fps,
10 trials, the app's dwell time in `profile.dwellTime`; (5) gate per layout; (6) on failure
raise the dwell time through the tested values (default list 1800, 1900, 2000, 2100, 2200,
2400, 2600) until the worst seed passes on every layout; (7) fill `references/report-template.md`.
The two gate documents are copied as worked examples (tables verbatim; a test checks this).
Simulated users are models from published group averages, not people.

**compare-dwell-settings.** Steps: same layout, same task, same users, same seed, two
`profile.dwellTime` values through `compare`; report per preset the accidents saved per 100
intended and the time cost per selection, then one sentence on the trade. The example is the
Board's 1400 to 2100 ms result.

**build-on-the-skeleton.** Steps follow the real API read from `skeleton/src/index.ts` and
`skeleton/src/ui/index.ts`: `createPlanchette`; `data-planchette-target` and `data-role`;
`createTargetRegistry`; `mountInputControls`; `createSettingsGate`; `fitCellSize` and
`PAGE_FIT`; then run `check-dwell-layout`. `references/accessibility-rules.md` is the copy of
`.kiro/steering/accessibility.md`, plus the rules that only the app specs state (no scroll at
1366×768 and 1920×1080, from the Board and Séance requirements, and the not-a-medical-device
wording). While writing it I check each rule against its source and list the source beside it.

## 6. Tests (all in `tools/dwell-sim-mcp/test/`, run by `npm test`)
| File | Checks |
| --- | --- |
| `power-manifest.test.ts` | Req 1 and 7.1: both files validate (ajv 2020-12, strict), `$schema` versions equal, name, version, author without email, repository, homepage, licence, required keywords; `command` is one bare token. |
| `power-skills.test.ts` | Req 7.2: frontmatter per skill, folder name equals `name`, links to `references/` resolve; required words per skill (for example `check-dwell-layout` names `simulate`, seeds 1 to 10 and 10). |
| `power-bundle.test.ts` | Req 2.4, 2.6, 7.3, 7.4, 7.7: spawn the Bundle from a temporary directory; list tools; one `simulate` call equal to the workspace build's; both path resolutions. |
| `power-stale.test.ts` | Req 7.5: first the installed esbuild equals the pinned version (reads the pin from `tools/dwell-sim-mcp/package.json`), failing with a message that names both versions and says to run `npm install`; then `buildBundle()` equals the committed file, failing with a message naming the manual hook "Rebuild power bundle" and `npm run bundle:power`. |
| `power-licences.test.ts` | Req 2.7, 7.6: every inlined package is in `THIRD_PARTY.md` with an allowed licence; no `/Users/`, `/home/` or drive path in the Bundle or `mcp.json`. |
| `power-references.test.ts` | Req 4.5, 5.3: the copied tables are substrings of `docs/board-gate.md` and `docs/seance-gate.md`. |

The equal-results test needs the workspace build, which `npm test` makes first (`build:sim`).
Like `stdio-server.test.ts`, it skips with a stderr note if `dist/` is missing.

## 7. Keeping the Bundle current
- `package.json` (root): `"bundle:power": "npm run build:sim && npm run bundle:power --workspace=tools/dwell-sim-mcp"`;
  the workspace script runs the compiled script. `npm test` does not rebuild it. It checks it,
  so a stale Bundle fails the suite instead of being silently replaced.
- A new manual hook, `.kiro/hooks/rebuild-power-bundle.json`, named "Rebuild power bundle",
  trigger `Manual` (as `seed-sweep.json` does), runs `npm run bundle:power`. The existing sim-src hook and
  `on-src-save.sh` are not changed (user decision). The format follows the existing hook files.
- Consequence, stated honestly: nothing rebuilds the Bundle on save. A change in
  `tools/dwell-sim-mcp/src` or in `skeleton/src` makes `power-stale.test.ts` fail until the
  hook or the script is run.

## 8. Out of scope
Hooks and steering inside the power (Agent Plugins has no portable place for them); a
`POWER.md`; publishing to npm; changing the simulator or skeleton; the Powers registry listing.
