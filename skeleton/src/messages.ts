/**
 * messages.ts — every user-facing sentence of the skeleton, in one place so it can be
 * reviewed and translated (structure.md). Plain language, no error codes (Req 8 AC 2a).
 */
import type { CameraFailureCause } from './api-types.js';

export const messages = {
  cameraOn: 'Camera on',
  cameraStarting: 'Camera on. Starting head tracking…',
  tryAgain: 'Try the camera again',
  useScanning: 'Use switch scanning',
  useMouse: 'Use the mouse',
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
