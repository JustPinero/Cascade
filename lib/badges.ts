export type Badge =
  | "deployed"
  | "client"
  | "testing"
  | "awaiting-review"
  | "versioned";

export const VALID_BADGES: Badge[] = [
  "deployed",
  "client",
  "testing",
  "awaiting-review",
  "versioned",
];

const VALID_SET = new Set<string>(VALID_BADGES);

/**
 * Validate and deduplicate a badges array.
 */
export function validateBadges(input: string[]): Badge[] {
  if (!input || !Array.isArray(input)) return [];
  const seen = new Set<string>();
  const result: Badge[] = [];
  for (const badge of input) {
    if (VALID_SET.has(badge) && !seen.has(badge)) {
      seen.add(badge);
      result.push(badge as Badge);
    }
  }
  return result;
}

export const BADGE_STYLES: Record<Badge, { color: string; label: string }> = {
  deployed: { color: "text-success border-success/40", label: "DEPLOYED" },
  client: { color: "text-cyan border-cyan/40", label: "CLIENT" },
  testing: { color: "text-amber border-amber/40", label: "TESTING" },
  "awaiting-review": { color: "text-accent border-accent/40", label: "REVIEW" },
  versioned: { color: "text-space-400 border-space-500", label: "VERSIONED" },
};
