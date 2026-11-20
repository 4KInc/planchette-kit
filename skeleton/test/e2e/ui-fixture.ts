/**
 * The page behind ui.e2e.ts. It imports the kit by its package names, as an app would,
 * and lets the test build an instance and feed it synthetic samples. Inputs are off
 * (`inputs: false`): every sample comes from the test.
 */
import { createPlanchette, type Planchette, type PlanchetteOptions, type TimestampedSample } from '@planchette/skeleton';
import { createDwellRing, createScanHighlight, type DwellRing, type ScanHighlight } from '@planchette/skeleton/ui';

interface Fixture {
  setup(options?: Partial<PlanchetteOptions>): void;
  feed(samples: TimestampedSample[]): void;
  /** Camera samples 33 ms apart pointing at a target's centre (or the screen centre, or no face). */
  look(n: number, at: string | 'centre' | null, confidence?: number, jawOpen?: number): void;
  /** Keyboard samples 16 ms apart with the given signal. */
  keys(n: number, signal: boolean): void;
  startCamera(): Promise<void>;
  /** Every event so far, as [type, detail]. */
  events: Array<[string, unknown]>;
  /** The ring's data-progress at the moment of each select. */
  ringAtSelect: string[];
  /** Every data-progress value the ring showed. */
  ringValues: string[];
}

let p: Planchette | null = null;
let ring: DwellRing | null = null;
let highlight: ScanHighlight | null = null;
let camT = 0;
let keyT = 0;

/** Inverse of the default mapping (R 15°, dead zone 0.5°, gain 1), as test/pointer-path.ts. */
function rotationFor(x: number, y: number): { yaw: number; pitch: number } {
  const inv = (u: number): number => {
    const dz = (u - 0.5) * 2 * 14.5;
    return dz === 0 ? 0 : Math.sign(dz) * (Math.abs(dz) + 0.5);
  };
  return { yaw: inv(x / (innerWidth - 1)), pitch: inv(1 - y / (innerHeight - 1)) };
}

function targetElement(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-planchette-target="${id}"]`)!;
}

const fixture: Fixture = {
  events: [],
  ringAtSelect: [],
  ringValues: [],
  setup(options = {}) {
    ring?.destroy();
    highlight?.destroy();
    p?.destroy();
    fixture.events.length = 0;
    fixture.ringAtSelect.length = 0;
    fixture.ringValues.length = 0;
    camT = 0;
    keyT = 0;
    p = createPlanchette({ screen: { width: innerWidth, height: innerHeight }, inputs: false, ...options });
    for (const el of document.querySelectorAll<HTMLElement>('[data-planchette-target]')) {
      const r = el.getBoundingClientRect();
      p.registerTarget(el.dataset.planchetteTarget!, { x: r.x, y: r.y, width: r.width, height: r.height });
    }
    ring = createDwellRing(p);
    highlight = createScanHighlight(p);
    for (const type of ['pointer-move', 'dwell-progress', 'highlight', 'select', 'cancel', 'tracking-status', 'mode-change'] as const) {
      p.addEventListener(type, (e) => {
        fixture.events.push([type, e.detail]);
        if (type === 'select') fixture.ringAtSelect.push(ring!.element.getAttribute('data-progress')!);
        if (type === 'dwell-progress') fixture.ringValues.push(ring!.element.getAttribute('data-progress')!);
      });
    }
  },
  feed(samples) {
    p!.feedSamples(samples);
  },
  look(n, at, confidence, jawOpen = 0) {
    const samples: TimestampedSample[] = [];
    let x = (innerWidth - 1) / 2;
    let y = (innerHeight - 1) / 2;
    if (at !== null && at !== 'centre') {
      const r = targetElement(at).getBoundingClientRect();
      x = r.x + r.width / 2;
      y = r.y + r.height / 2;
    }
    for (let i = 0; i < n; i++) {
      samples.push(
        at === null
          ? { now: (camT += 33), source: 'camera', faces: [] }
          : { now: (camT += 33), source: 'camera', faces: [{ bbox: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.3 }, rotation: rotationFor(x, y), confidence, gestureScores: { jawOpen, browRaise: 0 } }] },
      );
    }
    p!.feedSamples(samples);
  },
  keys(n, signal) {
    const samples: TimestampedSample[] = [];
    for (let i = 0; i < n; i++) samples.push({ now: (keyT += 16), source: 'keyboard', signal });
    p!.feedSamples(samples);
  },
  startCamera() {
    return p!.startCamera();
  },
};

(window as unknown as { fixture: Fixture }).fixture = fixture;
document.body.setAttribute('data-ready', 'true');
