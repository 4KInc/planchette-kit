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
  /** Page text. board-dom.ts fills every `[data-text="<key>"]` element from `page`. */
  page: {
    title: 'Planchette — Communication Board',
    heading: 'Communication Board',
    messageTitle: 'Message',
    actionsTitle: 'Actions',
    controlsTitle: 'Controls',
    coreTitle: 'Core words',
    letterTitle: 'Letters',
    restArea: 'Rest area. Nothing here is selected.',
  },
  /** Labels of the action row. */
  actions: {
    speak: 'Speak',
    backspace: 'Backspace',
    clear: 'Clear',
    undo: 'Undo',
    spell: 'Spell',
    cancel: 'Cancel',
  },
  /** The Controls row and the Status panel (Req 13). */
  controls: {
    inputMode: 'Input mode',
    modes: {
      headDwell: 'Head + dwell',
      headGesture: 'Head + gesture',
      scan: 'Switch scanning',
      gestureScan: 'Gesture scanning',
      mouse: 'Mouse',
    },
    startCamera: 'Start camera',
    stopCamera: 'Stop camera',
    calibrate: 'Calibrate',
    cameraStopped: 'Camera stopped.',
    calibrateNeedsCamera: 'Calibration uses your head: press Start camera first.',
    /** Hint while a camera mode is chosen and the camera is off. */
    needsCameraHint:
      'Head and gesture modes need the camera: press Start camera. Or choose switch scanning or the mouse; they work without it.',
    /** Hint otherwise. */
    privacyHint: 'Everything stays on this device. No camera picture is stored or sent.',
    calibrationFinished: 'Calibration finished.',
    calibrationStopped: 'Calibration stopped.',
    calibrationWorking: 'Calibration…',
    calibrationSteps: {
      centre: 'Calibration: look straight at the screen and hold still.',
      left: 'Calibration: turn your head to the left as far as is comfortable.',
      right: 'Calibration: turn your head to the right as far as is comfortable.',
      up: 'Calibration: tilt your head up as far as is comfortable.',
      down: 'Calibration: tilt your head down as far as is comfortable.',
      rest: 'Calibration: relax your face.',
      gesture: 'Calibration: make your switch gesture, held.',
    },
  },
  /** Labels of the Letter board's two non-letter keys. */
  letterBoard: {
    space: 'Space',
    backspace: '⌫ Backspace',
  },
  /** Non-blocking notice when localStorage rejects a write. */
  settingsNotSaved: 'Settings could not be saved on this device',
  /** Seed list on first run, in this order. */
  starterQuickPhrases: ['Yes', 'No', 'Thank you', 'I need help', 'Please wait', 'I want to rest'],
  quickPhrases: {
    full: 'The quick-phrases list is full (100). Remove a phrase to add a new one.',
  },
  settings: {
    voice: 'Voice',
    speechRate: 'Speech rate',
    predictionSlotCount: 'Number of suggestions',
    editQuickPhrases: 'Edit quick phrases',
    filterOffensiveWords: 'Filter offensive words from suggestions',
    startCameraOnLoad: 'Start camera when the page opens',
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
