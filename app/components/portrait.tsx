"use client";

/**
 * Phase 22.1 — Portrait wrapper with graceful fallback.
 *
 * Renders the source image when it loads. Falls back to a neutral
 * inline SVG (DefaultPortrait) in three cases:
 *   - `src` is null / undefined / empty string / whitespace
 *   - the image fails to load at runtime (404, blocked, etc.)
 *
 * Use this everywhere a portrait is rendered (chat header, chat
 * messages, settings previews) so a missing or broken theme asset
 * degrades to something intentional instead of a broken-image icon.
 */

import { useState } from "react";
import { isPortraitSrcUsable } from "@/lib/portrait-fallback";

interface PortraitProps {
  src: string | null | undefined;
  alt: string;
  className?: string;
  /** Size hint for the SVG fallback so it picks reasonable stroke widths. */
  size?: "sm" | "md" | "lg";
}

export function Portrait({
  src,
  alt,
  className,
  size = "md",
}: PortraitProps) {
  const [errored, setErrored] = useState(false);

  if (!isPortraitSrcUsable(src) || errored) {
    return <DefaultPortrait className={className} size={size} aria-label={alt} />;
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setErrored(true)}
    />
  );
}

/**
 * Theme-agnostic placeholder. Soft circular gradient with a calm
 * speech-bubble glyph. Reads as "AI assistant" without committing
 * to any particular vibe — works as a fallback regardless of
 * which theme is active.
 *
 * Pure SVG, ships in the bundle, zero asset dependencies, scales
 * cleanly from 16px to full screen.
 */
function DefaultPortrait({
  className,
  size,
  ...rest
}: {
  className?: string;
  size: "sm" | "md" | "lg";
} & React.SVGProps<SVGSVGElement>) {
  // Stroke width tuned so the glyph reads at 32px without going
  // hairline at 128px. Could parameterize further; this is fine.
  const stroke = size === "sm" ? 1.5 : size === "lg" ? 2.5 : 2;

  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      {...rest}
    >
      <defs>
        <radialGradient id="portrait-fallback-bg" cx="40%" cy="35%" r="65%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
          <stop offset="60%" stopColor="currentColor" stopOpacity="0.10" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.20" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="32" fill="url(#portrait-fallback-bg)" />
      <circle
        cx="32"
        cy="32"
        r="30"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.4"
        strokeWidth={stroke}
      />
      {/* Speech-bubble glyph */}
      <path
        d="M20 24 h24 a4 4 0 0 1 4 4 v12 a4 4 0 0 1 -4 4 h-14 l-6 6 v-6 h-4 a4 4 0 0 1 -4 -4 v-12 a4 4 0 0 1 4 -4 z"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.7"
        strokeWidth={stroke}
        strokeLinejoin="round"
      />
    </svg>
  );
}
