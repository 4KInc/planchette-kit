/**
 * messages.ts — every user-facing sentence of the Board, in one place so it can be
 * reviewed and translated (structure.md). Plain language, no error codes.
 */
export const messages = {
  /** Shown when no local-service voice exists, or speech errors or times out (Req 8 AC 2). */
  speechUnavailable: 'Speech output is unavailable on this device.',
  /** Shown on the About screen (Req 12). */
  notMedicalDevice:
    'The board is not a medical device and not a replacement for an AAC system assessed by a speech-language therapist.',
  /** Non-blocking notice when localStorage rejects a write. */
  settingsNotSaved: 'Settings could not be saved on this device',
  /** Seed list on first run, in this order. */
  starterQuickPhrases: ['Yes', 'No', 'Thank you', 'I need help', 'Please wait', 'I want to rest'],
  settings: {
    voice: 'Voice',
    speechRate: 'Speech rate',
    predictionSlotCount: 'Number of suggestions',
    editQuickPhrases: 'Edit quick phrases',
    filterOffensiveWords: 'Filter offensive words from suggestions',
  },
  about: {
    /** Universal Core vocabulary credit (CC BY 4.0). */
    coreVocabulary: {
      credit: 'Universal Core vocabulary, Center for Literacy and Disability Studies (CLDS), UNC Chapel Hill, licensed under CC BY 4.0.',
      sourceUrl: 'https://www.med.unc.edu/healthsciences/clds/universal-core-vocabulary/',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    },
    /** Prediction word list credit (CC BY-SA 4.0). */
    predictionWordList: {
      credit:
        'Prediction word list: FrequencyWords by Hermit Dave, English OpenSubtitles 2018 via OPUS, licensed under CC BY-SA 4.0. Changes made: trimmed, lower-cased and filtered. The trimmed list stays CC BY-SA 4.0; the Board code is MIT.',
      sourceUrl: 'https://github.com/hermitdave/FrequencyWords',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    },
    /** Exclusion list credit (CC BY 4.0). */
    exclusionList: {
      credit:
        'Offensive-word list: List of Dirty, Naughty, Obscene, and Otherwise Bad Words (English), copyright 2012-2020 Shutterstock, Inc., licensed under CC BY 4.0. Changes made: normalised to single lower-case words.',
      sourceUrl: 'https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    },
  },
} as const;
