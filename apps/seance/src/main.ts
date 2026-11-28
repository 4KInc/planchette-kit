/**
 * Séance wiring. `startSeance` is the browser entry: it creates the Planchette, mounts the shared input
 * controls, the Settings dialog and the game's DOM layer, and exposes the Planchette for the end-to-end
 * tests. Importing this module runs nothing; the page's script (entry.ts) calls `startSeance`.
 * The camera starts nowhere here except once on load, and only when the saved Profile asks for it.
 */
/// <reference types="vite/client" />
import { createPlanchette, type Planchette, type Profile } from '@planchette/skeleton';
import { createDwellRing, createScanHighlight, mountInputControls } from '@planchette/skeleton/ui';
import { messages } from './messages.js';
import { mountSeanceDom, type SeanceDom } from './seance-dom.js';
import { mountSeanceSettings } from './seance-settings-dom.js';
import { readSeanceProfile, resolveInitialProfile, writeSeanceProfile } from './seance-storage.js';
import { createSound, type AudioContextCtor } from './sound.js';
import type { StorageLike } from './board-link.js';
export interface StartedSeance {
  readonly planchette: Planchette;
  readonly dom: SeanceDom;
}
export interface StartOptions {
  /** A seam for tests, which pass a fake. The page uses the real `createPlanchette`. */
  readonly create?: typeof createPlanchette;
  /** Chooses the Messages. Default: one random value from `crypto.getRandomValues`. */
  readonly seed?: number;
  readonly storage?: StorageLike | undefined;
}
function defaultStorage(win: Window): StorageLike | undefined {
  try {
    return win.localStorage;
  } catch {
    return undefined;
  }
}
function randomSeed(win: Window): number {
  const a = new Uint32Array(1);
  win.crypto.getRandomValues(a);
  return a[0]!;
}
export function startSeance(doc: Document = document, options: StartOptions = {}): StartedSeance {
  const win = doc.defaultView;
  if (win === null) throw new Error('seance: the document has no window');
  const create = options.create ?? createPlanchette;
  const storage = 'storage' in options ? options.storage : defaultStorage(win);
  const status = doc.getElementById('camera-status');
  const planchette = create({
    screen: { width: win.innerWidth, height: win.innerHeight },
    assetsUrl: `${import.meta.env.BASE_URL}mediapipe/`,
    ...(status === null ? {} : { trackingIndicator: status }),
  });
  // First: the saved Profile, or Séance's 2100 ms dwell default when nothing was saved (Requirement 8 AC 4).
  const saved = readSeanceProfile(storage);
  planchette.setProfile(resolveInitialProfile(saved));
  const saveProfile = (): void => {
    writeSeanceProfile(storage, JSON.parse(planchette.exportProfile()) as Partial<Profile>);
  };
  createDwellRing(planchette, { shape: 'outline' });
  createScanHighlight(planchette);
  // Mounted before the DOM layer so the camera toggle has its label when it is registered.
  const controls = mountInputControls({
    host: planchette,
    document: doc,
    saveProfile,
    firstRun: saved.usedDefault,
    text: messages.controls,
  });
  const settings = mountSeanceSettings({ host: planchette, document: doc, saveProfile });
  const sound = createSound((win as unknown as { AudioContext?: AudioContextCtor }).AudioContext);
  const dom = mountSeanceDom({
    host: planchette,
    document: doc,
    storage,
    seed: options.seed ?? randomSeed(win),
    sound,
    saveProfile,
    isBlocked: settings.isBlocked,
  });
  // The camera starts nowhere else, and only when the person's saved Profile asks for it.
  if (planchette.getProfile().startCameraOnLoad) {
    controls.setCameraOn(true);
    planchette.startCamera().catch(() => controls.setCameraOn(false)); // the indicator shows the failure
  }
  // For the end-to-end tests and for people trying Séance in the console.
  (win as unknown as { planchetteSeance: { planchette: Planchette } }).planchetteSeance = { planchette };
  return { planchette, dom };
}
