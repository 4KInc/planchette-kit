/**
 * The camera adapter (Task 14.1–14.5), through createPlanchette with a fake camera, a fake
 * FaceLandmarker and a fake DOM. No real camera is opened and MediaPipe is not loaded.
 */
import { describe, expect, it } from 'vitest';
import type { PlanchetteEventMap } from '../src/api-types';
import { causeOf, createCameraAdapter } from '../src/adapters/camera-adapter';
import { facesFromResult, rotationFromMatrix } from '../src/adapters/face-result';
import { messages } from '../src/messages';
import { createPlanchetteInternal } from '../src/planchette';
import { FakeCameraEnv, FakeDom, FakeTrack, faceResult, flush } from './fakes';

function setup(profile: Record<string, unknown> = {}, extra: { cameraStatus?: false; assetsUrl?: string } = {}) {
  const cam = new FakeCameraEnv();
  const dom = new FakeDom();
  const { planchette: p, inspect } = createPlanchetteInternal(
    { screen: { width: 1000, height: 800 }, profile, ...extra },
    { camera: cam, dom },
  );
  const status: Array<PlanchetteEventMap['tracking-status']> = [];
  const moves: Array<{ x: number; y: number }> = [];
  const selects: string[] = [];
  p.addEventListener('tracking-status', (e) => status.push(e.detail));
  p.addEventListener('pointer-move', (e) => moves.push(e.detail));
  p.addEventListener('select', (e) => selects.push(e.detail.targetId));
  return { cam, dom, p, inspect, status, moves, selects };
}

describe('face results from MediaPipe (14.1)', () => {
  it('turns landmarks, the transformation matrix and blendshapes into an engine face', () => {
    const [f] = facesFromResult(faceResult({ cx: 0.4, cy: 0.6, size: 0.2, yaw: 12, pitch: -7, jawOpen: 0.8, browInnerUp: 0.3 }));
    expect(f.bbox.cx).toBeCloseTo(0.4, 9);
    expect(f.bbox.cy).toBeCloseTo(0.6, 9);
    expect(f.bbox.w).toBeCloseTo(0.2, 9);
    expect(f.bbox.h).toBeCloseTo(0.2, 9);
    expect(f.rotation.yaw).toBeCloseTo(12, 9);
    expect(f.rotation.pitch).toBeCloseTo(-7, 9);
    expect(f.gestureScores).toEqual({ jawOpen: 0.8, browRaise: 0.3 });
  });

  it('an identity matrix is a head facing the camera', () => {
    const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const r = rotationFromMatrix({ rows: 4, columns: 4, data: id });
    expect(Math.abs(r.yaw)).toBe(0);
    expect(Math.abs(r.pitch)).toBe(0);
  });

  it('a missing or malformed matrix gives an unknown rotation (NaN), and missing blendshapes count as 0', () => {
    expect(rotationFromMatrix(undefined)).toEqual({ yaw: NaN, pitch: NaN });
    expect(rotationFromMatrix({ rows: 3, columns: 3, data: [1, 0, 0, 0, 1, 0, 0, 0, 1] })).toEqual({ yaw: NaN, pitch: NaN });
    const [f] = facesFromResult({ faceLandmarks: [[{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.3 }]] });
    expect(f.rotation.yaw).toBeNaN();
    expect(f.gestureScores).toEqual({ jawOpen: 0, browRaise: 0 });
  });

  it('two faces give two faces, each with its own scores; no landmarks give no face', () => {
    const a = faceResult({ cx: 0.3, jawOpen: 0.9 });
    const b = faceResult({ cx: 0.7, jawOpen: 0.1 });
    const two = facesFromResult({
      faceLandmarks: [...a.faceLandmarks, ...b.faceLandmarks],
      faceBlendshapes: [...a.faceBlendshapes!, ...b.faceBlendshapes!],
      facialTransformationMatrixes: [...a.facialTransformationMatrixes!, ...b.facialTransformationMatrixes!],
    });
    expect(two.map((f) => f.gestureScores!.jawOpen)).toEqual([0.9, 0.1]);
    expect(facesFromResult({ faceLandmarks: [] })).toEqual([]);
    expect(facesFromResult({ faceLandmarks: [[]] })).toEqual([]);
  });
});

