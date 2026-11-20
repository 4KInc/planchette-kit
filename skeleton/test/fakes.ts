/**
 * Fake browser pieces for the adapter tests. Nothing here opens a real camera, loads
 * MediaPipe or needs a DOM: the tests run in Node.
 */
import type { CameraEnvironment, LandmarkerLike, StreamLike, TrackLike, VideoLike } from '../src/adapters/camera-adapter';
import type { FaceResultLike } from '../src/adapters/face-result';
import type { DomLike, ElementLike } from '../src/adapters/camera-status';
import type { GamepadLike, InputEnvironment } from '../src/adapters/input-env';

// ---------------------------------------------------------------------------
// Animation frames
// ---------------------------------------------------------------------------

/** requestAnimationFrame you step by hand. `step(now)` runs the callbacks queued so far. */
export class FakeFrames {
  private next = 1;
  private queue = new Map<number, (now: number) => void>();
  request = (cb: (now: number) => void): number => {
    const id = this.next++;
    this.queue.set(id, cb);
    return id;
  };
  cancel = (id: number): void => {
    this.queue.delete(id);
  };
  get pending(): number {
    return this.queue.size;
  }
  step(now: number): void {
    const due = [...this.queue.values()];
    this.queue.clear();
    for (const cb of due) cb(now);
  }
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

export class FakeTrack implements TrackLike {
  stopped = false;
  stop(): void {
    this.stopped = true;
  }
}

export class FakeStream implements StreamLike {
  readonly tracks = [new FakeTrack()];
  getTracks(): ReadonlyArray<TrackLike> {
    return this.tracks;
  }
}

export class FakeVideo implements VideoLike {
  srcObject: unknown = null;
  muted = false;
  playsInline = false;
  readyState = 4;
  currentTime = 0;
  playFails = false;
  play(): Promise<void> {
    return this.playFails ? Promise.reject(Object.assign(new Error('play'), { name: 'NotAllowedError' })) : Promise.resolve();
  }
}

export class FakeLandmarker implements LandmarkerLike {
  closed = false;
  calls: number[] = [];
  /** What the next detection returns. */
  result: FaceResultLike = { faceLandmarks: [] };
  throwNext = false;
  detectForVideo(_video: VideoLike, timestamp: number): FaceResultLike {
    if (this.throwNext) throw new Error('GPU context lost');
    this.calls.push(timestamp);
    return this.result;
  }
  close(): void {
    this.closed = true;
  }
}

/** A face result as MediaPipe gives it, for one face at (cx, cy) with a head rotation in degrees. */
export function faceResult(opts: { cx?: number; cy?: number; size?: number; yaw?: number; pitch?: number; jawOpen?: number; browInnerUp?: number } = {}): FaceResultLike {
  const { cx = 0.5, cy = 0.5, size = 0.3, yaw = 0, pitch = 0, jawOpen = 0, browInnerUp = 0 } = opts;
  const h = size / 2;
  // Forward axis for the given yaw and pitch (see rotationFromMatrix): f = (−sin y cos p, sin p, cos y cos p).
  const y = (yaw * Math.PI) / 180;
  const p = (pitch * Math.PI) / 180;
  const data = new Array<number>(16).fill(0);
  data[0] = 1;
  data[5] = 1;
  data[15] = 1;
  data[8] = -Math.sin(y) * Math.cos(p);
  data[9] = Math.sin(p);
  data[10] = Math.cos(y) * Math.cos(p);
  return {
    faceLandmarks: [
      [
        { x: cx - h, y: cy - h },
        { x: cx + h, y: cy + h },
        { x: cx, y: cy },
      ],
    ],
    faceBlendshapes: [
      {
        categories: [
          { categoryName: 'jawOpen', score: jawOpen },
          { categoryName: 'browInnerUp', score: browInnerUp },
        ],
      },
    ],
    facialTransformationMatrixes: [{ rows: 4, columns: 4, data }],
  };
}

type Settle<T> = { resolve: (v: T) => void; reject: (e: unknown) => void };

/**
 * A fake camera environment. By default getUserMedia and the model load succeed at once;
 * set `denyWith` / `failLoads` to make them fail, or `manual` to settle them by hand.
 */
export class FakeCameraEnv implements CameraEnvironment {
  readonly frames = new FakeFrames();
  readonly streams: FakeStream[] = [];
  readonly landmarkers: FakeLandmarker[] = [];
  readonly videos: FakeVideo[] = [];
  loadCalls: string[] = [];
  getUserMediaCalls = 0;
  /** A getUserMedia rejection name, e.g. 'NotAllowedError'. */
  denyWith: string | null = null;
  /** How many of the next model loads fail. */
  failLoads = 0;
  manual = false;
  pendingCamera: Array<Settle<StreamLike>> = [];
  pendingModel: Array<Settle<LandmarkerLike>> = [];
  clock = 1000;
  playFails = false;

  get stream(): FakeStream | undefined {
    return this.streams.at(-1);
  }
  get landmarker(): FakeLandmarker | undefined {
    return this.landmarkers.at(-1);
  }
  get video(): FakeVideo | undefined {
    return this.videos.at(-1);
  }
  /** True while any camera track handed out is still running (the camera light is on). */
  get lightOn(): boolean {
    return this.streams.some((s) => s.tracks.some((t) => !t.stopped));
  }

