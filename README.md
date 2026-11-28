# Planchette Kit

Hands-free input for web apps: head pointing with dwell, a face-gesture switch, single-switch
scanning and a mouse fallback, from one input layer (`skeleton/`). Everything runs on the
device: no camera frame, landmark or profile leaves the browser.

Not a medical device, and not a replacement for an AAC system assessed by a speech-language
therapist.

## Run it

```
npm install
npm run dev     # the demo at /, the communication board at /board/, Séance (a head-pointer practice game) at /seance/
npm test        # unit and property tests
npm run build   # production build in dist/
```

## Head tracking download

Head pointing uses MediaPipe Face Landmarker, served from this site, never from a CDN. The
files are downloaded only when the camera is first started, then cached by the browser:

| File | Size |
|---|---|
| MediaPipe library (`@mediapipe/tasks-vision` 0.10.35, JavaScript) | 137 KB |
| WASM loader and binary, one pair: SIMD (most browsers) or nosimd (older ones) | 11.5 MB or 10.8 MB |
| Face model `face_landmarker.task` | 3.76 MB |
| **Total** | **about 15.4 MB** (about 7 MB if the server compresses the WASM) |

Scanning, the keyboard switch, gamepad switch and mouse need none of these files.

The build copies the files into `dist/mediapipe/` (`skeleton/scripts/mediapipe-assets.ts`).
An app using the skeleton elsewhere serves the same files and passes their folder as
`createPlanchette({ assetsUrl })`; see `THIRD_PARTY.md` for their sources and licences.
