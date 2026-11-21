/**
 * tracking-indicator.ts — the one tracking indicator (Task 16.3; Req 2 AC 2, AC 12;
 * Req 8 AC 2; accessibility.md Feedback). A `role="status"` box that shows:
 *  - "Camera on" while the camera runs;
 *  - when the face is lost or only just visible, a plain message (tracking status is
 *    always visible);
 *  - after a camera failure, the plain-language message and three buttons: try the camera
 *    again, switch scanning, the mouse.
 * The text comes from messages.ts. The instance drives it from its camera state and its
 * `tracking-status` events (`trackingIndicator` option). Nothing is added to the page on
 * import, only when there is something to show.
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

export type IndicatorState =
  | { kind: 'hidden' }
  | { kind: 'starting' }
  | { kind: 'on' }
  | { kind: 'lost' }
  | { kind: 'low-confidence' }
  | { kind: 'failed'; status: 'permission-denied' | 'load-failed' | 'no-face-timeout'; cause?: CameraFailureCause };

export interface IndicatorActions {
  retry(): void;
  setMode(mode: InputMode): void;
}

export interface TrackingIndicator {
  show(state: IndicatorState): void;
  /** What is shown now: 'hidden' or the state's kind. */
  readonly kind: IndicatorState['kind'];
  /** The text now shown ('' when hidden). */
  readonly text: string;
  destroy(): void;
}

/** The plain-language message for a failure. */
export function failureMessage(status: 'permission-denied' | 'load-failed' | 'no-face-timeout', cause?: CameraFailureCause): string {
  if (status === 'permission-denied') return messages.failure[cause ?? 'other'];
  return messages.failure[status];
}

// Placement only when the box is ours (in the app's element the app styles it). White on
// near-black is 18.9:1; the 3 px white border keeps it visible on any page (3:1 for UI parts).
const BOX_STYLE =
  'position:fixed;left:12px;bottom:12px;z-index:2147483647;max-width:32em;margin:0;padding:12px 16px;' +
  'background:#111;color:#fff;border:3px solid #fff;border-radius:8px;font:18px/1.4 system-ui,sans-serif';
const BUTTON_STYLE =
  'margin:8px 8px 0 0;padding:10px 14px;min-height:48px;font:inherit;color:#111;background:#fff;' +
  'border:3px solid #fff;border-radius:6px;cursor:pointer';

export function createTrackingIndicator(
  dom: DomLike,
  parent: { appendChild(child: ElementLike): unknown } | null,
  actions: IndicatorActions,
): TrackingIndicator {
  let box: ElementLike | null = null;
  let text = '';
  let kind: IndicatorState['kind'] = 'hidden';

  function ensureBox(): ElementLike {
    if (box !== null) return box;
    const b = dom.createElement('div');
    b.setAttribute('role', 'status');
    b.setAttribute('aria-live', 'polite');
    b.setAttribute('data-planchette', 'tracking-indicator');
    if (parent === null && b.style !== undefined) b.style.cssText = BOX_STYLE;
    (parent ?? dom.body).appendChild(b);
    box = b;
    return b;
  }

  function button(label: string, onClick: () => void): ElementLike {
    const el = dom.createElement('button');
    el.setAttribute('type', 'button');
    if (parent === null && el.style !== undefined) el.style.cssText = BUTTON_STYLE;
    el.textContent = label;
    el.addEventListener('click', onClick);
    return el;
  }

  function line(t: string): ElementLike {
    const p = dom.createElement('p');
    // Not setAttribute('style', ...): a page with a strict Content-Security-Policy (no
    // 'unsafe-inline' for styles) blocks that, while setting the style through the DOM is allowed.
    if (p.style !== undefined) p.style.cssText = 'margin:0';
    p.textContent = t;
    return p;
  }

  return {
    get kind() {
      return kind;
    },
    get text() {
      return text;
    },
    show(state: IndicatorState): void {
      if (state.kind === 'hidden') {
        box?.remove();
        box = null;
        text = '';
        kind = 'hidden';
        return;
      }
      // The same message again: leave the box alone, so a screen reader does not repeat it.
      const next =
        state.kind === 'failed'
          ? `${failureMessage(state.status, state.cause)} ${messages.alternatives}`
          : state.kind === 'starting'
            ? messages.cameraStarting
            : state.kind === 'on'
              ? messages.cameraOn
              : state.kind === 'lost'
                ? messages.lost
                : messages.lowConfidence;
      if (box !== null && next === text && kind === state.kind) return;
      const b = ensureBox();
      b.textContent = '';
      text = next;
      kind = state.kind;
      b.setAttribute('data-state', state.kind);
      b.appendChild(line(next));
      if (state.kind === 'failed') {
        b.appendChild(button(messages.tryAgain, () => actions.retry()));
        b.appendChild(button(messages.useScanning, () => actions.setMode('scan')));
        b.appendChild(button(messages.useMouse, () => actions.setMode('mouse')));
      }
    },
    destroy(): void {
      box?.remove();
      box = null;
      text = '';
      kind = 'hidden';
    },
  };
}