describe('starting the camera (14.1)', () => {
  it('opens the camera, loads the model from the assets URL and sends one sample per new video frame', async () => {
    const t = setup({}, { assetsUrl: '/app/mediapipe/' });
    await t.p.startCamera();
    expect(t.cam.getUserMediaCalls).toBe(1);
    expect(t.cam.loadCalls).toEqual(['/app/mediapipe/']);
    expect(t.cam.video!.srcObject).toBe(t.cam.stream);
    expect(t.cam.video!.muted).toBe(true);
    t.cam.frame(faceResult());
    t.cam.frame(faceResult());
    expect(t.cam.landmarker!.calls).toHaveLength(2);
    expect(t.status.map((s) => s.status)).toEqual(['found']);
    expect(t.moves.length).toBeGreaterThan(0);
  });

  it('the default assets URL is /mediapipe/ on the same origin', async () => {
    const t = setup();
    await t.p.startCamera();
    expect(t.cam.loadCalls).toEqual(['/mediapipe/']);
  });

  it('sends nothing when the video has no new frame', async () => {
    const t = setup();
    await t.p.startCamera();
    t.cam.frame(faceResult());
    t.cam.clock += 33;
    t.cam.frames.step(t.cam.clock); // same video time: no new frame
    expect(t.cam.landmarker!.calls).toHaveLength(1);
    t.cam.video!.readyState = 1; // no data yet
    t.cam.frame();
    expect(t.cam.landmarker!.calls).toHaveLength(1);
  });

  it('never gives MediaPipe a timestamp that is not later than the last one', async () => {
    const t = setup();
    await t.p.startCamera();
    t.cam.frame(faceResult());
    t.cam.clock -= 50; // the clock went back
    t.cam.video!.currentTime += 1;
    t.cam.frames.step(0);
    expect(t.cam.landmarker!.calls).toHaveLength(1);
  });

  it('the samples drive the head pointer: turning the head to the right moves the pointer right', async () => {
    const t = setup();
    await t.p.startCamera();
    for (let i = 0; i < 60; i++) t.cam.frame(faceResult()); // the start-up centre step at 0°
    expect(t.inspect().calibration).toBeNull();
    for (let i = 0; i < 20; i++) t.cam.frame(faceResult({ yaw: 10 }));
    expect(t.moves.at(-1)!.x).toBeGreaterThan(800);
  });

  it('a frame with no face is a frameless sample: tracking-status lost', async () => {
    const t = setup();
    await t.p.startCamera();
    t.cam.frame(faceResult());
    t.cam.frame({ faceLandmarks: [] });
    expect(t.status.map((s) => s.status)).toEqual(['found', 'lost']);
  });

  it('startCamera while the camera runs or is starting does nothing new', async () => {
    const t = setup();
    const a = t.p.startCamera();
    const b = t.p.startCamera();
    await Promise.all([a, b]);
    await t.p.startCamera();
    expect(t.cam.getUserMediaCalls).toBe(1);
    expect(t.cam.loadCalls).toHaveLength(1);
  });

  it('startCamera resolves even when the camera fails (the failure is an event, not an error)', async () => {
    const t = setup();
    t.cam.denyWith = 'NotAllowedError';
    await expect(t.p.startCamera()).resolves.toBeUndefined();
  });
});

describe('the camera on indicator (Req 2 AC 2, AC 12)', () => {
  it('shows while the camera is on and is removed when it stops', async () => {
    const t = setup();
    expect(t.dom.box).toBeUndefined();
    await t.p.startCamera();
    expect(t.dom.box).toBeDefined();
    expect(t.dom.box!.attributes.role).toBe('status');
    expect(t.dom.box!.textContent).toContain(messages.cameraOn);
    t.p.stopCamera();
    expect(t.dom.box).toBeUndefined();
  });

  it('shows "starting" between the camera opening and the model being ready', async () => {
    const t = setup();
    t.cam.manual = true;
    const started = t.p.startCamera();
    await flush();
    expect(t.dom.box).toBeUndefined(); // the browser is still asking: the camera is not on
    t.cam.grantCamera();
    await flush();
    expect(t.dom.box!.textContent).toBe(messages.cameraStarting);
    t.cam.finishLoad();
    await started;
    expect(t.dom.box!.textContent).toBe(messages.cameraOn);
  });

  it('cameraStatus: false shows nothing (the app renders the events itself)', async () => {
    const t = setup({}, { cameraStatus: false });
    await t.p.startCamera();
    expect(t.dom.body.children).toHaveLength(0);
  });
});