  getUserMedia(): Promise<StreamLike> {
    this.getUserMediaCalls++;
    if (this.manual) return new Promise((resolve, reject) => this.pendingCamera.push({ resolve, reject }));
    if (this.denyWith !== null) return Promise.reject(Object.assign(new Error('denied'), { name: this.denyWith }));
    const s = new FakeStream();
    this.streams.push(s);
    return Promise.resolve(s);
  }
  /** For `manual`: grant the oldest pending camera request. */
  grantCamera(): FakeStream {
    const s = new FakeStream();
    this.streams.push(s);
    this.pendingCamera.shift()!.resolve(s);
    return s;
  }
  loadLandmarker(assetsUrl: string): Promise<LandmarkerLike> {
    this.loadCalls.push(assetsUrl);
    if (this.manual) return new Promise((resolve, reject) => this.pendingModel.push({ resolve, reject }));
    if (this.failLoads > 0) {
      this.failLoads--;
      return Promise.reject(new Error('Failed to fetch model'));
    }
    const l = new FakeLandmarker();
    this.landmarkers.push(l);
    return Promise.resolve(l);
  }
  /** For `manual`: finish the oldest pending model load. */
  finishLoad(): FakeLandmarker {
    const l = new FakeLandmarker();
    this.landmarkers.push(l);
    this.pendingModel.shift()!.resolve(l);
    return l;
  }
  createVideo(): VideoLike {
    const v = new FakeVideo();
    v.playFails = this.playFails;
    this.videos.push(v);
    return v;
  }
  requestFrame(cb: () => void): number {
    return this.frames.request(() => cb());
  }
  cancelFrame(id: number): void {
    this.frames.cancel(id);
  }
  now(): number {
    return this.clock;
  }
  /** One display frame with a new video frame: advance the clock 33 ms and run the frame loop. */
  frame(result?: FaceResultLike): void {
    if (result !== undefined && this.landmarker !== undefined) this.landmarker.result = result;
    this.clock += 33;
    if (this.video !== undefined) this.video.currentTime += 1 / 30;
    this.frames.step(this.clock);
  }
}

/** Let pending promise callbacks run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

export class FakeElement implements ElementLike {
  readonly children: FakeElement[] = [];
  readonly attributes: Record<string, string> = {};
  readonly clicks: Array<() => void> = [];
  parent: FakeElement | null = null;
  style = { cssText: '' };
  private ownText: string | null = '';
  constructor(readonly tag: string) {}
  get textContent(): string | null {
    return this.children.length > 0 ? this.children.map((c) => c.textContent).join(' ') : this.ownText;
  }
  set textContent(v: string | null) {
    for (const c of this.children) c.parent = null;
    this.children.length = 0;
    this.ownText = v;
  }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  appendChild(child: ElementLike): unknown {
    const c = child as FakeElement;
    c.parent = this;
    this.children.push(c);
    return c;
  }
  addEventListener(_type: 'click', listener: () => void): void {
    this.clicks.push(listener);
  }
  remove(): void {
    if (this.parent === null) return;
    const i = this.parent.children.indexOf(this);
    if (i >= 0) this.parent.children.splice(i, 1);
    this.parent = null;
  }
  click(): void {
    for (const l of this.clicks) l();
  }
  /** All descendants with this tag. */
  all(tag: string): FakeElement[] {
    const out: FakeElement[] = [];
    for (const c of this.children) {
      if (c.tag === tag) out.push(c);
      out.push(...c.all(tag));
    }
    return out;
  }
}

export class FakeDom implements DomLike {
  readonly body = new FakeElement('body');
  createElement(tag: string): ElementLike {
    return new FakeElement(tag);
  }
  /** The status box, if shown. */
  get box(): FakeElement | undefined {
    return this.body.children.find((c) => c.attributes['data-planchette'] === 'camera-status');
  }
}

// ---------------------------------------------------------------------------
// Keyboard, mouse and gamepad
// ---------------------------------------------------------------------------

export class FakeInputEnv implements InputEnvironment {
  readonly frames = new FakeFrames();
  readonly listeners = new Map<string, Set<(event: never) => void>>();
  gamepads: Array<GamepadLike | null> = [];
  addEventListener(type: string, listener: (event: never) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: (event: never) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  requestFrame(cb: (now: number) => void): number {
    return this.frames.request(cb);
  }
  cancelFrame(id: number): void {
    this.frames.cancel(id);
  }
  getGamepads(): ReadonlyArray<GamepadLike | null> {
    return this.gamepads;
  }
  dispatch(type: string, event: object = {}): { defaultPrevented: boolean } {
    const e = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...event };
    for (const l of this.listeners.get(type) ?? []) (l as (e: object) => void)(e);
    return e;
  }
  get listenerCount(): number {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
  pad(pressed: number[]): GamepadLike {
    const buttons = Array.from({ length: 16 }, (_, i) => ({ pressed: pressed.includes(i) }));
    return { buttons };
  }
}
