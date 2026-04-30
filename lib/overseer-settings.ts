/**
 * Overseer identity settings — name, portrait, personality.
 * Stored in localStorage under "cascade-overseer".
 */

export interface OverseerSettings {
  name: string;
  portraitIdle: string;
  portraitTalking: string | null;
  personality: string | null;
  // Phase 20 — voice output (Web Speech API). Off by default; user
  // opts in via the settings UI or the chat-header quick toggle.
  voiceEnabled: boolean;
  /** voiceURI from speechSynthesis.getVoices(); null = browser default */
  voiceURI: string | null;
  /** Speech rate, clamped 0–2 by speak() before being passed to the API. */
  voiceRate: number;
  /** Speech pitch, clamped 0–2 by speak() before being passed to the API. */
  voicePitch: number;
  // Phase 21 — Conversation Mode + Push-to-Talk.
  /** Whether the talking-portrait field is honored. When false, the
   *  chat uses the idle portrait for both states. Lets users opt out
   *  of the dual-face flip without clearing the URL. */
  usesTalkingFace: boolean;
  /** Silence threshold (ms) before Conversation Mode auto-submits. */
  silenceThresholdMs: number;
  /** "toggle" = click to toggle mic; "push-to-talk" = hold to record,
   *  release to auto-submit. Conversation Mode overrides this. */
  micMode: "toggle" | "push-to-talk";
}

const STORAGE_KEY = "cascade-overseer";

const DEFAULTS: OverseerSettings = {
  name: "Overseer",
  portraitIdle: "/delamain.jpg",
  // Public asset already on disk — gives the dual-face flip out of
  // the box. localStorage overrides via the Overseer settings panel.
  portraitTalking: "/delamain-talking.jpg",
  personality: null,
  voiceEnabled: false,
  voiceURI: null,
  voiceRate: 1.0,
  voicePitch: 1.0,
  usesTalkingFace: true,
  silenceThresholdMs: 1500,
  micMode: "toggle",
};

/**
 * Get current Overseer settings, merged with defaults.
 */
export function getOverseerSettings(): OverseerSettings {
  if (typeof window === "undefined") return { ...DEFAULTS };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const saved = JSON.parse(raw);
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Update Overseer settings (partial merge).
 */
export function setOverseerSettings(
  updates: Partial<OverseerSettings>
): void {
  if (typeof window === "undefined") return;

  const current = getOverseerSettings();
  const merged = { ...current, ...updates };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
}

/**
 * Determine portrait mode. Phase 21 — also gated by the
 * `usesTalkingFace` toggle so users can opt out without clearing
 * the talking-portrait URL.
 */
export function getPortraitMode(): "single" | "dual" {
  const settings = getOverseerSettings();
  if (!settings.usesTalkingFace) return "single";
  return settings.portraitTalking ? "dual" : "single";
}

/**
 * Get the Overseer's display name (for use in system prompts and UI).
 */
export function getOverseerName(): string {
  return getOverseerSettings().name;
}
