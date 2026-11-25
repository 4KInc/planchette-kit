/**
 * speech.ts — thin wrapper over `speechSynthesis`. Local-service voices only, so no
 * text leaves the device (Req 8). Spoken-word history is updated by main.ts, not here.
 */
export interface SpeechResult {
  readonly spoken: boolean;
}

export interface SpeakTimers {
  readonly setTimeout: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
}

/** Returns the preferred local-service voice, else the first one, else null. */
export function pickLocalVoice(
  voices: readonly SpeechSynthesisVoice[],
  preferredURI: string,
): SpeechSynthesisVoice | null {
  const local = voices.filter((v) => v.localService === true);
  return local.find((v) => v.voiceURI === preferredURI) ?? local[0] ?? null;
}

const defaultTimers: SpeakTimers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Speaks `text`. Resolves once: `end` → spoken, `error` (any code) → not spoken, or the
 * watchdog `max(10000, 150 * text.length / rate)` ms → cancel and not spoken.
 * A null voice resolves not spoken without touching `synth` or starting a timer.
 * The utterance is built with the global `SpeechSynthesisUtterance` (tests stub it).
 */
export function speak(
  text: string,
  options: { voice: SpeechSynthesisVoice | null; rate: number },
  synth: Pick<SpeechSynthesis, 'speak' | 'cancel' | 'getVoices'>,
  timers: SpeakTimers = defaultTimers,
): Promise<SpeechResult> {
  const { voice, rate } = options;
  if (voice === null) return Promise.resolve({ spoken: false });
  return new Promise<SpeechResult>((resolve) => {
    let settled = false;
    const settle = (spoken: boolean): void => {
      if (settled) return;
      settled = true;
      timers.clearTimeout(handle);
      resolve({ spoken });
    };
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.rate = rate;
    utterance.addEventListener('end', () => settle(true));
    utterance.addEventListener('error', () => settle(false));
    const handle = timers.setTimeout(() => {
      if (settled) return;
      synth.cancel();
      settle(false);
    }, Math.max(10000, (150 * text.length) / rate));
    synth.speak(utterance);
  });
}
