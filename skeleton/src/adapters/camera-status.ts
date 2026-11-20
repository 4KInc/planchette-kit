/**
 * camera-status.ts — the "camera on" indicator and the camera failure messages
 * (Req 2 AC 2, AC 12; Req 8 AC 2). A small status box, shown only while the camera is in
 * use or after a failure. Plain-language text from messages.ts; no error codes.
 *
 * After a failure it offers what Req 8 asks for: try the camera again, switch scanning,
 * or the mouse, as real buttons (keyboard and switch users reach them like any button).
 * The styled helper of Task 16 can replace it (`cameraStatus: false`).
 */
import type { CameraFailureCause, InputMode } from '../api-types.js';
import { messages } from '../messages.js';

/** The few DOM features the box uses; the real `document` fits, and tests pass a fake. */
export interface ElementLike {
  textContent: string | null;
  setAttribute(name: string, value: string): void;
  appendChild(child: ElementLike): unknown;
  addEventListener(type: 'click', listener: () => void): void;
  remove(): void;
  style?: { cssText: string };
}
export interface DomLike {
  createElement(tag: string): ElementLike;
  readonly body: { appendChild(child: ElementLike): unknown };
}

export type CameraStatusState =
  | { kind: 'hidden' }
  | { kind: 'starting' }
  | { kind: 'on' }
  | { kind: 'failed'; status: 'permission-denied' | 'load-failed' | 'no-face-timeout'; cause?: CameraFailureCause };

export interface CameraStatusActions {
  retry(): void;
  setMode(mode: InputMode): void;
}

export interface CameraStatusView {
  show(state: CameraStatusState): void;
  /** The text now shown ('' when hidden). For tests and screen-reader checks. */
  readonly text: string;
  destroy(): void;
}

/** The plain-language message for a failure. */
export function failureMessage(status: 'permission-denied' | 'load-failed' | 'no-face-timeout', cause?: CameraFailureCause): string {
  if (status === 'permission-denied') return messages.failure[cause ?? 'other'];
  return messages.failure[status];
}

const BOX_STYLE =
  'position:fixed;left:12px;bottom:12px;z-index:2147483647;max-width:32em;padding:12px 16px;' +
  'background:#111;color:#fff;border:3px solid #fff;border-radius:8px;font:16px/1.4 system-ui,sans-serif';

export function createCameraStatusView(dom: DomLike, parent: { appendChild(child: ElementLike): unknown } | null, actions: CameraStatusActions): CameraStatusView {
  let box: ElementLike | null = null;
  let text = '';

  function ensureBox(): ElementLike {
    if (box !== null) return box;
    const b = dom.createElement('div');
    b.setAttribute('role', 'status');
    b.setAttribute('aria-live', 'polite');
    b.setAttribute('data-planchette', 'camera-status');
    if (parent === null && b.style !== undefined) b.style.cssText = BOX_STYLE; // own box: place it; in the app's element: app styles it
    (parent ?? dom.body).appendChild(b);
    box = b;
    return b;
  }

  function button(label: string, onClick: () => void): ElementLike {
    const el = dom.createElement('button');
    el.setAttribute('type', 'button');
    el.textContent = label;
    el.addEventListener('click', onClick);
    return el;
  }

  return {
    get text() {
      return text;
    },
    show(state: CameraStatusState): void {
      if (state.kind === 'hidden') {
        box?.remove();
        box = null;
        text = '';
        return;
      }
      const b = ensureBox();
      b.textContent = '';
      const p = dom.createElement('p');
      if (state.kind === 'failed') {
        text = `${failureMessage(state.status, state.cause)} ${messages.alternatives}`;
        p.textContent = text;
        b.appendChild(p);
        b.appendChild(button(messages.tryAgain, () => actions.retry()));
        b.appendChild(button(messages.useScanning, () => actions.setMode('scan')));
        b.appendChild(button(messages.useMouse, () => actions.setMode('mouse')));
      } else {
        text = state.kind === 'starting' ? messages.cameraStarting : messages.cameraOn;
        p.textContent = text;
        b.appendChild(p);
      }
    },
    destroy(): void {
      box?.remove();
      box = null;
      text = '';
    },
  };
}