describe('stopping the camera (Req 2 AC 12)', () => {
  it('stops every track, so the camera light goes off, and closes the model', async () => {
    const t = setup();
    await t.p.startCamera();
    t.cam.stream!.tracks.push(new FakeTrack()); // a second track: every one must stop
    expect(t.cam.lightOn).toBe(true);
    t.p.stopCamera();
    expect(t.cam.stream!.tracks.every((tr) => tr.stopped)).toBe(true);
    expect(t.cam.lightOn).toBe(false);
    expect(t.cam.landmarker!.closed).toBe(true);
    expect(t.cam.video!.srcObject).toBeNull();
  });

  it('stops the frame loop: no more samples', async () => {
    const t = setup();
    await t.p.startCamera();
    t.cam.frame(faceResult());
    t.p.stopCamera();
    expect(t.cam.frames.pending).toBe(0);
    t.cam.frame(faceResult());
    expect(t.cam.landmarker!.calls).toHaveLength(1);
  });

  it('stopping while the browser is still asking stops the camera as soon as it is granted', async () => {
    const t = setup();
    t.cam.manual = true;
    const started = t.p.startCamera();
    t.p.stopCamera();
    const s = t.cam.grantCamera();
    t.cam.finishLoad();
    await started;
    await flush();
    expect(s.tracks.every((tr) => tr.stopped)).toBe(true);
    expect(t.cam.landmarker!.closed).toBe(true);
    expect(t.dom.box).toBeUndefined();
    expect(t.cam.frames.pending).toBe(0);
  });

  it('stopping while the model loads stops the camera and closes the model when it arrives', async () => {
    const t = setup();
    t.cam.manual = true;
    const started = t.p.startCamera();
    const s = t.cam.grantCamera();
    await flush();
    t.p.stopCamera();
    expect(s.tracks.every((tr) => tr.stopped)).toBe(true);
    const l = t.cam.finishLoad();
    await started;
    await flush();
    expect(l.closed).toBe(true);
    expect(t.cam.frames.pending).toBe(0);
  });

  it('destroy() stops the camera and removes the status box', async () => {
    const t = setup();
    await t.p.startCamera();
    t.p.destroy();
    expect(t.cam.lightOn).toBe(false);
    expect(t.dom.box).toBeUndefined();
  });
});

describe('permission denied (14.2, Req 8 AC 1–2)', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'no-camera'],
    ['OverconstrainedError', 'no-camera'],
    ['NotReadableError', 'in-use'],
    ['TypeError', 'other'],
    ['NotSupportedError', 'other'],
  ] as const)('a getUserMedia rejection %s is permission-denied, cause %s', async (name, cause) => {
    const t = setup();
    t.cam.denyWith = name;
    await t.p.startCamera();
    expect(t.status).toEqual([
      { status: 'permission-denied', cause, message: messages.failure[cause], alternatives: ['scan', 'mouse'] },
    ]);
  });

  it('shows the plain-language message and offers switch scanning, the mouse and a retry', async () => {
    const t = setup();
    t.cam.denyWith = 'NotAllowedError';
    await t.p.startCamera();
    const box = t.dom.box!;
    expect(box.textContent).toContain(messages.failure.denied);
    expect(box.textContent).toContain(messages.alternatives);
    const buttons = box.all('button').map((b) => b.textContent);
    expect(buttons).toEqual([messages.tryAgain, messages.useScanning, messages.useMouse]);
  });

  it('the offered buttons switch the mode', async () => {
    const t = setup();
    t.cam.denyWith = 'NotAllowedError';
    await t.p.startCamera();
    t.dom.box!.all('button')[1].click();
    expect(t.p.getProfile().mode).toBe('scan');
    t.dom.box!.all('button')[2].click();
    expect(t.p.getProfile().mode).toBe('mouse');
  });

  it('no message contains an error code or an exception name', async () => {
    for (const name of ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'TypeError']) {
      const t = setup();
      t.cam.denyWith = name;
      await t.p.startCamera();
      const text = `${t.dom.box!.textContent} ${t.status[0].message}`;
      expect(text).not.toMatch(/Error|Exception|getUserMedia|DOM|\b0x|\bcode\b|\d{3}/);
    }
  });

  it('does not leave a model loaded', async () => {
    const t = setup();
    t.cam.denyWith = 'NotAllowedError';
    await t.p.startCamera();
    await flush();
    expect(t.cam.landmarkers.every((l) => l.closed)).toBe(true);
  });
});

