/**
 * The optional UI helpers (Task 16), the package's `./ui` entry point. They listen to a
 * Planchette's public events and draw; they decide nothing. Nothing happens on import.
 * The tracking indicator is built in: see the `trackingIndicator` option.
 */
export { createDwellRing, type DwellRing, type DwellRingOptions } from './dwell-ring.js';
export { createScanHighlight, type ScanHighlight, type ScanHighlightOptions } from './scan-highlight.js';
