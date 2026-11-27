/**
 * Séance wiring. `startSeance` is the browser entry: it creates the Planchette and exposes it
 * for the end-to-end tests. Importing this module runs nothing; the page's script (entry.ts)
 * calls `startSeance`. The game itself is added in later tasks.
 */
/// <reference types="vite/client" />
import { createPlanchette, type Planchette } from '@planchette/skeleton';
export interface StartedSeance {
  readonly planchette: Planchette;
}
export function startSeance(
  doc: Document = document,
  /** A seam for tests, which pass a fake. The page uses the real `createPlanchette`. */
  create: typeof createPlanchette = createPlanchette,
): StartedSeance {
  const win = doc.defaultView;
  if (win === null) throw new Error('seance: the document has no window');
  const planchette = create({
    screen: { width: win.innerWidth, height: win.innerHeight },
    assetsUrl: `${import.meta.env.BASE_URL}mediapipe/`,
  });
  (win as unknown as { planchetteSeance: { planchette: Planchette } }).planchetteSeance = { planchette };
  return { planchette };
}
