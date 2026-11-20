/**
 * Task 15.2 — low confidence (design §4 "Low confidence"): tracking continues, and
 * `tracking-status: low-confidence` is emitted once per episode, not on every frame.
 */
import { describe, expect, it } from 'vitest';
import type { TimestampedSample } from '../src/api-types';
import { CONFIDENT_FACE_WIDTH, confidenceOf, facesFromResult } from '../src/adapters/face-result';
import { LOW_CONFIDENCE_ENTER, LOW_CONFIDENCE_LEAVE, LOW_CONFIDENCE_RECOVER_MS } from '../src/engine/head-pointer';
import { messages } from '../src/messages';
import { createPlanchetteInternal } from '../src/planchette';
import { FakeCameraEnv, FakeDom, faceResult } from './fakes';
import { rotationFor } from './pointer-path';

function setup(profile: Record<string, unknown> = {}) {
  const dom = new FakeDom();
  const { planchette: p, inspect } = createPlanchetteInternal({ screen: { width: 1000, height: 800 }, profile }, { dom });
  const statuses: string[] = [];
  const messagesSeen: Array<string | undefined> = [];
  const moves: Array<{ x: number; y: number }> = [];
  const selects: string[] = [];
  p.addEventListener('tracking-status', (e) => {
    statuses.push(e.detail.status);
    messagesSeen.push(e.detail.message);
  });
  p.addEventListener('pointer-move', (e) => moves.push(e.detail));
  p.addEventListener('select', (e) => selects.push(e.detail.targetId));
  let t = 0;
  /** `n` camera frames 33 ms apart, pointing at (x, y), with the given confidence. */
  const frames = (n: number, confidence: number | ((i: number) => number), x = 500, y = 400): void => {
    const samples: TimestampedSample[] = [];
    for (let i = 0; i < n; i++) {
      samples.push({
        now: (t += 33),
        source: 'camera',
        faces: [{ bbox: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.3 }, rotation: rotationFor(x, y), confidence: typeof confidence === 'function' ? confidence(i) : confidence }],
      });
    }
    p.feedSamples(samples);
  };
  const lost = (n: number): void => {
    const samples: TimestampedSample[] = [];
    for (let i = 0; i < n; i++) samples.push({ now: (t += 33), source: 'camera', faces: [] });
    p.feedSamples(samples);
  };
  return { p, inspect, dom, statuses, messagesSeen, moves, selects, frames, lost };
}

