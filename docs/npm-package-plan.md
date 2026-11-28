# Plan: publish the skeleton as an npm package

Status: Tasks 1–9 done (updated 20 Nov 2026). Phase 0 (decision) and the build setup of Phase 1 are done; nothing is published and `skeleton/package.json` keeps `"private": true`. Not a spec: nothing here changes the input-core tasks.

## Goal
A web developer can add hands-free input to their app with:

```
npm install @planchette/input
```

and the 15-line example from Task 13, without cloning this repo or copying folders.
The repo keeps working as a template for people who want to change the engine.

## Why
- **Easier to start.** One install command instead of copying files and fixing paths.
- **Fixes reach users.** An accidental-selection bug says the wrong thing on someone's
  behalf. With a package, one fix reaches every app through `npm update`. Copied
  folders never get the fix.
- **Works for JavaScript and TypeScript.** Ship compiled JavaScript plus type
  definitions (`.d.ts`), so plain JS projects work and TS projects get types.

## Non-goals
- No separate packages per engine. One package, one entry point (`createPlanchette`).
- No CommonJS build. ES modules only; every browser bundler supports them.
- No framework wrappers (React, Vue) in the first release.
- No change to the principle that nothing leaves the device.

## When
Publishing waits until the package can do its main job.

| Release | After | What it contains |
|---|---|---|
| none | now (Tasks 1–9 done) | Keep building. Decision recorded (Phase 0), build set up (Phase 1). Nothing published. |
| `0.1.0` | Task 16, and not before the 4 Dec 2026 submission | Public API, camera adapter, failure handling, dwell ring and scan highlight helpers. |
| `0.x` | each later change | API may still change; note breaking changes in the changelog. |
| `1.0.0` | real-user testing | API frozen; breaking changes only in a new major version. |

`0.1.0` waits for Task 16, not Task 13: without the camera adapter (Task 14) there
is no head pointing, which is the main reason to install it.

## Phase 0: record the decision (now)
- [x] Add to `.kiro/steering/product.md` under "What ships in this repo": the skeleton
      is also published to npm later; until then it is a template.
- [x] Add to `.kiro/steering/tech.md`: `skeleton/src/index.ts` is the only public entry
      point; anything not exported there is private and may change.
- [x] Journal entry in `docs/kiro-journal.md`.

## Phase 1: package setup (alongside Task 11)
- [x] Add `skeleton/tsconfig.build.json` that compiles only `src/` to `skeleton/dist/`
      with `declaration: true` and `declarationMap: true`. The current `tsconfig.json`
      also includes `test`, `demo` and `examples` and keeps `rootDir: "."`, so it
      cannot be used for the published build as it is.
- [x] `skeleton/package.json`:
  - keep `private: true` and `version: "0.0.0"` until the first publish (remove
    `private` and set `0.1.0` then; add `license` matching the repo `LICENSE`)
  - `exports: { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }`
  - `files: ["dist", "assets", "README.md", "LICENSE"]`
  - `sideEffects: false`
  - scripts: `build` (tsc with the build config, then copy `../LICENSE`), `prepublishOnly`
    (test then build)
  - `@mediapipe/tasks-vision` as a `dependency`, pinned exactly: Task 14, not yet
- [ ] `skeleton/README.md` (before the first publish): install, the 15-line example, input modes, profile,
      self-hosting the model files, "not a medical device" notice.

## Phase 2: model files (with Task 14)
`tech.md` requires the MediaPipe WASM and model files to be served from the app's own
site, not a third-party CDN. A package cannot serve files, so:

- [ ] Ship only `face_landmarker.task` in `skeleton/assets/`. The WASM files come from
      `@mediapipe/tasks-vision`'s own `wasm/` folder, which the app copies from that
      dependency (see the review notes).
- [ ] Add an option `createPlanchette({ assetsUrl: '/planchette/' })` that tells the
      camera adapter where the app serves them. No default CDN URL.
- [ ] Document one copy step for common setups (Vite `public/`, plain static site).
- [ ] If `assetsUrl` is wrong, report `tracking-status: load-failed` (Req 8), with a
      message that names the missing file.
