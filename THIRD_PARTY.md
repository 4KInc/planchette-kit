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
