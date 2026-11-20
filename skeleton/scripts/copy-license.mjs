// Copies the repo LICENSE into the package folder (or into the folder given as the
// first argument). `npm pack` leaves out files from the parent folder, so the build
// does this to put the LICENSE in the tarball.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../../LICENSE');
const destDir = resolve(process.argv[2] ?? resolve(here, '..'));
mkdirSync(destDir, { recursive: true });
copyFileSync(source, resolve(destDir, 'LICENSE'));
