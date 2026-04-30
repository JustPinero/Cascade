/**
 * Phase 20.1 — text-to-speech via the browser's Web Speech API.
 *
 * Wraps `speechSynthesis` so callers don't have to feature-detect or
 * worry about the SSR case (no `window`). The interface is small on
 * purpose — a future cloud-TTS provider can drop in behind the same
 * three exports without leaking through the API surface.
 *
 * Justin's "Jarvis from Iron Man" target. Triggered in chat after a
 * response streams in (when voiceEnabled), cancelled on new message.
 */

export interface SpeakOptions {
  voiceEnabled: boolean;
  voiceURI: string | null;
  voiceRate: number;
  voicePitch: number;
  onComplete?: () => void;
}

function getSynth(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  return window.speechSynthesis ?? null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(n, hi));
}

/**
 * Speak `text` with the given options. No-op when:
 * - text is empty
 * - voiceEnabled is false
 * - speechSynthesis is unavailable (server-side or unsupported browser)
 */
export function speak(text: string, options: SpeakOptions): void {
  if (!text || !text.trim()) return;
  if (!options.voiceEnabled) return;

  const synth = getSynth();
  if (!synth) return;

  const utterance = new window.SpeechSynthesisUtterance(text);
  utterance.rate = clamp(options.voiceRate, 0, 2);
  utterance.pitch = clamp(options.voicePitch, 0, 2);

  if (options.voiceURI) {
    const voices = synth.getVoices();
    const match = voices.find((v) => v.voiceURI === options.voiceURI);
    if (match) utterance.voice = match;
  }

  if (options.onComplete) {
    utterance.onend = options.onComplete;
  }

  synth.speak(utterance);
}

/**
 * Cancel any in-flight speech. Safe to call when nothing is speaking
 * or when speechSynthesis is unavailable.
 */
export function cancel(): void {
  const synth = getSynth();
  if (!synth) return;
  synth.cancel();
}

/**
 * Return the browser's currently available voices. May be empty on
 * first call — some browsers populate the list asynchronously and
 * fire `voiceschanged`. Settings UI should listen for that event.
 */
export function listVoices(): SpeechSynthesisVoice[] {
  const synth = getSynth();
  if (!synth) return [];
  return synth.getVoices();
}
