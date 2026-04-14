/**
 * Overseer identity settings — name, portrait, personality.
 * Stored in localStorage under "cascade-overseer".
 */

export interface OverseerSettings {
  name: string;
  portraitIdle: string;
  portraitTalking: string | null;
  personality: string | null;
}

const STORAGE_KEY = "cascade-overseer";

const DEFAULTS: OverseerSettings = {
  name: "Overseer",
  portraitIdle: "/delamain.jpg",
  portraitTalking: null,
  personality: null,
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
 * Determine portrait mode based on whether a talking image exists.
 */
export function getPortraitMode(): "single" | "dual" {
  const settings = getOverseerSettings();
  return settings.portraitTalking ? "dual" : "single";
}

/**
 * Get the Overseer's display name (for use in system prompts and UI).
 */
export function getOverseerName(): string {
  return getOverseerSettings().name;
}
