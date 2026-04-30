/**
 * Phase 22.1 — pure helper that decides whether a portrait `src`
 * is usable. Lives in lib/ so it's testable in the node test env
 * without touching React.
 *
 * The actual fallback rendering happens in
 * `app/components/portrait.tsx` (DefaultPortrait SVG component).
 */

/**
 * True when `src` is non-empty, non-null, and not a string of only
 * whitespace. False otherwise. Used by the Portrait wrapper to
 * decide whether to attempt loading an image at all — short-
 * circuits to the SVG fallback when the URL is junk.
 */
export function isPortraitSrcUsable(src: unknown): src is string {
  return typeof src === "string" && src.trim().length > 0;
}
