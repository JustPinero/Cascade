"use client";

import { useEffect, useState } from "react";

/**
 * Phase 39 [P8] — compact "what did today cost" badge for the
 * dashboard header. The full per-call-site breakdown lives on
 * /observability/cache; this is the at-a-glance number.
 *
 * Polls /api/usage/summary every 60s. Renders nothing until the first
 * successful fetch; later errors keep last-known state. A `~` prefix
 * marks the figure approximate when events carried models missing
 * from the pricing table.
 */
interface UsageSummaryBody {
  calls: number;
  estimatedCostUsd: number;
  hitRate: number;
  hasUnknownModels: boolean;
}

const POLL_MS = 60_000;

export function CostWidget() {
  const [summary, setSummary] = useState<UsageSummaryBody | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const res = await fetch("/api/usage/summary");
        if (!res.ok) return;
        const data = (await res.json()) as UsageSummaryBody;
        if (!cancelled) setSummary(data);
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

  if (!summary) return null;

  const approx = summary.hasUnknownModels ? "~" : "";
  const cost = `${approx}$${summary.estimatedCostUsd.toFixed(2)}`;
  const hitPct = Math.round(summary.hitRate * 100);

  const title =
    `Estimated Anthropic spend since local midnight — ` +
    `${summary.calls} API call${summary.calls === 1 ? "" : "s"}, ` +
    `${hitPct}% prompt-cache hit rate. ` +
    `Breakdown: /observability/cache. Pricing table: lib/observability/usage-summary.ts.`;

  return (
    <div
      data-testid="cost-widget"
      title={title}
      className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-space-600 text-text"
    >
      <span>{cost} today</span>
      <span className="text-text/60">·</span>
      <span>{summary.calls} calls</span>
      <span className="text-text/60">·</span>
      <span>cache {hitPct}%</span>
    </div>
  );
}
