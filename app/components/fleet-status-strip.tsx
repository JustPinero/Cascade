"use client";

import { useEffect, useState } from "react";

/**
 * Phase 38 [P2] — always-visible dispatch-queue status for the
 * dashboard header. With memory-gated concurrency of 1-4, knowing
 * what's running, waiting, and stuck is essential to planning work —
 * and "stuck" is the human-visible alarm for the slot leaks Phase 37
 * guards against.
 *
 * Polls /api/dispatch/status every 15s. Renders nothing until the
 * first successful fetch; later fetch errors keep last-known state
 * (a flickering badge is worse than a slightly stale one).
 */
interface DispatchStatus {
  queue: { running: number; pending: number; capacity: number };
  dispatches: { queued: number; started: number; overdue: number };
}

const POLL_MS = 15_000;

export function FleetStatusStrip() {
  const [status, setStatus] = useState<DispatchStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const res = await fetch("/api/dispatch/status");
        if (!res.ok) return;
        const data = (await res.json()) as DispatchStatus;
        if (!cancelled) setStatus(data);
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

  if (!status) return null;

  const { queue, dispatches } = status;
  const stuck = dispatches.overdue;

  const segments = [`${queue.running}/${queue.capacity} running`];
  if (queue.pending > 0) segments.push(`${queue.pending} queued`);
  if (stuck > 0) segments.push(`${stuck} stuck`);

  const dotClass =
    stuck > 0
      ? "bg-amber pulse-warning"
      : queue.running > 0
        ? "bg-success pulse-healthy"
        : "bg-space-600";

  const title =
    `Dispatch queue — ${queue.running} of ${queue.capacity} slots in use, ` +
    `${queue.pending} waiting` +
    (stuck > 0 ? `, ${stuck} past deadline (watchdog will reap)` : "");

  return (
    <div
      data-testid="fleet-status-strip"
      title={title}
      className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-space-600 text-text"
    >
      <span
        data-testid="fleet-dot"
        className={`w-2 h-2 rounded-full ${dotClass}`}
      />
      <span data-testid="fleet-counts">{segments.join(" · ")}</span>
    </div>
  );
}