describe('low confidence (15.2)', () => {
  it('is emitted once when the confidence drops, with its message, and not again while it stays low', () => {
    const t = setup();
    t.frames(10, 1);
    t.frames(100, 0.3); // 3.3 s of low confidence
    expect(t.statuses).toEqual(['found', 'low-confidence']);
    expect(t.messagesSeen[1]).toBe(messages.lowConfidence);
  });

  it('tracking continues: the pointer still follows the head and dwell still selects', () => {
    const t = setup({ dwellTime: 1000 });
    t.p.registerTarget('a', { x: 600, y: 0, width: 400, height: 800 });
    t.frames(60, 1, 300, 400); // centre step and rest, on the left
    t.frames(5, 0.2, 300, 400);
    const before = t.moves.length;
    t.frames(60, 0.2, 800, 400); // the head moves right, still low confidence
    expect(t.moves.length).toBeGreaterThan(before);
    expect(t.moves.at(-1)!.x).toBeGreaterThan(700);
    expect(t.selects).toEqual(['a']);
    expect(t.statuses.filter((s) => s === 'low-confidence')).toHaveLength(1);
  });

  it('a confidence that wavers around the threshold every frame is still one episode', () => {
    const t = setup();
    t.frames(5, 1);
    t.frames(300, (i) => (i % 2 === 0 ? 0.3 : 0.9)); // 10 s, flipping on every frame
    expect(t.statuses).toEqual(['found', 'low-confidence']);
  });

  it(`the episode ends, with found, once the confidence has stayed at ${LOW_CONFIDENCE_LEAVE} or more for ${LOW_CONFIDENCE_RECOVER_MS} ms`, () => {
    const t = setup();
    t.frames(5, 1);
    t.frames(10, 0.3);
    t.frames(30, 0.9); // the 30th good frame is 957 ms after the first
    expect(t.statuses).toEqual(['found', 'low-confidence']);
    t.frames(2, 0.9); // 990 ms, then 1023 ms: at or past 1000 ms
    expect(t.statuses).toEqual(['found', 'low-confidence', 'found']);
  });

  it('a confidence between the two thresholds neither starts nor ends an episode', () => {
    const t = setup();
    t.frames(5, 1);
    t.frames(100, 0.6);
    expect(t.statuses).toEqual(['found']);
    t.frames(5, 0.3);
    t.frames(100, 0.6);
    expect(t.statuses).toEqual(['found', 'low-confidence']);
    expect(LOW_CONFIDENCE_ENTER).toBe(0.5);
  });

  it('a second drop after recovery is a second episode', () => {
    const t = setup();
    t.frames(5, 1);
    t.frames(5, 0.3);
    t.frames(40, 1);
    t.frames(5, 0.3);
    expect(t.statuses).toEqual(['found', 'low-confidence', 'found', 'low-confidence']);
  });

  it('losing the face ends the episode; a low face found again starts a new one', () => {
    const t = setup();
    t.frames(5, 1);
    t.frames(5, 0.3);
    t.lost(3);
    t.frames(5, 0.3);
    expect(t.statuses).toEqual(['found', 'low-confidence', 'lost', 'found', 'low-confidence']);
  });

  it('a face with no confidence counts as fully confident', () => {
    const t = setup();
    t.p.feedSamples([{ now: 1, source: 'camera', faces: [{ bbox: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.3 }, rotation: { yaw: 0, pitch: 0 } }] }]);
    t.p.feedSamples([{ now: 2, source: 'camera', faces: [{ bbox: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.3 }, rotation: { yaw: 0, pitch: 0 }, confidence: NaN }] }]);
    expect(t.statuses).toEqual(['found']);
  });

  it('the tracking indicator shows the low-confidence message, and goes back when it ends', () => {
    const t = setup();
    t.frames(5, 1);
    t.frames(5, 0.3);
    expect(t.dom.box!.textContent).toBe(messages.lowConfidence);
    t.frames(40, 1);
    expect(t.dom.box).toBeUndefined(); // no camera running: nothing else to show
  });
});

describe('confidence from a MediaPipe result', () => {
  it('a face fully in the picture and large enough has confidence 1', () => {
    expect(facesFromResult(faceResult({ size: 0.3 }))[0].confidence).toBe(1);
  });

  it('a face half out of the picture has about half', () => {
    const points = [
      { x: 0.9, y: 0.5 },
      { x: 0.95, y: 0.5 },
      { x: 1.05, y: 0.5 },
      { x: 1.1, y: 0.5 },
    ];
    expect(confidenceOf(points, 0.3)).toBe(0.5);
  });

  it('a small (far) face scales down with its width', () => {
    expect(confidenceOf([{ x: 0.5, y: 0.5 }], CONFIDENT_FACE_WIDTH / 4)).toBe(0.25);
    expect(confidenceOf([], 0.3)).toBe(0);
  });

  it('through the camera adapter: a far face gives low-confidence once, then tracking goes on', async () => {
    const cam = new FakeCameraEnv();
    const { planchette: p } = createPlanchetteInternal({ screen: { width: 1000, height: 800 } }, { camera: cam, dom: new FakeDom() });
    const statuses: string[] = [];
    p.addEventListener('tracking-status', (e) => statuses.push(e.detail.status));
    await p.startCamera();
    for (let i = 0; i < 5; i++) cam.frame(faceResult({ size: 0.3 }));
    for (let i = 0; i < 60; i++) cam.frame(faceResult({ size: 0.02 }));
    expect(statuses).toEqual(['found', 'low-confidence']);
    expect(cam.landmarker!.calls.length).toBe(65);
  });
});
