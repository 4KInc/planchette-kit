// @vitest-environment jsdom
import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountSeanceDom } from '../src/seance-dom';
import { createSound } from '../src/sound';
import { FakeHost, bodyHtml, expectedRect, installDialogStub, stepsOf, stubLayout } from './seance-test-helpers';
import { BOARD_TARGET_IDS } from './board-target-ids';
import type { InputMode } from '@planchette/skeleton';
type Action = 'correct' | 'wrong' | 'stop' | 'next' | 'undo' | 'mode' | 'sound' | 'suggest' | 'cancel' | 'move';
const actionArb = fc.constantFrom<Action>('correct', 'correct', 'correct', 'wrong', 'wrong', 'stop', 'next', 'undo', 'mode', 'sound', 'suggest', 'cancel', 'move');
const modes: InputMode[] = ['head + dwell', 'head + gesture', 'scan', 'gesture scan', 'mouse'];
beforeEach(() => {
  installDialogStub();
  stubLayout();
});
function setup(seed: number) {
  document.body.innerHTML = bodyHtml;
  const host = new FakeHost();
  let t = 1000;
  const dom = mountSeanceDom({ host: host.asHost(), document, storage: undefined, seed, sound: createSound(undefined), saveProfile: vi.fn(), now: () => t });
  const press = (id: string): void => host.select(id, (t += 100));
  return { host, dom, press, tick: () => (t += 100) };
}
describe('Feature: seance, Property 16: Layout stability', () => {
  it('every Board target is registered at the same rectangle whenever it is registered, at least the target size, with the gaps kept', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffff }), fc.array(actionArb, { maxLength: 60 }), (seed, actions) => {
        const { host, dom, press, tick } = setup(seed);
        const check = (): void => {
          for (const { id, rect } of host.history) {
            if (!BOARD_TARGET_IDS.has(id)) continue;
            const el = document.querySelector<HTMLElement>(`[data-planchette-target="${id}"]`)!;
            expect(rect).toEqual(expectedRect(el));
            expect(rect.width).toBeGreaterThanOrEqual(96);
            expect(rect.height).toBeGreaterThanOrEqual(96);
          }
          const ids = [...host.registered.keys()].filter((i) => BOARD_TARGET_IDS.has(i));
          for (let i = 0; i < ids.length; i++)
            for (let j = i + 1; j < ids.length; j++) {
              const a = host.registered.get(ids[i]!)!.rect;
              const b = host.registered.get(ids[j]!)!.rect;
              const gapX = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
              const gapY = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
              expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(16 - 1e-6);
            }
        };
        for (const a of actions) {
          const s = dom.state();
          if (a === 'correct' && s.view === 'play') press(stepsOf(s.messageText)[s.index]!);
          else if (a === 'wrong' && s.view === 'play') press(stepsOf(s.messageText)[s.index] === 'letter-z' ? 'letter-y' : 'letter-z');
          else if (a === 'stop') press('stop');
          else if (a === 'next') press('next-round');
          else if (a === 'undo') press('undo');
          else if (a === 'mode') host.emit('mode-change', { mode: modes[(seed + actions.length) % modes.length] });
          else if (a === 'sound') press('sound-toggle');
          else if (a === 'suggest') press('suggest-apply');
          else if (a === 'cancel') host.emit('cancel', { now: tick() });
          else if (a === 'move') host.emit('pointer-move', { x: (seed % 1300) + 5, y: (seed % 700) + 5 });
          check();
        }
        dom.destroy();
      }),
      { numRuns: 60 },
    );
  });
});
describe('Feature: seance, Property 13: Camera unavailable, scan and mouse still complete a Round', () => {
  it.each([
    ['permission-denied', 'scan'],
    ['permission-denied', 'mouse'],
    ['load-failed', 'scan'],
    ['load-failed', 'mouse'],
    ['no-face-timeout', 'scan'],
    ['no-face-timeout', 'mouse'],
  ] as const)('after %s in %s mode', (status, mode) => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffff }), fc.integer({ min: 1, max: 9 }), (seed, rounds) => {
        const { host, dom, press } = setup(seed);
        host.profile.mode = mode;
        host.emit('tracking-status', { status, message: 'camera unavailable', alternatives: ['scan', 'mouse'] });
        for (let r = 0; r < rounds; r++) {
          expect(() => {
            for (let guard = 0; guard < 20 && dom.state().view === 'play'; guard++) {
              const s = dom.state();
              press(stepsOf(s.messageText)[s.index]!);
            }
          }).not.toThrow();
          expect(dom.state()).toMatchObject({ view: 'summary', status: 'complete' });
          press('next-round');
        }
        expect(host.startCamera).not.toHaveBeenCalled();
        dom.destroy();
      }),
      { numRuns: 25 },
    );
  });
});
