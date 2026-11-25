import { describe, expect, it } from 'vitest';
import { messages } from '../src/messages.js';

describe('messages', () => {
  it('has the six starter phrases in order', () => {
    expect([...messages.starterQuickPhrases]).toEqual([
      'Yes',
      'No',
      'Thank you',
      'I need help',
      'Please wait',
      'I want to rest',
    ]);
  });

  it('has the exact speech-unavailable text', () => {
    expect(messages.speechUnavailable).toBe('Speech output is unavailable on this device.');
  });

  it('has the Settings labels, notice and About URLs', () => {
    expect(messages.settings).toEqual({
      voice: 'Voice',
      speechRate: 'Speech rate',
      predictionSlotCount: 'Number of suggestions',
      editQuickPhrases: 'Edit quick phrases',
      filterOffensiveWords: 'Filter offensive words from suggestions',
    });
    expect(messages.notMedicalDevice).toBe(
      'The board is not a medical device and not a replacement for an AAC system assessed by a speech-language therapist.',
    );
    const urls = Object.values(messages.about).flatMap((c) => [c.sourceUrl, c.licenseUrl]);
    for (const u of [
      'https://github.com/hermitdave/FrequencyWords',
      'https://www.med.unc.edu/healthsciences/clds/universal-core-vocabulary/',
      'https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words',
      'https://creativecommons.org/licenses/by-sa/4.0/',
      'https://creativecommons.org/licenses/by/4.0/',
    ]) {
      expect(urls).toContain(u);
    }
  });
});
