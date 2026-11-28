# API cheat sheet (checked against the skeleton's exports on 28 Nov 2026)

Import only from the two public entry points. Anything not exported there is private and may change.

```ts
import { createPlanchette, pointToRotation, rotationToPoint } from '@planchette/skeleton';
import type { Planchette, PlanchetteOptions, Profile, Rect, TargetOptions, TargetRole, InputMode } from '@planchette/skeleton';
import {
  createTargetRegistry, createDwellRing, createScanHighlight, mountInputControls, createSettingsGate,
  fitCellSize, renderedCellSize, PAGE_FIT,
} from '@planchette/skeleton/ui';
```

Until the skeleton is published to npm (`docs/npm-package-plan.md` in the repository) it is a template:
copy `skeleton/` into your repository as a package, or alias both names to `skeleton/src/index.ts` and
`skeleton/src/ui/index.ts` as the repository's `vite.config.ts` does. Importing does nothing by itself.

## Planchette (`createPlanchette(options)`)
- Options: `screen: { width, height }`, `assetsUrl` (folder that serves the MediaPipe WASM and model, from
  your own site), `profile` (partial), `trackingIndicator` (an element, `false`, or default).
- Targets: `registerTarget(id, rect, { autoRepeat?, role? })`, `updateTarget(id, rect)`,
  `unregisterTarget(id)`, `getTargets()`. Roles: `default`, `cancel`, `undo`, `rest-area`.
- `setScreen({ width, height })` on every resize. `setMode(mode)`: `head + dwell`, `scan`,
  `head + gesture`, `gesture scan`, `mouse`.
- Camera: `startCamera()` (a promise; call it only on a press, or on load if `profile.startCameraOnLoad`),
  `stopCamera()`.
- Profile: `getProfile()`, `setProfile(partial)`, `exportProfile()` (JSON string), `importProfile(json)`.
  `dwellTime`, `graceTime`, `headDeadZone`, `smoothingStrength`, `scanInterval`, `noFaceTimeout`, and more.
- Calibration: `startCalibration()`, `cancelCalibration()`, `recentre()`.
- Events (`addEventListener(type, (event) => event.detail)`): `pointer-move`, `dwell-progress`,
  `highlight`, `select` (`targetId`, `now`, `source`, `role`), `cancel`, `tracking-status`.
  Every input mode raises the same events, so the app has one handler.
- `destroy()`.

## Page conventions the UI helpers read
- A target is an element with `data-planchette-target="<unique id>"` and optionally
  `data-role="cancel" | "undo" | "rest-area" | "default"`.
- `createTargetRegistry(planchette)` gives `register(el)`, `unregister(el)`, `update()` (re-measure all
  after a resize or a layout change), `has(id)`, `rects()`. The registry has no auto-repeat attribute: for
  an auto-repeat target (for example backspace) call `registerTarget(id, rect, { autoRepeat: true })`.
- `mountInputControls({ host: planchette, document, text, saveProfile, firstRun? })` expects `#mode`
  (select), `#calibrate` (button), `#controls-message`, a `camera-toggle` target (a button with
  `data-planchette-target="camera-toggle"`), and optionally `#camera-status`, `#settings` (a dialog),
  `#settings-button`, `#settings-message`. Every string comes from your own `text` object. It never starts
  the camera by itself. Call `setCameraOn(true)` after your own start on load.
- `createSettingsGate(document)` has `isStale(select.detail.now)` and `destroy()`. A `select` is raised on
  the next animation frame, so a press made while the settings dialog was open can arrive after it closed.
  Ignore a `select` for which `isStale` is true, and ignore every `select` while the dialog is open.
- `createDwellRing(planchette, { shape })` and `createScanHighlight(planchette)` draw progress and the scan
  highlight. They decide nothing.
- `fitCellSize(gap, stripRows, viewport, barHeight)` and `renderedCellSize(profileSize, gap, stripRows,
  viewport, barHeight?)` give the largest whole cell size at which the repository's two-column page fits the
  viewport, never below the profile's target size. `PAGE_FIT` holds the numbers of that page. If your page
  is built differently, you still must pass the no-scroll check at 1366x768 and 1920x1080.
