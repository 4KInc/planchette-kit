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

## Kiro power
`power-planchette/` is a Kiro power (Agent Plugins format: `plugin.json`, `mcp.json`, `skills/`) for
developers who are building a hands-free web app. After you install it you can:
- ask Kiro to check your layout for accidental dwell selections (`check-dwell-layout`): it exports your
  target rectangles, runs the dwell simulator over six simulated users and seeds 1 to 10, applies the gate
  used for this repository's own apps (at most 10 accidental selections per 100 intended, worst seed) and
  picks the dwell time by the multi-seed rule;
- compare two dwell times (`compare-dwell-settings`): accidents saved against time added to each selection;
- build on the skeleton correctly (`build-on-the-skeleton`), with the accessibility rules copied in.

The simulated users are models built from published group averages, not real people. The power is not a
medical device.

**Needs Node.js 20 or later on your PATH.** The simulator ships inside the power as one file
(`power-planchette/dwell-sim-mcp.mjs`), so there is nothing to build or install.

Install, either way (Kiro IDE, Powers panel, Add Custom Power):
1. **From a folder.** Clone this repository, choose "Import power from a folder", select the
   `power-planchette` folder, and click Install.
2. **From the repository URL.** Choose "Import power from a repository URL" (named "Import power from GitHub"
   before Kiro IDE 1.4.236) and enter
   `https://github.com/4KInc/planchette-kit/tree/main/power-planchette`, then click Install.

Kiro runs the simulator as `power-planchette-dwell-sim` and shows its three tools, `list_users`,
`simulate` and `compare`, in the power's details. If that server shows "Connection closed" or a message
naming `${PLUGIN_ROOT}`, Kiro does not expand `${PLUGIN_ROOT}` in `mcp.json`. The Kiro docs do not say how
`mcp.json` paths resolve; the Agent Plugins specification does. In that case replace the server's `args` in
`power-planchette/mcp.json` with `["./dwell-sim-mcp.mjs"]` and add `"cwd": "${PLUGIN_ROOT}"`, then reinstall.
The tests start the server both ways.

**Rebuilding the simulator file.** `power-planchette/dwell-sim-mcp.mjs` is generated from
`tools/dwell-sim-mcp/src` and `skeleton/src` and is committed. After you change either, run
`npm run bundle:power` or the manual Kiro hook "Rebuild power bundle", and commit the file. `npm test`
fails while the file is out of date. The licences of what it contains are in `THIRD_PARTY.md`.

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
