/**
 * camera-adapter.ts — the camera and MediaPipe FaceLandmarker (design §7, Task 14).
 *
 * Opens the camera, loads the face model from the app's own origin, and sends one
 * `{ now, source: 'camera', faces }` sample per new video frame. It decides nothing about
 * pointing or selection: the engine does that (the no-face timeout too, design §4).
 *
 * Everything that touches the browser comes in through `CameraEnvironment`, so the unit
 * tests run in Node with a fake camera and a fake model and never open a real camera.
 */
import type { CameraFailureCause, TimestampedSample } from '../api-types.js';
import { facesFromResult, type FaceResultLike } from './face-result.js';

export interface TrackLike {
  stop(): void;
}
export interface StreamLike {
  getTracks(): ReadonlyArray<TrackLike>;
}
export interface VideoLike {
  srcObject: unknown;
  muted: boolean;
  playsInline: boolean;
  readonly readyState: number;
  readonly currentTime: number;
  play(): Promise<void>;
}
export interface LandmarkerLike {
  detectForVideo(video: VideoLike, timestamp: number): FaceResultLike;
  close(): void;
}

export interface CameraEnvironment {
  /** Ask for the camera. Rejects as getUserMedia does (a DOMException with a `name`). */
  getUserMedia(): Promise<StreamLike>;
  /** Load and initialise FaceLandmarker from `assetsUrl`. Rejects when a file is missing or broken. */
  loadLandmarker(assetsUrl: string): Promise<LandmarkerLike>;
  createVideo(): VideoLike;
  requestFrame(callback: () => void): number;
  cancelFrame(id: number): void;
  /** Milliseconds, the same clock as `performance.now()`. */
  now(): number;
}

export interface CameraCallbacks {
  sample(sample: TimestampedSample): void;
  /** The camera is on (the browser's camera light is on). */
  started(): void;
  /** Head tracking is running: frames are being sent. */
  running(): void;
  failed(status: 'permission-denied' | 'load-failed', cause?: CameraFailureCause): void;
  /** The camera is off again after `stop()`. */
  stopped(): void;
}

export type CameraState = 'off' | 'starting' | 'running' | 'failed';

export interface CameraAdapter {
  /** Start the camera. Resolves when it runs or has failed (failures are reported, not thrown). */
  start(): Promise<void>;
  /** Stop every track (the camera light goes off), the frame loop and the model. */
  stop(): void;
  readonly state: CameraState;
}

/** HAVE_CURRENT_DATA: the video has a frame to read. */
const HAVE_CURRENT_DATA = 2;

/** Which kind of getUserMedia rejection it was (Req 8 AC 1 "permission denied"). */
export function causeOf(error: unknown): CameraFailureCause {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'no-camera';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'in-use';
    default:
      return 'other';
  }
}

export function createCameraAdapter(env: CameraEnvironment, assetsUrl: string, cb: CameraCallbacks): CameraAdapter {
  let state: CameraState = 'off';
  /** Every start and stop begins a new session; late results of an old one are discarded. */
  let session = 0;
  let pending: Promise<void> | null = null;
  let stream: StreamLike | null = null;
  let video: VideoLike | null = null;
  let landmarker: LandmarkerLike | null = null;
  let frame: number | null = null;
  let lastVideoTime = -1;
  let lastNow = -Infinity;

  function stopTracks(s: StreamLike | null): void {
    if (s === null) return;
    for (const track of s.getTracks()) track.stop();
  }

  /** Release everything this session holds. */
  function teardown(): void {
    if (frame !== null) env.cancelFrame(frame);
    frame = null;
    stopTracks(stream);
    stream = null;
    if (video !== null) video.srcObject = null;
    video = null;
    if (landmarker !== null) landmarker.close();
    landmarker = null;
  }

  function fail(status: 'permission-denied' | 'load-failed', cause?: CameraFailureCause): void {
    teardown();
    state = 'failed';
    cb.failed(status, cause);
  }

  function tick(id: number): void {
    if (id !== session || video === null || landmarker === null) return;
    if (video.readyState >= HAVE_CURRENT_DATA && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const now = env.now();
      // MediaPipe needs increasing timestamps; this is also the adapter's own lastNow.
      if (now > lastNow) {
        lastNow = now;
        let result: FaceResultLike;
        try {
          result = landmarker.detectForVideo(video, now);
        } catch {
          // The model stopped working (for example the GPU context was lost).
          fail('load-failed');
          return;
        }
        cb.sample({ now, source: 'camera', faces: facesFromResult(result) });
        if (id !== session) return; // the sample's listeners stopped the camera
      }
    }
    frame = env.requestFrame(() => tick(id));
  }

  async function run(id: number): Promise<void> {
    // The model loads while the browser asks for the camera. A retry loads it again.
    const model = env.loadLandmarker(assetsUrl).then(
      (l) => ({ ok: true as const, l }),
      () => ({ ok: false as const }),
    );
    const discardModel = (): void => {
      void model.then((r) => {
        if (r.ok) r.l.close();
      });
    };
    let s: StreamLike;
    try {
      s = await env.getUserMedia();
    } catch (error) {
      discardModel();
      if (id === session) fail('permission-denied', causeOf(error));
      return;
    }
    if (id !== session) {
      stopTracks(s); // stopped while the browser was asking
      discardModel();
      return;
    }
    stream = s;
    cb.started();
    const r = await model;
    if (id !== session) {
      if (r.ok) r.l.close();
      return;
    }
    if (!r.ok) {
      fail('load-failed'); // also stops the camera tracks
      return;
    }
    landmarker = r.l;
    const v = env.createVideo();
    v.muted = true;
    v.playsInline = true;
    v.srcObject = s;
    video = v;
    try {
      await v.play();
    } catch (error) {
      if (id === session) fail('permission-denied', causeOf(error));
      return;
    }
    if (id !== session) return;
    state = 'running';
    lastVideoTime = -1;
    cb.running();
    frame = env.requestFrame(() => tick(id));
  }

  return {
    get state() {
      return state;
    },
    start(): Promise<void> {
      if (state === 'running') return Promise.resolve();
      if (pending !== null) return pending;
      session += 1;
      const id = session;
      state = 'starting';
      const p = run(id).finally(() => {
        if (pending === p) pending = null;
      });
      pending = p;
      return p;
    },
    stop(): void {
      const wasOn = state !== 'off';
      session += 1;
      pending = null;
      teardown();
      state = 'off';
      if (wasOn) cb.stopped();
    },
  };
}
