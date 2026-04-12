"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { sendNotification } from "@/lib/notify";
import { playAlertSound } from "@/lib/sounds";

interface ActivityEvent {
  id: number;
  eventType: string;
  summary: string;
  createdAt: string;
  project: { name: string; slug: string } | null;
}

const NOTIFY_EVENT_TYPES = new Set([
  "blocker-detected",
  "session-complete",
  "phase-complete",
]);

const eventTypeColors: Record<string, string> = {
  commit: "text-cyan",
  "phase-complete": "text-success",
  "audit-complete": "text-info",
  "lesson-harvested": "text-accent",
  "advisory-sent": "text-amber",
  "project-created": "text-success",
  "blocker-detected": "text-danger",
  "debt-resolved": "text-success",
  "scan-complete": "text-cyan",
  "session-launched": "text-cyan",
  "session-completed": "text-success",
  "deploy-complete": "text-amber",
};

const eventTypeLabels: Record<string, string> = {
  commit: "COMMIT",
  "phase-complete": "PHASE",
  "audit-complete": "AUDIT",
  "lesson-harvested": "LESSON",
  "advisory-sent": "ADVISORY",
  "project-created": "NEW",
  "blocker-detected": "BLOCKED",
  "debt-resolved": "RESOLVED",
  "scan-complete": "SCAN",
  "session-launched": "LAUNCH",
  "session-completed": "DONE",
  "deploy-complete": "DEPLOY",
};

function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

interface ActivityFeedProps {
  maxItems?: number;
  pollInterval?: number;
}

export function ActivityFeed({
  maxItems = 10,
  pollInterval = 30000,
}: ActivityFeedProps) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [filterType, setFilterType] = useState<string | null>(null);
  const lastSeenIdRef = useRef<number>(0);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchEvents() {
      try {
        const params = new URLSearchParams();
        params.set("limit", "50");
        if (filterType) params.set("type", filterType);
        const res = await fetch(`/api/activity?${params}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (Array.isArray(data)) {
          // Notify for new escalation events
          if (lastSeenIdRef.current > 0) {
            for (const event of data) {
              if (
                event.id > lastSeenIdRef.current &&
                NOTIFY_EVENT_TYPES.has(event.eventType)
              ) {
                const label =
                  eventTypeLabels[event.eventType] || event.eventType;
                playAlertSound();
                sendNotification(
                  `Delamain: [${label}]${event.project ? ` ${event.project.name}` : ""}`,
                  {
                    body: event.summary,
                    tag: `cascade-event-${event.id}`,
                  }
                );
              }
            }
          }
          if (data.length > 0) {
            lastSeenIdRef.current = Math.max(
              lastSeenIdRef.current,
              ...data.map((e: ActivityEvent) => e.id)
            );
          }
          setEvents(data);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      } finally {
        setLoading(false);
      }
    }

    fetchEvents();
    const interval = setInterval(fetchEvents, pollInterval);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [filterType, pollInterval]);

  const displayedEvents = showAll ? events : events.slice(0, maxItems);
  const hasMore = events.length > maxItems && !showAll;

  const eventTypes = [...new Set(events.map((e) => e.eventType))];

  if (loading) {
    return (
      <div className="p-4 border border-space-600 bg-space-900 font-mono text-xs">
        <div className="text-space-500 animate-pulse">
          Loading activity feed...
        </div>
      </div>
    );
  }

  return (
    <div className="border border-space-600 bg-space-900">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-space-600">
        <span className="text-xs font-mono uppercase tracking-widest text-cyan">
          Activity Log
        </span>
        {eventTypes.length > 1 && (
          <div className="flex gap-1">
            <button
              onClick={() => setFilterType(null)}
              className={`px-1.5 py-0.5 text-[10px] font-mono uppercase ${
                filterType === null
                  ? "text-cyan border-b border-cyan"
                  : "text-space-500 hover:text-text"
              }`}
            >
              All
            </button>
            {eventTypes.map((type) => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={`px-1.5 py-0.5 text-[10px] font-mono uppercase ${
                  filterType === type
                    ? "text-cyan border-b border-cyan"
                    : "text-space-500 hover:text-text"
                }`}
              >
                {eventTypeLabels[type] || type}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Events */}
      <div className="max-h-64 overflow-y-auto">
        {displayedEvents.length === 0 ? (
          <div className="px-3 py-4 text-xs font-mono text-space-500">
            No activity recorded yet.
          </div>
        ) : (
          displayedEvents.map((event) => (
            <div
              key={event.id}
              className="flex items-start gap-2 px-3 py-1.5 text-xs font-mono border-b border-space-800 last:border-b-0 hover:bg-space-800/50"
            >
              <span className="text-space-500 flex-shrink-0 w-12">
                {formatTimestamp(event.createdAt)}
              </span>
              <span
                className={`flex-shrink-0 w-16 uppercase ${eventTypeColors[event.eventType] || "text-text"}`}
              >
                [{eventTypeLabels[event.eventType] || event.eventType}]
              </span>
              {event.project && (
                <Link
                  href={`/projects/${event.project.slug}`}
                  className="text-text-bright hover:text-cyan flex-shrink-0"
                >
                  {event.project.name}
                </Link>
              )}
              <span className="text-text truncate">{event.summary}</span>
            </div>
          ))
        )}
      </div>

      {/* Show more */}
      {hasMore && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full px-3 py-1.5 text-xs font-mono text-cyan border-t border-space-600 hover:bg-space-800 transition-colors"
        >
          Show {events.length - maxItems} more
        </button>
      )}
    </div>
  );
}
