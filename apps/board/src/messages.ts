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
    phrasesTitle: 'Quick phrases',
    /** Visible text of the rest area; the full sentence is its aria-label. */
    restArea: 'Rest area',
    restAreaHelp: 'Rest area. Nothing here is selected.',
  },
  /** The Phrases view's page controls and its screen-reader page position. */
  phrases: {
    previous: 'Previous',
    next: 'Next',
    pageOf: (n: number, m: number): string => `Page ${n} of ${m}`,
  },
  /** Labels of the action row. */
  actions: {
    speak: 'Speak',
    backspace: 'Backspace',
    clear: 'Clear',
    undo: 'Undo',
    spell: 'Spell',
    cancel: 'Cancel',
    phrases: 'Phrases',
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
    settings: 'Settings',
    calibrate: 'Calibrate',
    cameraStopped: 'Camera stopped.',
    calibrateNeedsCamera: 'Calibration uses your head: press Start camera first.',
    /** Hint while a camera mode is chosen and the camera is off. */
    needsCameraHint:
      'Head and gesture modes need the camera: press Start camera. Or choose switch scanning or the mouse; they work without it.',
    /** Shown until the first select or camera start, when no saved Profile existed at load. */
    firstRunHint: 'Choose an input mode, or press Start camera',
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
    title: 'Settings',
    close: 'Close',
    voice: 'Voice',
    defaultVoice: 'Default (first local voice)',
    noLocalVoices: 'No local voices available',
    speechRate: 'Speech rate',
    speechRateHelp: 'From 0.5 (slow) to 2.0 (fast).',
    predictionSlotCount: 'Number of suggestions',
    predictionSlotCountHelp:
      'From 2 to 8. Takes effect the next time the page opens. More than 4 may need scrolling on a small screen.',
    editQuickPhrases: 'Edit quick phrases',
    filterOffensiveWords: 'Filter offensive words from suggestions',
    startCameraOnLoad: 'Start camera when the page opens',
    startCameraOnLoadHelp: 'Off by default. The camera only starts when this is on, or when you press Start camera.',
    calibrateHelp: 'Calibration uses the camera and closes this window.',
    about: 'About',
    back: 'Back',
    groups: {
      voice: 'Speech',
      suggestions: 'Suggestions',
      camera: 'Camera',
      pointing: 'Head pointing',
      timing: 'Timing',
      scanning: 'Scanning',
      gesture: 'Gesture',
      calibration: 'Calibration limits',
      layout: 'Target layout',
      transfer: 'Export and import',
    },
    /** Help text under a Profile field: allowed range, default. */
    range: (min: number, max: number, unit: string, def: number | string): string =>
      `Allowed: ${min} to ${max}${unit === '' ? '' : ` ${unit}`}. Default: ${def}${unit === '' ? '' : ` ${unit}`}.`,
    rangeMinOnly: (min: number, note: string, unit: string, def: number | string): string =>
      `Allowed: ${min}${unit === '' ? '' : ` ${unit}`} up to ${note}. Default: ${def}${unit === '' ? '' : ` ${unit}`}.`,
    deadZoneNote: 'half the smallest calibration limit',
    acceptanceNote: 'just under the cancel hold time',
    releaseNote: 'the gesture threshold minus 0.05',
    fromCalibration: 'Set by calibration.',
    defaultIs: (def: string): string => `Default: ${def}.`,
    rangeOnly: (min: number, max: number, unit: string): string => `Allowed: ${min} to ${max}${unit === '' ? '' : ` ${unit}`}.`,
    switchBindingHelp: 'One key, mouse button or gamepad button, for example Space, MouseLeft or GamepadButton0.',
    switchGestureOptions: { 'jaw open': 'Jaw open', 'brow raise': 'Brow raise' },
    fields: {
      switchGesture: 'Switch gesture',
      switchBinding: 'Switch binding',
      headGain: 'Head gain',
      headDeadZone: 'Head dead zone',
      smoothingStrength: 'Smoothing strength',
      dwellTime: 'Dwell time',
      graceTime: 'Grace time',
      postSelectionPause: 'Pause after a selection',
      autoRepeatInterval: 'Auto-repeat interval',
      scanInterval: 'Scan interval',
      scanLoopsBeforePause: 'Scan loops before pause',
      switchAcceptanceTime: 'Switch acceptance time',
      gestureAcceptanceTime: 'Gesture acceptance time',
      gestureThreshold: 'Gesture threshold',
      gestureReleaseThreshold: 'Gesture release threshold',
      cancelByHold: 'Cancel by holding',
      cancelHoldTime: 'Cancel hold time',
      noFaceTimeout: 'No-face timeout',
      inputTimeout: 'Input timeout',
      calibrationRangeLeft: 'Calibrated range, left',
      calibrationRangeRight: 'Calibrated range, right',
      calibrationRangeUp: 'Calibrated range, up',
      calibrationRangeDown: 'Calibrated range, down',
      calibrationStillnessThreshold: 'Calibration stillness threshold',
      calibrationStillnessTime: 'Calibration stillness time',
      calibrationStepTimeout: 'Calibration step timeout',
      targetSize: 'Target size',
      targetSpacing: 'Target spacing',
    },
    transfer: {
      box: 'Settings text',
      export: 'Export',
      import: 'Import',
      exported: 'Settings exported into the box. Copy it to keep it.',
      imported: 'Settings imported.',
      importedWithChanges: (changes: string): string => `Settings imported. ${changes}.`,
    },
    phrases: {
      newPhrase: 'New phrase',
      add: 'Add',
      remove: 'Remove',
      moveUp: 'Move up',
      moveDown: 'Move down',
      phraseLabel: (n: number): string => `Phrase ${n}`,
      actionLabel: (action: string, text: string): string => `${action}: ${text}`,
    },
  },
  aboutScreen: {
    title: 'About',
    version: (v: string): string => `Planchette Board version ${v}`,
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
