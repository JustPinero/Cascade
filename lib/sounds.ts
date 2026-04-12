/**
 * Delamain sound effects via Web Audio API synthesis.
 * No external audio files — generates tones programmatically.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

/**
 * Check if sounds are enabled.
 */
export function getSoundPreference(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem("cascade-sounds") !== "false";
}

/**
 * Set sound preference.
 */
export function setSoundPreference(enabled: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("cascade-sounds", String(enabled));
}

/**
 * Check if a sound should play right now.
 */
export function shouldPlaySound(): boolean {
  if (typeof window === "undefined") return false;
  if (!getSoundPreference()) return false;
  if (document.visibilityState !== "visible") return false;
  return true;
}

/**
 * Play a synthesized tone.
 */
function playTone(
  frequency: number,
  duration: number,
  type: OscillatorType = "sine",
  volume: number = 0.15
): void {
  if (!shouldPlaySound()) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  // Resume context if suspended (browser autoplay policy)
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

  // Fade in and out to avoid clicks
  gainNode.gain.setValueAtTime(0, ctx.currentTime);
  gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.02);
  gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + duration);
}

/**
 * Delamain starts responding — ascending two-tone chime.
 */
export function playStartSound(): void {
  playTone(440, 0.12, "sine", 0.1); // A4
  setTimeout(() => playTone(660, 0.15, "sine", 0.12), 100); // E5
}

/**
 * Delamain finishes responding — descending confirmation tone.
 */
export function playEndSound(): void {
  playTone(660, 0.1, "sine", 0.1); // E5
  setTimeout(() => playTone(523, 0.18, "sine", 0.12), 80); // C5
}

/**
 * Escalation or blocker detected — alert tone.
 */
export function playAlertSound(): void {
  playTone(880, 0.08, "square", 0.08); // A5
  setTimeout(() => playTone(880, 0.08, "square", 0.08), 120);
  setTimeout(() => playTone(1100, 0.15, "square", 0.1), 240); // ~C#6
}
