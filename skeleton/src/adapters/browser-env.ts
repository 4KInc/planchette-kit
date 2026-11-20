/**
 * browser-env.ts — the real browser behind the adapters' environments. The only file
 * that reads browser globals or loads MediaPipe. Nothing runs on import: each function
 * reads the globals when it is called.
 *
 * MediaPipe is loaded with a dynamic import, so its code is fetched only when the camera
 * is started, and the WASM and model files come from `assetsUrl` on the app's own origin.
 */
import type { CameraEnvironment, LandmarkerLike, StreamLike, VideoLike } from './camera-adapter.js';
import type { InputEnvironment } from './input-env.js';
import type { DomLike } from '../ui/tracking-indicator.js';

/** The file names the app must serve at `assetsUrl` (see THIRD_PARTY.md and README). */
export const ASSET_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
  'face_landmarker.task',
] as const;

export function hasBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function withSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

async function loadLandmarker(assetsUrl: string): Promise<LandmarkerLike> {
  const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const base = withSlash(assetsUrl);
  // useModule false: the classic-script pair, SIMD or nosimd as the browser supports.
  const fileset = await FilesetResolver.forVisionTasks(base.slice(0, -1), false);
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: `${base}face_landmarker.task`, delegate },
    runningMode: 'VIDEO' as const,
    numFaces: 2, // design §4: two faces, so the lock can follow the right one
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  });
  let landmarker;
  try {
    landmarker = await FaceLandmarker.createFromOptions(fileset, options('GPU'));
  } catch {
    // No usable GPU (or WebGL blocked): the CPU is slower but works.
    landmarker = await FaceLandmarker.createFromOptions(fileset, options('CPU'));
  }
  return {
    detectForVideo: (video, timestamp) => landmarker.detectForVideo(video as unknown as HTMLVideoElement, timestamp),
    close: () => landmarker.close(),
  };
}

export function browserCameraEnvironment(): CameraEnvironment {
  return {
    getUserMedia(): Promise<StreamLike> {
      const md = navigator.mediaDevices;
      if (md === undefined || typeof md.getUserMedia !== 'function') {
        // No camera API, for example on a page not served over HTTPS.
        return Promise.reject(Object.assign(new Error('getUserMedia is not available'), { name: 'NotSupportedError' }));
      }
      return md.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    },
    loadLandmarker,
    createVideo: () => document.createElement('video') as unknown as VideoLike,
    requestFrame: (cb) => window.requestAnimationFrame(() => cb()),
    cancelFrame: (id) => window.cancelAnimationFrame(id),
    now: () => performance.now(),
  };
}

export function browserInputEnvironment(): InputEnvironment {
  return {
    addEventListener: (type, listener) => window.addEventListener(type, listener as EventListener),
    removeEventListener: (type, listener) => window.removeEventListener(type, listener as EventListener),
    requestFrame: (cb) => window.requestAnimationFrame(cb),
    cancelFrame: (id) => window.cancelAnimationFrame(id),
    getGamepads: () => (typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : []),
  };
}

export function browserDom(): DomLike {
  return document as unknown as DomLike;
}
