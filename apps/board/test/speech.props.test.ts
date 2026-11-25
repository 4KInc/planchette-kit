import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { pickLocalVoice, speak } from '../src/speech.js';

// ---- Shared generators (task 9.3 adds Property 10 below, reusing these) ----

const makeVoice = (voiceURI: string, localService: boolean): SpeechSynthesisVoice =>
  ({ voiceURI, localService, name: voiceURI, lang: 'en-US', default: false }) as SpeechSynthesisVoice;

/** Small URI alphabet so duplicates (including local/non-local sharing a URI) are common. */
const uriArb = fc.constantFrom('a', 'b', 'c', 'd', '', 'voice-1');

const voiceArb = fc
  .record({ uri: fc.oneof(uriArb, fc.string({ maxLength: 8 })), local: fc.boolean() })
  .map(({ uri, local }) => makeVoice(uri, local));

/** 0–10 voices. */
const voiceListArb = fc.array(voiceArb, { minLength: 0, maxLength: 10 });

/** Preferred URI: drawn from the list (any voice), or absent from it. */
const voiceListWithPreferredArb = voiceListArb.chain((voices) =>
  fc
    .oneof(
      voices.length > 0 ? fc.constantFrom(...voices.map((v) => v.voiceURI)) : uriArb,
      fc.constant('__absent__'),
      uriArb,
    )
    .map((preferredURI) => ({ voices, preferredURI })),
);

/** Settings generator for Property 10 (task 9.3). */
export const settingsArb = fc.record({
  predictionSlotCount: fc.integer({ min: 1, max: 8 }),
  voiceURI: fc.oneof(uriArb, fc.string({ maxLength: 8 })),
  speechRate: fc.double({ min: 0.5, max: 2, noNaN: true }),
  filterOffensiveWords: fc.boolean(),
});

interface FakeUtterance {
  text: string;
  voice: SpeechSynthesisVoice | null;
  rate: number;
  addEventListener: (type: string, fn: () => void) => void;
  fire: (type: string) => void;
}

describe('speech properties', () => {
  /**
   * **Property 10: Chosen voice and rate are used on every speak call**
   * **Validates: Requirements 8.4, 8.5**
   */
  it('Property 10: Chosen voice and rate are used on every speak call', async () => {
    const original = (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
    const created: FakeUtterance[] = [];
    class FakeUtteranceImpl implements FakeUtterance {
      voice: SpeechSynthesisVoice | null = null;
      rate = 1;
      private listeners = new Map<string, Array<() => void>>();
      constructor(public text: string) {
        created.push(this);
      }
      addEventListener(type: string, fn: () => void): void {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
      }
      fire(type: string): void {
        for (const fn of this.listeners.get(type) ?? []) fn();
      }
    }
    (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance = FakeUtteranceImpl;
    const timers = { setTimeout: () => 0, clearTimeout: () => undefined };
    try {
      await fc.assert(
        fc.asyncProperty(
          settingsArb,
          voiceListArb,
          fc.array(fc.string({ maxLength: 20 }), { minLength: 1, maxLength: 5 }),
          async (settings, voices, messages) => {
            created.length = 0;
            const spoken: unknown[] = [];
            const synth = {
              speak: (u: unknown) => {
                spoken.push(u);
                (u as FakeUtterance).fire('end');
              },
              cancel: () => undefined,
              getVoices: () => voices,
            };
            const voice = pickLocalVoice(voices, settings.voiceURI);
            for (const m of messages) {
              await speak(m, { voice, rate: settings.speechRate }, synth, timers);
            }
            if (voice === null) {
              expect(spoken).toHaveLength(0);
              return;
            }
            expect(spoken).toHaveLength(messages.length);
            spoken.forEach((u, i) => {
              const utt = u as FakeUtterance;
              expect(utt.voice).toBe(voice);
              expect(utt.rate).toBe(settings.speechRate);
              expect(utt.text).toBe(messages[i]);
            });
          },
        ),
        { numRuns: 200 },
      );
    } finally {
      (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance = original;
    }
  });

  /**
   * **Property 9: Local-service-only voice selection**
   * **Validates: Requirements 8.1, 8.2, 8.4**
   */
  it('Property 9: Local-service-only voice selection', () => {
    fc.assert(
      fc.property(voiceListWithPreferredArb, ({ voices, preferredURI }) => {
        const picked = pickLocalVoice(voices, preferredURI);
        const hasLocal = voices.some((v) => v.localService === true);
        if (picked !== null) {
          expect(picked.localService).toBe(true);
          expect(voices).toContain(picked);
        }
        expect(picked === null).toBe(!hasLocal);
      }),
      { numRuns: 200 },
    );
  });
});