- [ ] Check the model file's licence and record it in `THIRD_PARTY.md` before shipping it.
- [ ] Check package size; the model files are the bulk of it.

## Phase 3: checks before the first publish (after Task 16)
- [ ] A test that installs the packed package (`npm pack`) into a fresh Vite app and
      a plain HTML page, runs the 15-line example, and gets a `select` event from
      synthetic samples. Proves the published package works, not just the repo.
- [ ] A test that the package exports only the public API (no internal paths).
- [ ] Apps in this repo (`apps/board`, `apps/seance`) and the dwell simulator keep
      importing the skeleton only through the public API (already a `structure.md` rule).
- [ ] `CHANGELOG.md` in `skeleton/`.

## Phase 4: publish
- [ ] Check that the npm name `@planchette/input` is free, or choose another; create the
      npm organisation.
- [ ] Publish from a GitHub Action on a version tag using npm trusted publishing (GitHub
      Actions OIDC, with provenance). No `NPM_TOKEN` secret exists. Run on demand
      (`tech.md`: CI that uses credits runs on demand).
- [ ] Turn on two-factor authentication for the npm account.
- [ ] Decide, before the first publish, whether to ship `src/` in the package (add `src` to
      `files`, so the declaration maps in `dist/*.d.ts.map` point at real files) or to turn
      `declarationMap` off in `tsconfig.build.json`. Today the maps point at `src/`, which
      is not in `files`. The build test checks that the maps are emitted, so changing it
      means updating that test too.
- [ ] Not before the 4 Dec 2026 submission.

## Open questions
1. **Name.** "skeleton" means template inside this repo but is unclear on npm.
   Candidate: `@planchette/input`. Alternatives: `@planchette/core`, `planchette-kit`.
   The workspace keeps the name `@planchette/skeleton` until the first publish; the apps
   import that name, so renaming is one change in `package.json` and the imports.
2. **Licence.** Confirm the repo licence suits a published library.
3. ~~UI helpers.~~ Decided: same package, under a `./ui` subpath export
   (`@planchette/input/ui`). Added to `exports` in Task 16.
4. **Who maintains it.** Publishing creates a duty to fix bugs and answer issues.
   Who owns that after the hackathon?

## Review notes (20 Nov 2026)
- **LICENSE.** `npm pack` does not include files from the parent folder, so the build
  copies `../LICENSE` into `skeleton/` (`scripts/copy-license.mjs`). The copy is
  gitignored, and `files` lists `LICENSE`.
- **Model and WASM.** Ship only `face_landmarker.task`. The WASM comes from
  `@mediapipe/tasks-vision`'s own `wasm/` folder, so there is one copy, at the version
  the code was tested with.
- **`sideEffects: false`.** True only if no file does anything when imported. The UI
  helpers must not inject CSS on import; styles are applied from code the app calls, or
  shipped as a separate file the app chooses to import. The build test checks that
  importing `dist/index.js` only defines `createPlanchette`.
- **Publishing.** Use npm trusted publishing (GitHub Actions OIDC, provenance). No
  `NPM_TOKEN` is stored anywhere.
- **Name and subpaths.** Candidate name `@planchette/input`. UI helpers go under the
  `./ui` subpath.
- **Timing.** Publishing waits until after the 4 Dec 2026 submission.
- **ES module imports.** The compiled files import each other with `.js` extensions, so
  they load in Node, in a browser import map and in any bundler, not only in bundlers.
- **In-repo use.** The apps import `@planchette/skeleton` only by that name. The root
  `vite.config.ts` maps the name to `skeleton/src/index.ts` so `npm run dev` works
  without a build first.

## Risks
- **Publishing too early.** Early adopters hit breaking changes. Mitigation: `0.x`
  versions and the Task 16 gate.
- **Model files not found.** The most likely setup failure. Mitigation: clear
  `load-failed` message, a copy step in the README, and the Phase 3 install test.
- **Template and package drift apart.** Mitigation: both come from the same `skeleton/`
  source; the template is simply the source folder.
