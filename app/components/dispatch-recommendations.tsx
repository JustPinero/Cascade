"use client";

import { useEffect, useState } from "react";
import type { Recommendation } from "@/lib/dispatch-recommendations";

/**
 * Phase 40 [P3] — outcome-driven dispatch recommendations card.
 *
 * Surfaces the patterns the Overseer already reasons over (mode keeps
 * coming back clean, continue keeps failing, a blocker recurs) to the
 * human operator. Same poll-and-keep-last contract as FleetStatusStrip /
 * CostWidget: renders nothing until the first successful fetch and nothing
 * when there's nothing to say; later fetch errors keep last-known state.
 * Dismissible for the session.
 */

const POLL_MS = 120_000;

export function DispatchRecommendations() {
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const res = await fetch("/api/recommendations");
        if (!res.ok) return;
        const data = (await res.json()) as { recommendations: Recommendation[] };
        if (!cancelled) setRecs(data.recommendations);
      } catch {
        // Best-effort — keep last-known state.
      }
    }
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (dismissed || !recs || recs.length === 0) return null;

  return (
    <div
      data-testid="dispatch-recommendations"
      className="mb-6 border border-space-600 bg-space-800/40 p-4"
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-mono uppercase tracking-wider text-text-bright">
          Dispatch recommendations
        </h2>
        <button
          type="button"
          data-testid="dismiss-recommendations"
          onClick={() => setDismissed(true)}
          className="text-xs font-mono text-space-500 hover:text-text uppercase tracking-wider"
          aria-label="Dismiss recommendations"
        >
          Dismiss
        </button>
      </div>
      <ul className="flex flex-col gap-2">
        {recs.map((rec, i) => (
          <li
            key={`${rec.projectSlug}-${rec.kind}-${rec.mode}-${i}`}
            data-testid="recommendation"
            className="flex items-start gap-2 text-sm font-mono text-text"
          >
            <span
              data-testid="recommendation-dot"
              className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                rec.severity === "warn" ? "bg-amber" : "bg-space-500"
              }`}
            />
            <span>{rec.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
