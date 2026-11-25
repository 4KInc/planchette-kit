/**
 * Builds apps/board/data/prediction-word-list.json from the committed copy of
 * FrequencyWords' en_50k.txt (CC BY-SA 4.0, see data/prediction-word-list.LICENSE.md).
 * Reads only that file. Never touches the network.
 *
 * Rules, in order: lower-case; keep only entries matching /^[a-z][a-z']+$/ (start with
 * a letter, then letters or apostrophes, length 2 or more); drop every core-vocabulary word; keep the first 5,000 remaining entries in
 * source order. Frequency of the entry at 0-based rank r is 1 / (r + 1), so it lies in
 * (0, 1] and is strictly decreasing with rank.
 */
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CORE_VOCABULARY } from '../src/core-vocabulary.js';

export const WORD_LIST_SIZE = 5000;

export const SOURCE_PATH = fileURLToPath(new URL('../data/source/en_50k.txt', import.meta.url));
export const OUTPUT_PATH = fileURLToPath(new URL('../data/prediction-word-list.json', import.meta.url));

/** Pure: source text (`word count` per line) to `{ word: normalisedFrequency }`. */
export function buildPredictionWordList(
  sourceText: string,
  coreWords: readonly string[] = CORE_VOCABULARY.map((b) => b.label),
  size: number = WORD_LIST_SIZE,
): Record<string, number> {
  const core = new Set(coreWords.map((w) => w.toLowerCase()));
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const line of sourceText.split(/\r?\n/)) {
    const word = line.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    if (!/^[a-z][a-z']+$/.test(word)) continue;
    if (core.has(word)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    kept.push(word);
    if (kept.length === size) break;
  }
  const out: Record<string, number> = {};
  kept.forEach((word, rank) => {
    out[word] = 1 / (rank + 1);
  });
  return out;
}

export function serialise(list: Record<string, number>): string {
  return JSON.stringify(list, null, 0) + '\n';
}

/**
 * CLI. Paths come from argv[2] (the board app directory) or the current directory, not
 * from import.meta.url, so the compiled copy in a temporary directory still finds the data.
 */
function main(): void {
  const boardDir = process.argv[2] ?? process.cwd();
  const source = join(boardDir, 'data', 'source', 'en_50k.txt');
  const output = join(boardDir, 'data', 'prediction-word-list.json');
  const list = buildPredictionWordList(readFileSync(source, 'utf8'));
  writeFileSync(output, serialise(list));
  console.log(`wrote ${Object.keys(list).length} entries to ${output}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