describe('load failure (14.3)', () => {
  it('a model that fails to load is load-failed, with its message, and the camera light goes off', async () => {
    const t = setup();
    t.cam.failLoads = 1;
    await t.p.startCamera();
    expect(t.status).toEqual([{ status: 'load-failed', message: messages.failure['load-failed'], alternatives: ['scan', 'mouse'] }]);
    expect(t.cam.lightOn).toBe(false);
    expect(t.dom.box!.textContent).toContain(messages.failure['load-failed']);
  });

  it('the model failing while running (detectForVideo throws) is load-failed too, and stops the camera', async () => {
    const t = setup();
    await t.p.startCamera();
    t.cam.frame(faceResult());
    t.cam.landmarker!.throwNext = true;
    t.cam.frame(faceResult());
    expect(t.status.map((s) => s.status)).toEqual(['found', 'load-failed']);
    expect(t.cam.lightOn).toBe(false);
    expect(t.cam.frames.pending).toBe(0);
  });

  it('a video that will not play is reported as permission-denied (the camera cannot be used)', async () => {
    const t = setup();
    t.cam.playFails = true;
    await t.p.startCamera();
    expect(t.status.map((s) => s.status)).toEqual(['permission-denied']);
    expect(t.cam.lightOn).toBe(false);
  });
});

