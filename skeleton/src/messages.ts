/**
 * messages.ts — every user-facing sentence of the skeleton, in one place so it can be
 * reviewed and translated (structure.md). Plain language, no error codes (Req 8 AC 2a).
 */
import type { CameraFailureCause } from './api-types.js';

export const messages = {
  cameraOn: 'Camera on',
  /** The scan's virtual items (drawn by the scan highlight). */
  scanBack: 'Back',
  scanCancel: 'Cancel',
  /** Accessible name of the bar that shows them. */
  scanItemLabel: 'Scan item',
  cameraStarting: 'Camera on. Starting head tracking…',
  tryAgain: 'Try the camera again',
  useScanning: 'Use switch scanning',
  useMouse: 'Use the mouse',
  /** The locked face is not detected (Req 2 AC 10). */
  lost: 'The camera has lost your face. Pointing is paused until it sees you again.',
  /** Tracking goes on, but the face is only just visible (accessibility.md Feedback). */
  lowConfidence: 'The camera can only just see your face. Move into the middle of the picture, a little closer, or into better light.',
  /** Said after every failure message: the person is never left without a way to go on. */
  alternatives: 'You can keep going now with switch scanning or the mouse.',
  failure: {
    /** Permission denied (the browser rejected getUserMedia), by cause. */
    denied:
      'The camera is blocked for this page. To use head pointing, allow the camera in your browser settings, then try the camera again.',
    'no-camera': 'No camera was found. Connect a camera, then try the camera again.',
    'in-use': 'The camera is being used by another app. Close that app, then try the camera again.',
    other: 'The camera could not be started. Check that it is connected, then try the camera again.',
    'load-failed':
      'Head tracking could not be loaded on this device. Reload the page or try the camera again.',
    'no-face-timeout':
      'The camera cannot see a face. Sit in front of the camera with your face in the light, or try the camera again.',
  } satisfies Record<CameraFailureCause | 'load-failed' | 'no-face-timeout', string>,
} as const;
