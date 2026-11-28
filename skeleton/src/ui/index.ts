/**
 * The optional UI helpers (Task 16), the package's `./ui` entry point. They listen to a
 * Planchette's public events and draw; they decide nothing. Nothing happens on import.
 * The tracking indicator is built in: see the `trackingIndicator` option.
 */
export { createDwellRing, type DwellRing, type DwellRingOptions, type DwellRingShape } from './dwell-ring.js';
export { createScanHighlight, type ScanHighlight, type ScanHighlightOptions } from './scan-highlight.js';
export {
  mountInputControls,
  type ControlsHost,
  type InputControls,
  type InputControlsOptions,
  type InputControlsText,
} from './input-controls.js';
export { createSettingsGate, type SettingsGate } from './settings-gate.js';
export { createTargetRegistry, elementRect, roleOptionsOf, type TargetHost, type TargetRegistry } from './dom-targets.js';
export { PAGE_FIT, fitCellSize, renderedCellSize, type Viewport } from './viewport-fit.js';
