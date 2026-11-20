# Plan: publish the skeleton as an npm package

Status: draft, 20 Nov 2026. Not yet a spec. Nothing here changes the input-core tasks.

## Goal
A web developer can add hands-free input to their app with:

```
npm install @planchette/skeleton
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
| none | now (Tasks 1–6 done) | Keep building. Only record the decision (Phase 0). |
| `0.1.0` | Task 16 | Public API, camera adapter, failure handling, dwell ring and scan highlight helpers. |
| `0.x` | each later change | API may still change; note breaking changes in the changelog. |
| `1.0.0` | real-user testing | API frozen; breaking changes only in a new major version. |

`0.1.0` waits for Task 16, not Task 13: without the camera adapter (Task 14) there
is no head pointing, which is the main reason to install it.

## Phase 0: record the decision (now)
- [ ] Add to `.kiro/steering/product.md` under "What ships in this repo": the skeleton
      is published to npm as `@planchette/skeleton` and also usable as a template.
- [ ] Add to `.kiro/steering/tech.md`: the public API in `skeleton/src/index.ts` is the
      package's only entry point; anything not exported there is private and may change.
- [ ] Journal entry in `docs/kiro-journal.md`.

## Phase 1: package setup (alongside Task 11)
- [ ] Add `skeleton/tsconfig.build.json` that compiles only `src/` to `skeleton/dist/`
      with `declaration: true` and `declarationMap: true`. The current `tsconfig.json`
      also includes `test`, `demo` and `examples` and keeps `rootDir: "."`, so it
      cannot be used for the published build as it is.
- [ ] `skeleton/package.json`:
  - remove `private: true`
  - `version: "0.1.0"`, `license` matching the repo `LICENSE`
  - `exports: { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }`
  - `files: ["dist", "assets", "README.md", "LICENSE"]`
  - `sideEffects: false`
  - scripts: `build` (tsc with the build config), `prepublishOnly` (test then build)
  - `@mediapipe/tasks-vision` as a `dependency`, pinned exactly
- [ ] `skeleton/README.md`: install, the 15-line example, input modes, profile,
      self-hosting the model files, "not a medical device" notice.

## Phase 2: model files (with Task 14)
`tech.md` requires the MediaPipe WASM and model files to be served from the app's own
site, not a third-party CDN. A package cannot serve files, so:

- [ ] Ship the WASM and `face_landmarker.task` files in `skeleton/assets/`.
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
- [ ] Apps in this repo (`apps/board`, `apps/game`) and the dwell simulator keep
      importing the skeleton only through the public API (already a `structure.md` rule).
- [ ] `CHANGELOG.md` in `skeleton/`.

## Phase 4: publish
- [ ] Check that the npm name `@planchette/skeleton` is free, or choose another;
      create the npm organisation.
- [ ] Publish from a GitHub Action on a version tag, with npm provenance, not from a
      laptop. Run on demand (`tech.md`: CI that uses credits runs on demand).
- [ ] Turn on two-factor authentication for the npm account.

## Open questions
1. **Name.** "skeleton" means template inside this repo but is unclear on npm.
   Alternatives: `@planchette/core`, `@planchette/input`, `planchette-kit`.
2. **Licence.** Confirm the repo licence suits a published library.
3. **UI helpers.** Ship the dwell ring and scan highlight in the same package, or as
   a separate optional import (`@planchette/skeleton/ui`)?
4. **Who maintains it.** Publishing creates a duty to fix bugs and answer issues.
   Who owns that after the hackathon?

## Risks
- **Publishing too early.** Early adopters hit breaking changes. Mitigation: `0.x`
  versions and the Task 16 gate.
- **Model files not found.** The most likely setup failure. Mitigation: clear
  `load-failed` message, a copy step in the README, and the Phase 3 install test.
- **Template and package drift apart.** Mitigation: both come from the same `skeleton/`
  source; the template is simply the source folder.