describe('retry without reloading (14.5, Req 8 AC 4)', () => {
  it('after a load failure, startCamera loads MediaPipe again and runs', async () => {
    const t = setup();
    t.cam.failLoads = 1;
    await t.p.startCamera();
    await t.p.startCamera();
    expect(t.cam.loadCalls).toHaveLength(2);
    expect(t.cam.getUserMediaCalls).toBe(2);
    t.cam.frame(faceResult());
    expect(t.status.map((s) => s.status)).toEqual(['load-failed', 'found']);
    expect(t.dom.box!.textContent).toBe(messages.cameraOn);
  });

  it('after permission denied, startCamera asks again', async () => {
    const t = setup();
    t.cam.denyWith = 'NotAllowedError';
    await t.p.startCamera();
    t.cam.denyWith = null;
    await t.p.startCamera();
    t.cam.frame(faceResult());
    expect(t.status.map((s) => s.status)).toEqual(['permission-denied', 'found']);
  });

  it('the "Try the camera again" button retries', async () => {
    const t = setup();
    t.cam.failLoads = 1;
    await t.p.startCamera();
    t.dom.box!.all('button')[0].click();
    await flush();
    expect(t.cam.loadCalls).toHaveLength(2);
    expect(t.inspect().head.tracking).toBe('none');
  });

  it('after the model fails while running, a retry counts the no-face timeout from the retry', async () => {
    const t = setup({ noFaceTimeout: 3000 });
    await t.p.startCamera();
    for (let i = 0; i < 80; i++) t.cam.frame({ faceLandmarks: [] }); // 2.6 s without a face
    t.cam.landmarker!.throwNext = true;
    t.cam.frame({ faceLandmarks: [] }); // load-failed: the camera stops
    await t.p.startCamera(); // retry, no stopCamera in between
    for (let i = 0; i < 80; i++) t.cam.frame({ faceLandmarks: [] }); // 2.6 s after the retry
    expect(t.status.map((s) => s.status)).toEqual(['load-failed']);
    for (let i = 0; i < 20; i++) t.cam.frame({ faceLandmarks: [] });
    expect(t.status.map((s) => s.status)).toEqual(['load-failed', 'no-face-timeout']);
  });

  it('"Try the camera again" after a no-face timeout restarts the camera and MediaPipe', async () => {
    const t = setup({ noFaceTimeout: 3000 });
    await t.p.startCamera();
    for (let i = 0; i < 100; i++) t.cam.frame({ faceLandmarks: [] });
    expect(t.status.map((s) => s.status)).toEqual(['no-face-timeout']);
    const first = t.cam.stream!;
    t.dom.box!.all('button')[0].click();
    await flush();
    expect(first.tracks.every((tr) => tr.stopped)).toBe(true);
    expect(t.cam.getUserMediaCalls).toBe(2);
    expect(t.cam.loadCalls).toHaveLength(2);
    for (let i = 0; i < 80; i++) t.cam.frame({ faceLandmarks: [] });
    expect(t.status.map((s) => s.status)).toEqual(['no-face-timeout']); // counted again from the restart
  });

  it('after stop and start, a fresh model is loaded (the old one was closed)', async () => {
    const t = setup();
    await t.p.startCamera();
    t.p.stopCamera();
    await t.p.startCamera();
    expect(t.cam.landmarkers).toHaveLength(2);
    expect(t.cam.landmarkers[0].closed).toBe(true);
    expect(t.cam.landmarkers[1].closed).toBe(false);
  });

  it('a retry restarts the no-face timeout and the start-up centre step', async () => {
    const t = setup({ noFaceTimeout: 3000 });
    await t.p.startCamera();
    for (let i = 0; i < 80; i++) t.cam.frame({ faceLandmarks: [] }); // 2.6 s without a face
    t.p.stopCamera();
    await t.p.startCamera();
    for (let i = 0; i < 80; i++) t.cam.frame({ faceLandmarks: [] }); // another 2.6 s
    expect(t.status.map((s) => s.status)).not.toContain('no-face-timeout');
    for (let i = 0; i < 20; i++) t.cam.frame({ faceLandmarks: [] });
    expect(t.status.map((s) => s.status)).toEqual(['no-face-timeout']);
    expect(t.inspect().calibration).toEqual({ run: 'centre', step: 'centre' });
  });
});

describe('the no-face timeout message (14.4)', () => {
  it('carries its message and the alternatives, and shows in the status box while the camera is on', async () => {
    const t = setup({ noFaceTimeout: 3000 });
    await t.p.startCamera();
    for (let i = 0; i < 100; i++) t.cam.frame({ faceLandmarks: [] });
    expect(t.status).toEqual([
      { status: 'no-face-timeout', message: messages.failure['no-face-timeout'], alternatives: ['scan', 'mouse'] },
    ]);
    expect(t.dom.box!.textContent).toContain(messages.failure['no-face-timeout']);
    // a face found afterwards clears it
    t.cam.frame(faceResult());
    expect(t.dom.box!.textContent).toBe(messages.cameraOn);
  });
});

describe('causeOf', () => {
  it('maps anything without a name to other', () => {
    expect(causeOf(undefined)).toBe('other');
    expect(causeOf('x')).toBe('other');
    expect(causeOf({ name: 'NotAllowedError' })).toBe('denied');
  });
});

describe('createCameraAdapter on its own', () => {
  it('stop() before start does nothing and reports nothing', () => {
    const cam = new FakeCameraEnv();
    const calls: string[] = [];
    const a = createCameraAdapter(cam, '/m/', {
      sample: () => calls.push('sample'),
      started: () => calls.push('started'),
      running: () => calls.push('running'),
      failed: () => calls.push('failed'),
      stopped: () => calls.push('stopped'),
    });
    a.stop();
    expect(calls).toEqual([]);
    expect(a.state).toBe('off');
  });
});
