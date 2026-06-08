"use client";

import { useEffect, useState } from "react";

/**
 * Phase 28 — small status indicator for the dashboard header.
 *
 * Fetches `/api/preflight` on mount and renders the detected platform
 * with a colored dot: green = every required tool is on PATH, amber =
 * something is missing. The hover title lists the missing tool names
 * so the user can read it without leaving the dashboard.
 */
interface PreflightResult {
  platform: "macos" | "linux" | "windows";
  ok: boolean;
  missing: string[];
  tools: Record<string, string | null>;
}

const PLATFORM_LABELS: Record<PreflightResult["platform"], string> = {
  macos: "macOS",
  linux: "Linux",
  windows: "Windows",
};

export function PlatformBadge() {
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/preflight");
        if (!res.ok) {
          if (!cancelled) setFailed(true);
          return;
        }
        const data = (await res.json()) as PreflightResult;
        if (!cancelled) setResult(data);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed || !result) return null;

  const dotClass = result.ok ? "bg-success" : "bg-amber";
  const title = result.ok
    ? `${PLATFORM_LABELS[result.platform]} — all dispatch tools available`
    : `${PLATFORM_LABELS[result.platform]} — missing: ${result.missing.join(", ")}`;

  return (
    <div
      data-testid="platform-badge"
      title={title}
      className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-space-600 text-text"
    >
      <span
        data-testid="platform-dot"
        className={`w-2 h-2 rounded-full ${dotClass} ${result.ok ? "pulse-healthy" : "pulse-warning"}`}
      />
      <span>{PLATFORM_LABELS[result.platform]}</span>
    </div>
  );
}
