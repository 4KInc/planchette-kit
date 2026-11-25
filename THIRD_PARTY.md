# Third-party dependencies

Every dependency used in this project, its version, licence and source.

| Package | Version | Licence | Source |
|---|---|---|---|
| `vite` | 8.3.8 | MIT | https://github.com/vitejs/vite |
| `vitest` | 5.1.1 | MIT | https://github.com/vitest-dev/vitest |
| `fast-check` | 4.10.3 | MIT | https://github.com/dubzzz/fast-check |
| `typescript` | 7.0.2 | Apache-2.0 | https://github.com/microsoft/TypeScript |
| `@types/node` | 24.19.2 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| `@playwright/test` | 1.65.1 | Apache-2.0 | https://github.com/microsoft/playwright (dev only: end-to-end tests) |
| `@axe-core/playwright` | 4.14.0 | MPL-2.0 | https://github.com/dequelabs/axe-core-npm (dev only: accessibility tests; licence exception, see below) |
| `axe-core` | 4.14.1 (dependency of `@axe-core/playwright`) | MPL-2.0 | https://github.com/dequelabs/axe-core (dev only) |
| `@mediapipe/tasks-vision` | 0.10.35 | Apache-2.0 | https://github.com/google-ai-edge/mediapipe (npm: https://www.npmjs.com/package/@mediapipe/tasks-vision) |
| `@hono/node-server` | 2.1.11 | MIT | https://github.com/honojs/node-server (transitive, `tools/dwell-sim-mcp`) |
| `@modelcontextprotocol/sdk` | 1.32.2 | MIT | https://github.com/modelcontextprotocol/typescript-sdk (direct dependency of `tools/dwell-sim-mcp`) |
| `accepts` | 2.0.0 | MIT | https://github.com/jshttp/accepts (transitive, `tools/dwell-sim-mcp`) |
| `ajv` | 8.20.0 | MIT | https://github.com/ajv-validator/ajv (transitive, `tools/dwell-sim-mcp`) |
| `ajv-formats` | 3.0.1 | MIT | https://github.com/ajv-validator/ajv-formats (transitive, `tools/dwell-sim-mcp`) |
| `body-parser` | 2.4.0 | MIT | https://github.com/expressjs/body-parser (transitive, `tools/dwell-sim-mcp`) |
| `bytes` | 3.1.2 | MIT | https://github.com/visionmedia/bytes.js (transitive, `tools/dwell-sim-mcp`) |
| `call-bind-apply-helpers` | 1.0.2 | MIT | https://github.com/ljharb/call-bind-apply-helpers (transitive, `tools/dwell-sim-mcp`) |
| `call-bound` | 1.0.4 | MIT | https://github.com/ljharb/call-bound (transitive, `tools/dwell-sim-mcp`) |
| `content-disposition` | 2.0.1 | MIT | https://github.com/jshttp/content-disposition (transitive, `tools/dwell-sim-mcp`) |
| `content-type` | 1.0.5 | MIT | https://github.com/jshttp/content-type (transitive, `tools/dwell-sim-mcp`) |
| `content-type` | 2.1.0 | MIT | https://github.com/jshttp/content-type (transitive, `tools/dwell-sim-mcp`) |
| `cookie` | 0.7.2 | MIT | https://github.com/jshttp/cookie (transitive, `tools/dwell-sim-mcp`) |
| `cookie-signature` | 1.2.2 | MIT | https://github.com/visionmedia/node-cookie-signature (transitive, `tools/dwell-sim-mcp`) |
| `cors` | 2.8.6 | MIT | https://github.com/expressjs/cors (transitive, `tools/dwell-sim-mcp`) |
| `cross-spawn` | 7.0.6 | MIT | https://github.com/moxystudio/node-cross-spawn (transitive, `tools/dwell-sim-mcp`) |
| `debug` | 4.4.3 | MIT | https://github.com/debug-js/debug (transitive, `tools/dwell-sim-mcp`) |
| `depd` | 2.0.0 | MIT | https://github.com/dougwilson/nodejs-depd (transitive, `tools/dwell-sim-mcp`) |
| `dunder-proto` | 1.0.1 | MIT | https://github.com/es-shims/dunder-proto (transitive, `tools/dwell-sim-mcp`) |
| `ee-first` | 1.1.1 | MIT | https://github.com/jonathanong/ee-first (transitive, `tools/dwell-sim-mcp`) |
| `encodeurl` | 2.0.3 | MIT | https://github.com/pillarjs/encodeurl (transitive, `tools/dwell-sim-mcp`) |
| `es-define-property` | 1.0.1 | MIT | https://github.com/ljharb/es-define-property (transitive, `tools/dwell-sim-mcp`) |
| `es-errors` | 1.3.0 | MIT | https://github.com/ljharb/es-errors (transitive, `tools/dwell-sim-mcp`) |
| `es-object-atoms` | 1.1.2 | MIT | https://github.com/ljharb/es-object-atoms (transitive, `tools/dwell-sim-mcp`) |
| `escape-html` | 1.0.3 | MIT | https://github.com/component/escape-html (transitive, `tools/dwell-sim-mcp`) |
| `etag` | 1.8.1 | MIT | https://github.com/jshttp/etag (transitive, `tools/dwell-sim-mcp`) |
| `eventsource` | 3.0.7 | MIT | https://github.com/EventSource/eventsource (transitive, `tools/dwell-sim-mcp`) |
| `eventsource-parser` | 3.1.1 | MIT | https://github.com/ssh://git@github.com/rexxars/eventsource-parser (transitive, `tools/dwell-sim-mcp`) |
| `express` | 5.3.0 | MIT | https://github.com/expressjs/express (transitive, `tools/dwell-sim-mcp`) |
| `express-rate-limit` | 8.7.5 | MIT | https://github.com/express-rate-limit/express-rate-limit (transitive, `tools/dwell-sim-mcp`) |
| `fast-deep-equal` | 3.1.3 | MIT | https://github.com/epoberezkin/fast-deep-equal (transitive, `tools/dwell-sim-mcp`) |
| `fast-uri` | 3.1.9 | BSD-3-Clause | https://github.com/fastify/fast-uri (transitive, `tools/dwell-sim-mcp`) |
| `finalhandler` | 2.1.1 | MIT | https://github.com/pillarjs/finalhandler (transitive, `tools/dwell-sim-mcp`) |
| `forwarded` | 0.2.0 | MIT | https://github.com/jshttp/forwarded (transitive, `tools/dwell-sim-mcp`) |
| `fresh` | 2.0.0 | MIT | https://github.com/jshttp/fresh (transitive, `tools/dwell-sim-mcp`) |
| `function-bind` | 1.1.2 | MIT | https://github.com/Raynos/function-bind (transitive, `tools/dwell-sim-mcp`) |
| `get-intrinsic` | 1.3.0 | MIT | https://github.com/ljharb/get-intrinsic (transitive, `tools/dwell-sim-mcp`) |
| `get-proto` | 1.0.1 | MIT | https://github.com/ljharb/get-proto (transitive, `tools/dwell-sim-mcp`) |
| `gopd` | 1.2.0 | MIT | https://github.com/ljharb/gopd (transitive, `tools/dwell-sim-mcp`) |
| `has-symbols` | 1.1.0 | MIT | https://github.com/inspect-js/has-symbols (transitive, `tools/dwell-sim-mcp`) |
| `hasown` | 2.0.4 | MIT | https://github.com/inspect-js/hasOwn (transitive, `tools/dwell-sim-mcp`) |
| `hono` | 4.13.19 | MIT | https://github.com/honojs/hono (transitive, `tools/dwell-sim-mcp`) |
| `http-errors` | 2.0.1 | MIT | https://github.com/jshttp/http-errors (transitive, `tools/dwell-sim-mcp`) |
| `iconv-lite` | 0.7.3 | MIT | https://github.com/pillarjs/iconv-lite (transitive, `tools/dwell-sim-mcp`) |
| `inherits` | 2.0.4 | ISC | https://github.com/isaacs/inherits (transitive, `tools/dwell-sim-mcp`) |
| `ip-address` | 10.7.6 | MIT | https://github.com/beaugunderson/ip-address (transitive, `tools/dwell-sim-mcp`) |
| `ipaddr.js` | 1.9.1 | MIT | https://github.com/whitequark/ipaddr.js (transitive, `tools/dwell-sim-mcp`) |
| `is-promise` | 4.0.0 | MIT | https://github.com/then/is-promise (transitive, `tools/dwell-sim-mcp`) |
| `isexe` | 2.0.0 | ISC | https://github.com/isaacs/isexe (transitive, `tools/dwell-sim-mcp`) |
| `jose` | 6.2.18 | MIT | https://github.com/panva/jose (transitive, `tools/dwell-sim-mcp`) |
| `json-schema-traverse` | 1.0.0 | MIT | https://github.com/epoberezkin/json-schema-traverse (transitive, `tools/dwell-sim-mcp`) |
| `json-schema-typed` | 8.0.2 | BSD-2-Clause | https://github.com/RemyRylan/json-schema-typed (transitive, `tools/dwell-sim-mcp`) |
| `math-intrinsics` | 1.1.0 | MIT | https://github.com/es-shims/math-intrinsics (transitive, `tools/dwell-sim-mcp`) |
| `media-typer` | 1.1.1 | MIT | https://github.com/jshttp/media-typer (transitive, `tools/dwell-sim-mcp`) |
| `merge-descriptors` | 2.0.0 | MIT | https://github.com/sindresorhus/merge-descriptors (transitive, `tools/dwell-sim-mcp`) |
| `mime-db` | 1.54.0 | MIT | https://github.com/jshttp/mime-db (transitive, `tools/dwell-sim-mcp`) |
| `mime-types` | 3.0.2 | MIT | https://github.com/jshttp/mime-types (transitive, `tools/dwell-sim-mcp`) |
| `ms` | 2.1.3 | MIT | https://github.com/vercel/ms (transitive, `tools/dwell-sim-mcp`) |
| `negotiator` | 1.1.0 | MIT | https://github.com/jshttp/negotiator (transitive, `tools/dwell-sim-mcp`) |
| `object-assign` | 4.1.1 | MIT | https://github.com/sindresorhus/object-assign (transitive, `tools/dwell-sim-mcp`) |
| `object-inspect` | 1.14.0 | MIT | https://github.com/ssh://github.com/inspect-js/object-inspect (transitive, `tools/dwell-sim-mcp`) |
| `on-finished` | 2.4.2 | MIT | https://github.com/jshttp/on-finished (transitive, `tools/dwell-sim-mcp`) |
| `once` | 1.4.0 | ISC | https://github.com/isaacs/once (transitive, `tools/dwell-sim-mcp`) |
| `parseurl` | 1.3.3 | MIT | https://github.com/pillarjs/parseurl (transitive, `tools/dwell-sim-mcp`) |
| `path-key` | 3.1.1 | MIT | https://github.com/sindresorhus/path-key (transitive, `tools/dwell-sim-mcp`) |
| `path-to-regexp` | 8.4.2 | MIT | https://github.com/pillarjs/path-to-regexp (transitive, `tools/dwell-sim-mcp`) |
| `pkce-challenge` | 5.0.1 | MIT | https://github.com/crouchcd/pkce-challenge (transitive, `tools/dwell-sim-mcp`) |
| `proxy-addr` | 2.0.8 | MIT | https://github.com/jshttp/proxy-addr (transitive, `tools/dwell-sim-mcp`) |
| `qs` | 6.17.1 | BSD-3-Clause | https://github.com/ljharb/qs (transitive, `tools/dwell-sim-mcp`) |
| `range-parser` | 1.3.0 | MIT | https://github.com/jshttp/range-parser (transitive, `tools/dwell-sim-mcp`) |
| `raw-body` | 3.0.2 | MIT | https://github.com/stream-utils/raw-body (transitive, `tools/dwell-sim-mcp`) |
| `require-from-string` | 2.0.2 | MIT | https://github.com/floatdrop/require-from-string (transitive, `tools/dwell-sim-mcp`) |
| `router` | 2.3.0 | MIT | https://github.com/pillarjs/router (transitive, `tools/dwell-sim-mcp`) |
| `safer-buffer` | 2.1.2 | MIT | https://github.com/ChALkeR/safer-buffer (transitive, `tools/dwell-sim-mcp`) |
| `send` | 1.2.1 | MIT | https://github.com/pillarjs/send (transitive, `tools/dwell-sim-mcp`) |
| `serve-static` | 2.2.1 | MIT | https://github.com/expressjs/serve-static (transitive, `tools/dwell-sim-mcp`) |
| `setprototypeof` | 1.2.0 | ISC | https://github.com/wesleytodd/setprototypeof (transitive, `tools/dwell-sim-mcp`) |
| `shebang-command` | 2.0.0 | MIT | https://github.com/kevva/shebang-command (transitive, `tools/dwell-sim-mcp`) |
| `shebang-regex` | 3.0.0 | MIT | https://github.com/sindresorhus/shebang-regex (transitive, `tools/dwell-sim-mcp`) |
| `side-channel` | 1.1.1 | MIT | https://github.com/ljharb/side-channel (transitive, `tools/dwell-sim-mcp`) |
| `side-channel-list` | 1.0.1 | MIT | https://github.com/ljharb/side-channel-list (transitive, `tools/dwell-sim-mcp`) |
| `side-channel-map` | 1.0.1 | MIT | https://github.com/ljharb/side-channel-map (transitive, `tools/dwell-sim-mcp`) |
| `side-channel-weakmap` | 1.0.2 | MIT | https://github.com/ljharb/side-channel-weakmap (transitive, `tools/dwell-sim-mcp`) |
| `statuses` | 2.0.2 | MIT | https://github.com/jshttp/statuses (transitive, `tools/dwell-sim-mcp`) |
| `toidentifier` | 1.0.1 | MIT | https://github.com/component/toidentifier (transitive, `tools/dwell-sim-mcp`) |
| `type-is` | 2.1.0 | MIT | https://github.com/jshttp/type-is (transitive, `tools/dwell-sim-mcp`) |
| `unpipe` | 1.0.0 | MIT | https://github.com/stream-utils/unpipe (transitive, `tools/dwell-sim-mcp`) |
| `vary` | 1.1.2 | MIT | https://github.com/jshttp/vary (transitive, `tools/dwell-sim-mcp`) |
| `which` | 2.0.2 | ISC | https://github.com/isaacs/node-which (transitive, `tools/dwell-sim-mcp`) |
| `wrappy` | 1.0.2 | ISC | https://github.com/npm/wrappy (transitive, `tools/dwell-sim-mcp`) |
| `zod` | 4.6.7 | MIT | https://github.com/colinhacks/zod (direct dependency of `tools/dwell-sim-mcp`) |
| `zod-to-json-schema` | 3.25.2 | ISC | https://github.com/StefanTerdell/zod-to-json-schema (transitive, `tools/dwell-sim-mcp`) |

