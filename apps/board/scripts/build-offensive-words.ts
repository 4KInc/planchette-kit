/**
 * Builds apps/board/data/offensive-words.json from the committed copy of the LDNOOBW
 * English list (CC BY 4.0, see data/offensive-words.LICENSE.md). Reads only that file.
 * Never touches the network.
 *
 * Rules, in order: lower-case; drop every entry not made only of a-z and apostrophes
 * (this drops every multi-word entry); de-duplicate (first occurrence wins).
 */
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
export const SOURCE_PATH = fileURLToPath(new URL('../data/source/ldnoobw-en.txt', import.meta.url));
export const OUTPUT_PATH = fileURLToPath(new URL('../data/offensive-words.json', import.meta.url));
/** Pure: source text (one entry per line) to a list of normalised single words. */
export function buildOffensiveWords(sourceText: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of sourceText.split(/\r?\n/)) {
    const word = line.trim().toLowerCase();
    if (!/^[a-z']+$/.test(word)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    out.push(word);
  }
  return out;
}
export function serialise(list: readonly string[]): string {
  return JSON.stringify(list, null, 0) + '\n';
}
/**
 * CLI. Paths come from argv[2] (the board app directory) or the current directory, not
 * from import.meta.url, so the compiled copy in a temporary directory still finds the data.
 */
function main(): void {
  const boardDir = process.argv[2] ?? process.cwd();
  const source = join(boardDir, 'data', 'source', 'ldnoobw-en.txt');
  const output = join(boardDir, 'data', 'offensive-words.json');
  const list = buildOffensiveWords(readFileSync(source, 'utf8'));
  writeFileSync(output, serialise(list));
  console.log(`wrote ${list.length} entries to ${output}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
