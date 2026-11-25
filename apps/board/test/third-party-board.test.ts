import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const THIRD_PARTY = fileURLToPath(new URL('../../../THIRD_PARTY.md', import.meta.url));

/** The text of the "Data files" section, up to the next "## " heading. */
function dataFilesSection(): string {
  const text = readFileSync(THIRD_PARTY, 'utf8');
  const section = text.split(/^## Data files$/m)[1];
  if (section === undefined) throw new Error('No "Data files" section in THIRD_PARTY.md');
  return section.split(/^## /m)[0] ?? '';
}

/** The table row of the "Data files" section that mentions `marker`. */
function entry(marker: string): string {
  const row = dataFilesSection()
    .split('\n')
    .find((line) => line.startsWith('|') && line.includes(marker));
  if (row === undefined) throw new Error(`No Data files entry mentions ${marker}`);
  return row;
}

describe('THIRD_PARTY.md Data files section', () => {
  it('records the prediction word list', () => {
    const row = entry('apps/board/data/prediction-word-list.json');
    for (const needle of ['FrequencyWords', 'Hermit Dave', 'CC BY-SA 4.0', '5,000']) {
      expect(row, needle).toContain(needle);
    }
  });

  it('mentions the unmodified source copy', () => {
    expect(dataFilesSection()).toContain('apps/board/data/source/en_50k.txt');
  });

  it('records the Universal Core vocabulary', () => {
    const row = entry('Universal Core vocabulary');
    expect(row).toContain('CC BY 4.0');
    expect(row).toContain('CLDS');
  });

  it('records the Exclusion list', () => {
    const row = entry('apps/board/data/offensive-words.json');
    for (const needle of ['LDNOOBW', 'Shutterstock', 'CC BY 4.0']) {
      expect(row, needle).toContain(needle);
    }
  });
});