The rows marked `tools/dwell-sim-mcp` are the production dependencies of that package
(`npm ls --all --omit=dev --workspace=tools/dwell-sim-mcp`), each with the version installed and
the licence read from its `package.json`. All are MIT, ISC or BSD. `tools/dwell-sim-mcp/test/third-party.test.ts`
fails if one is missing or its version or licence differs. Two copies of `content-type` are
installed (1.0.5 and 2.1.0); both are listed.

## Model files

| File | Version | Licence | Source |
|---|---|---|---|
| `skeleton/assets/face_landmarker.task` (3,758,596 bytes, SHA-256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`) | float16, version 1 | Apache-2.0 (stated in Google's model cards for BlazeFace short range, Face Mesh V2 and Blendshape V2) | https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task (model card: https://huggingface.co/litert-community/MediaPipe-FaceLandmarker) |

The WASM files served at `mediapipe/` (`vision_wasm_internal.*`, `vision_wasm_nosimd_internal.*`)
are copied unchanged from `@mediapipe/tasks-vision` 0.10.35 at build time.

`@mediapipe/tasks-vision` is pinned to 0.10.35 on purpose: versions 1.0.0 and later send
usage and latency statistics to `https://odml.pa.googleapis.com/v1/log` every minute, and
this project sends nothing off the device. `skeleton/test/mediapipe-privacy.test.ts` fails
if the pinned version contains that logger.

`@axe-core/playwright` and `axe-core` are MPL-2.0, outside the MIT / Apache-2.0 / BSD / ISC
rule in `tech.md`. They were added on request for the automated accessibility check, as
development-only test tools: they are never bundled into the build or the package, and no
file of theirs is changed.

## Data files

| File | Version | Licence | Source |
|---|---|---|---|
| `apps/board/data/prediction-word-list.json` (5,000 entries) | Derived from `en_50k.txt` of FrequencyWords (OpenSubtitles 2018 via OPUS), by Hermit Dave | CC BY-SA 4.0. The derivative stays CC BY-SA 4.0; the Board's code is MIT. | https://github.com/hermitdave/FrequencyWords (licence: https://creativecommons.org/licenses/by-sa/4.0/) |
| Universal Core vocabulary (36 words, used in `apps/board/src/core-vocabulary.ts`) | Universal Core vocabulary, Center for Literacy and Disability Studies (CLDS), University of North Carolina at Chapel Hill (UNC) | CC BY 4.0 | https://www.med.unc.edu/healthsciences/clds/universal-core-vocabulary/ (licence: https://creativecommons.org/licenses/by/4.0/) |
| `apps/board/data/offensive-words.json` (275 entries), Exclusion list | Derived from the English list of "List of Dirty, Naughty, Obscene, and Otherwise Bad Words" (LDNOOBW), copyright 2012-2020 Shutterstock, Inc. Unmodified source copy: `apps/board/data/source/ldnoobw-en.txt` | CC BY 4.0. Changes made: single-word entries only, lower-cased, de-duplicated (see `apps/board/data/offensive-words.LICENSE.md`). | https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words (licence: https://creativecommons.org/licenses/by/4.0/) |

Changes made to the prediction word list: trimmed to the 5,000 most frequent entries,
lower-cased, filtered to words that start with a letter followed only by letters or
apostrophes, core-vocabulary words removed, and re-ranked. The full description is in
`apps/board/data/prediction-word-list.LICENSE.md`. The unmodified source copy is
`apps/board/data/source/en_50k.txt`.
