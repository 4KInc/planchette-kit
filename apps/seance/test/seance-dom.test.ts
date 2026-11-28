// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOARD_KEY } from '../src/board-link';
import { mountSeanceDom, type SeanceDom } from '../src/seance-dom';
import { createSound } from '../src/sound';
import { FakeHost, bodyHtml, installDialogStub, stepsOf, stubLayout } from './seance-test-helpers';
import { MemoryStorage } from './memory-storage';
let host: FakeHost;
let dom: SeanceDom;
let storage: MemoryStorage;
let t = 1000;
const saveProfile = vi.fn();
const live = (): string => document.getElementById('live')!.textContent ?? '';
const $ = (id: string): HTMLElement => document.getElementById(id)!;
const tick = (): number => (t += 100);
const press = (id: string): void => host.select(id, tick());
function mount(seed = 7): void {
  host = new FakeHost();
  dom = mountSeanceDom({ host: host.asHost(), document, storage, seed, sound: createSound(undefined), saveProfile, now: () => t });
}
const messageSteps = (): string[] => stepsOf(dom.state().messageText);
const finishRound = (): void => {
  for (const id of messageSteps().slice(dom.state().index)) press(id);
};
const wrong = (): string => {
  const next = messageSteps()[dom.state().index]!;
  return next === 'letter-z' ? 'letter-y' : 'letter-z';
};
beforeEach(() => {
  installDialogStub();
  stubLayout();
  document.body.innerHTML = bodyHtml;
  storage = new MemoryStorage();
  t = 1000;
  saveProfile.mockClear();
  mount();
});
afterEach(() => {
  dom.destroy();
  document.body.innerHTML = '';
});
describe('Round loop', () => {
  it('starts on a 3-letter word with the board registered and the next target marked', () => {
    expect(dom.state()).toMatchObject({ view: 'play', roundNumber: 1, status: 'playing', index: 0 });
    expect(dom.state().messageText).toHaveLength(3);
    for (const id of ['letter-a', 'letter-z', 'yes', 'no', 'goodbye', 'stop', 'undo', 'cancel', 'sound-toggle', 'rest-area']) {
      expect(host.registered.has(id), id).toBe(true);
    }
    expect(host.registered.get('cancel')!.options).toEqual({ role: 'cancel' });
    expect(host.registered.get('undo')!.options).toEqual({ role: 'undo' });
    expect(host.registered.get('rest-area')!.options).toEqual({ role: 'rest-area' });
    expect(host.registered.has('suggest-apply')).toBe(false);
    const marked = document.querySelectorAll('[data-next="true"]');
    expect(marked).toHaveLength(1);
    expect((marked[0] as HTMLElement).dataset.planchetteTarget).toBe(messageSteps()[0]);
    // the spirit's planchette glides to that target's corner; it is one element, aria-hidden
    const glide = $('glide');
    expect(glide.hidden).toBe(false);
    expect(glide.dataset.target).toBe(messageSteps()[0]);
    expect(glide.getAttribute('aria-hidden')).toBe('true');
    expect(glide.querySelector('svg')).not.toBeNull();
  });
  it('a full Round reaches the Summary, and the board targets are unregistered', () => {
    finishRound();
    expect(dom.state()).toMatchObject({ view: 'summary', status: 'complete' });
    expect(host.registered.has('letter-a')).toBe(false);
    expect(host.registered.has('goodbye')).toBe(false);
    expect(host.registered.has('next-round')).toBe(true);
    expect(host.registered.has('stop')).toBe(true);
    expect($('summary-letters').textContent).toBe('3 of 3');
    expect($('summary-accidental').textContent).toBe('0');
    expect($('glide').hidden).toBe(true);
    expect($('spelled-letters').textContent).toMatch(/^Round complete: /);
    expect($('board-section').hidden).toBe(true);
  });
  it('a Miss changes the count, keeps the Step, and says nothing that judges', () => {
    press(wrong());
    expect(dom.state()).toMatchObject({ misses: 1, index: 0, view: 'play' });
    expect(live()).not.toMatch(/wrong|fail|bad|lose|lost|mistake|error|try harder/i);
  });
  it('Stop ends the Round as stopped, with no Carry offered', () => {
    press(messageSteps()[0]!);
    press('stop');
    expect(dom.state()).toMatchObject({ view: 'summary', status: 'stopped', index: 1 });
    expect($('spelled-letters').textContent).toBe('You stopped this round');
    expect($('carry-dwell').hidden).toBe(true);
  });
  it('Undo takes back one letter in play', () => {
    press(messageSteps()[0]!);
    expect(dom.state().index).toBe(1);
    press('undo');
    expect(dom.state()).toMatchObject({ index: 0, takenBack: 1 });
  });
  it('another round starts a new Message, with the board back', () => {
    const first = dom.state().messageText;
    finishRound();
    press('next-round');
    expect(dom.state()).toMatchObject({ view: 'play', roundNumber: 2, status: 'playing', index: 0 });
    expect(dom.state().messageText).not.toBe(first);
    expect(host.registered.has('letter-a')).toBe(true);
    expect(host.registered.has('next-round')).toBe(false);
  });
  it('ignores a select stamped before the view changed', () => {
    finishRound();
    // the Summary opened at the clock's current value (t); anything stamped at or before it belongs to the old view
    host.select('next-round', t);
    expect(dom.state().view).toBe('summary');
    press('next-round');
    expect(dom.state().view).toBe('play');
  });
  it('ignores selects when blocked (Settings open)', () => {
    dom.destroy();
    document.body.innerHTML = bodyHtml;
    host = new FakeHost();
    dom = mountSeanceDom({ host: host.asHost(), document, storage, seed: 7, sound: createSound(undefined), saveProfile, now: () => t, isBlocked: () => true });
    press(messageSteps()[0]!);
    expect(dom.state().index).toBe(0);
  });
});
describe('adaptation', () => {
  beforeEach(() => {
    host.profile.mode = 'head + dwell'; // a dwell Suggestion only makes sense where dwell applies
  });
  it('two Misses give level 1 and a callout; four give level 2 and a Suggestion', () => {
    press(wrong());
    press(wrong());
    expect(document.querySelector('.page')!.getAttribute('data-support')).toBe('1');
    expect($('spelled-callout').textContent).toMatch(/^Next: /);
    expect(host.registered.has('suggest-apply')).toBe(false);
    press(wrong());
    press(wrong());
    expect(document.querySelector('.page')!.getAttribute('data-support')).toBe('2');
    expect(dom.state().suggestion).toBe(2400);
    expect(host.registered.has('suggest-apply')).toBe(true);
    expect(host.registered.has('suggest-dismiss')).toBe(true);
    expect($('suggest-apply').textContent).toBe('Hold longer: 2400 ms');
    expect(host.setProfile).not.toHaveBeenCalled();
  });
  it('"Hold longer" calls setProfile once and saves; "Not now" never does', () => {
    for (let i = 0; i < 4; i++) press(wrong());
    press('suggest-apply');
    expect(host.setProfile).toHaveBeenCalledTimes(1);
    expect(host.setProfile).toHaveBeenCalledWith({ dwellTime: 2400 });
    expect(saveProfile).toHaveBeenCalledTimes(1);
    expect(host.registered.has('suggest-apply')).toBe(false);
    dom.destroy();
    document.body.innerHTML = bodyHtml;
    mount();
    for (let i = 0; i < 4; i++) press(wrong());
    press('suggest-dismiss');
    expect(host.setProfile).not.toHaveBeenCalled();
    expect(dom.state().suggestion).toBeNull();
  });
  it('Cancel closes an open Suggestion and changes nothing else', () => {
    for (let i = 0; i < 4; i++) press(wrong());
    host.emit('cancel', { now: tick() });
    expect(dom.state().suggestion).toBeNull();
    expect(host.setProfile).not.toHaveBeenCalled();
    expect(host.registered.has('suggest-apply')).toBe(false);
  });
  it('a Hit never moves a target: the board rectangles are the same at every level', () => {
    const before = new Map([...host.registered].filter(([id]) => id.startsWith('letter-')).map(([id, v]) => [id, v.rect]));
    for (let i = 0; i < 4; i++) press(wrong());
    for (const [id, rect] of before) expect(host.registered.get(id)!.rect).toEqual(rect);
  });
});
describe('Carry to the Board', () => {
  beforeEach(() => {
    dom.destroy();
    document.body.innerHTML = bodyHtml;
    host = new FakeHost();
    host.profile.mode = 'head + dwell';
    dom = mountSeanceDom({ host: host.asHost(), document, storage, seed: 3, sound: createSound(undefined), saveProfile, now: () => t });
  });
  it('writes the Board key only when carry-dwell is selected, and Undo puts it back', () => {
    storage.setItem(BOARD_KEY, JSON.stringify({ profile: { mode: 'scan' }, board: { predictionSlotCount: 4, voiceURI: '', speechRate: 1, filterOffensiveWords: true }, version: 1 }));
    const before = storage.data.get(BOARD_KEY)!;
    storage.writes = 0;
    finishRound();
    expect(storage.writes).toBe(0);
    expect($('carry-dwell').hidden).toBe(false);
    expect($('carry-dwell').textContent).toBe('Use 2100 ms on the Board');
    expect($('summary-board').textContent).toContain('The Board has saved settings with no dwell time yet.');
    expect(host.registered.has('carry-dwell')).toBe(true);
    press('carry-dwell');
    expect(storage.writes).toBe(1);
    expect(JSON.parse(storage.data.get(BOARD_KEY)!).profile).toEqual({ mode: 'scan', dwellTime: 2100 });
    expect($('summary-board').textContent).toBe('The Board now uses 2100 ms.');
    expect(host.registered.has('carry-dwell')).toBe(false);
    press('undo');
    expect(storage.data.get(BOARD_KEY)).toBe(before);
    expect($('carry-dwell').hidden).toBe(false);
  });
  it('offers nothing in another mode, for a stopped Round, or when the Board record is unreadable', () => {
    press(messageSteps()[0]!);
    press('stop');
    expect($('carry-dwell').hidden).toBe(true);
    press('next-round');
    host.profile.mode = 'mouse';
    finishRound();
    expect($('carry-dwell').hidden).toBe(true);
    expect(storage.writes).toBe(0);
    press('next-round');
    host.profile.mode = 'head + dwell';
    storage.setItem(BOARD_KEY, '{garbage');
    storage.writes = 0;
    finishRound();
    expect($('carry-dwell').hidden).toBe(true);
    expect($('summary-board').textContent).toContain('could not be read');
    expect(storage.writes).toBe(0);
  });
  it('says so when the Board already uses the value', () => {
    storage.setItem(BOARD_KEY, JSON.stringify({ profile: { dwellTime: 2100 }, board: { predictionSlotCount: 4, voiceURI: '', speechRate: 1, filterOffensiveWords: true }, version: 1 }));
    finishRound();
    expect($('carry-dwell').hidden).toBe(true);
    expect($('summary-board').textContent).toBe('The Board already uses 2100 ms.');
  });
  it('a mode change during the Round removes the offer', () => {
    host.emit('mode-change', { mode: 'scan' });
    host.profile.mode = 'head + dwell';
    finishRound();
    expect($('carry-dwell').hidden).toBe(true);
  });
});
describe('arrival guard', () => {
  it('holds a target under the pointer when the view changes, and releases it when the pointer leaves', () => {
    // the pointer rests where "Another round" will appear: the right button of the panel (x 454..830, y 646..742)
    host.emit('pointer-move', { x: 600, y: 700 });
    finishRound();
    expect(dom.state().held).toEqual(['next-round']);
    expect(host.registered.has('next-round')).toBe(false);
    host.emit('pointer-move', { x: 600, y: 500 });
    expect(dom.state().held).toEqual([]);
    expect(host.registered.has('next-round')).toBe(true);
  });
  it('registers everything at once when no pointer position is known', () => {
    finishRound();
    expect(dom.state().held).toEqual([]);
    expect(host.registered.has('next-round')).toBe(true);
  });
  it('does not start a dwell on GOODBYE under a pointer resting on "Another round"', () => {
    finishRound();
    host.emit('pointer-move', { x: 700, y: 700 }); // inside next-round (summary), and inside GOODBYE once the board returns
    press('next-round');
    expect(host.registered.has('goodbye')).toBe(false);
    host.emit('pointer-move', { x: 700, y: 300 });
    expect(host.registered.has('goodbye')).toBe(true);
  });
});
describe('sound', () => {
  it('the Sound target toggles and reads its state, and never creates audio when there is none', () => {
    expect($('sound-toggle').textContent).toBe('Sound off');
    press('sound-toggle');
    expect($('sound-toggle').getAttribute('aria-pressed')).toBe('false'); // no AudioContext in this test: stays off
  });
});
describe('dwell applies only in head + dwell', () => {
  const modes = ['head + dwell', 'head + gesture', 'scan', 'gesture scan', 'mouse'] as const;
  const missFour = (): void => {
    for (let i = 0; i < 4; i++) press(wrong());
  };
  it.each(modes)('%s: the Suggestion appears only where dwell applies, and the stronger cue always does', (mode) => {
    host.profile.mode = mode;
    missFour();
    expect(document.querySelector('.page')!.getAttribute('data-support')).toBe('2');
    const shown = mode === 'head + dwell';
    expect(dom.state().suggestion !== null).toBe(shown);
    expect(host.registered.has('suggest-apply')).toBe(shown);
    expect(host.registered.has('suggest-dismiss')).toBe(shown);
    expect($('suggest-apply').textContent).toBe(shown ? 'Hold longer: 2400 ms' : '');
  });
  it.each(modes)('%s: the Summary shows the dwell time only in head + dwell, and always the input', (mode) => {
    host.profile.mode = mode;
    finishRound();
    const line = $('summary-dwell').textContent!;
    if (mode === 'head + dwell') expect(line).toBe('Dwell time: 2100 ms. Input: Head + dwell.');
    else {
      expect(line).not.toMatch(/dwell|ms/i);
      expect(line).toMatch(/^Input: .+\.$/);
    }
  });
  it('an open Suggestion closes when the Round ends (it does not stay on the Summary)', () => {
    host.profile.mode = 'head + dwell';
    missFour();
    expect(host.registered.has('suggest-apply')).toBe(true);
    finishRound();
    expect(dom.state()).toMatchObject({ view: 'summary', suggestion: null });
    expect(host.registered.has('suggest-apply')).toBe(false);
    expect(host.registered.has('suggest-dismiss')).toBe(false);
    expect($('suggest-apply').textContent).toBe('');
  });
  it('an open Suggestion also closes when the mode changes to one where dwell does not apply', () => {
    host.profile.mode = 'head + dwell';
    missFour();
    host.profile.mode = 'mouse';
    host.emit('mode-change', { mode: 'mouse' });
    expect(dom.state().suggestion).toBeNull();
    expect(host.registered.has('suggest-apply')).toBe(false);
  });
});
describe('empty Suggestion slots', () => {
  it('are not registered, cannot be reached, and are marked empty on first load', () => {
    for (const id of ['suggest-apply', 'suggest-dismiss']) {
      expect(host.registered.has(id), id).toBe(false);
      const el = $(id) as HTMLButtonElement;
      expect(el.dataset.empty).toBe('true');
      expect(el.disabled).toBe(true);
      expect(el.getAttribute('aria-hidden')).toBe('true');
      expect(el.tabIndex).toBe(-1);
      expect(el.textContent).toBe('');
    }
  });
  it('are still in the layout (the elements stay), so nothing moves when a Suggestion opens', () => {
    expect(document.querySelectorAll('#suggest-row > *')).toHaveLength(3);
  });
});
describe("the spirit's planchette", () => {
  it('glides to the next target after each Hit and goes away at the Summary', () => {
    const steps = messageSteps();
    expect($('glide').dataset.target).toBe(steps[0]);
    press(steps[0]!);
    expect($('glide').dataset.target).toBe(steps[1]);
    press(steps[1]!);
    expect($('glide').dataset.target).toBe(steps[2]);
    press(steps[2]!);
    expect($('glide').hidden).toBe(true);
    expect($('glide').dataset.target).toBeUndefined();
  });
  it('sits in the corner of the next target, never over its centred label', () => {
    const el = document.querySelector<HTMLElement>(`[data-planchette-target="${messageSteps()[0]}"]`)!;
    const cell = host.registered.get(messageSteps()[0]!)!.rect;
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec($('glide').style.transform)!;
    const [gx, gy] = [Number(m[1]), Number(m[2])];
    expect(el).toBeTruthy();
    // the board section has no rectangle in jsdom, so the translate is relative to the origin
    expect(gx).toBeCloseTo(cell.x + cell.width - 24 - 6, 5);
    expect(gy).toBeCloseTo(cell.y + 4, 5);
    expect(gx).toBeGreaterThan(cell.x + cell.width / 2 + 20); // right of the label's centre column
  });
  it('is larger and keeps its corner at level 1 and above', () => {
    const first = messageSteps()[0]!;
    press(wrong());
    press(wrong());
    expect(document.querySelector('.page')!.getAttribute('data-support')).toBe('1');
    const cell = host.registered.get(first)!.rect;
    const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec($('glide').style.transform)!;
    expect(Number(m[1])).toBeCloseTo(cell.x + cell.width - 28 - 6, 5);
  });
});
