"use client";

import { useEffect, useState } from "react";

interface Reminder {
  id: number;
  message: string;
  conditionType: string;
  conditionValue: string;
  projectSlug: string | null;
  status: string;
  createdBy: string;
  triggeredAt: string | null;
}

export function ReminderWidget() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    function fetchReminders() {
      fetch("/api/reminders")
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) setReminders(data);
        })
        .catch(() => {
          // Silently fail — may be in test environment or offline
        });
    }

    fetchReminders();
    const interval = setInterval(fetchReminders, 15000);
    return () => clearInterval(interval);
  }, []);

  async function dismiss(id: number) {
    await fetch("/api/reminders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "dismissed" }),
    });
    setReminders((prev) => prev.filter((r) => r.id !== id));
  }

  const triggered = reminders.filter((r) => r.status === "triggered");
  const pending = reminders.filter((r) => r.status === "pending");
  const total = reminders.length;

  if (total === 0) return null;

  return (
    <div className="mx-3 mb-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider hover:bg-space-700/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {triggered.length > 0 ? (
            <div
              className="w-2 h-2 rounded-full bg-amber pulse-warning"
              style={{ boxShadow: "0 0 6px rgba(224, 175, 104, 0.5)" }}
            />
          ) : (
            <div className="w-2 h-2 rounded-full bg-space-500" />
          )}
          <span
            className={
              triggered.length > 0 ? "text-amber" : "text-space-500"
            }
          >
            Reminders
          </span>
        </div>
        <span
          className={`text-[10px] font-mono ${
            triggered.length > 0 ? "text-amber" : "text-space-500"
          }`}
        >
          {triggered.length > 0
            ? `${triggered.length}!`
            : pending.length > 0
              ? pending.length
              : ""}
        </span>
      </button>

      {expanded && (
        <div className="mt-1 space-y-1 max-h-48 overflow-y-auto">
          {triggered.map((r) => (
            <div
              key={r.id}
              className="px-2 py-1.5 text-[10px] font-mono border-l-2 border-amber bg-amber/5"
            >
              <div className="flex items-start justify-between gap-1">
                <p className="text-amber leading-relaxed">{r.message}</p>
                <button
                  onClick={() => dismiss(r.id)}
                  className="text-space-500 hover:text-text flex-shrink-0"
                >
                  x
                </button>
              </div>
              {r.projectSlug && (
                <p className="text-space-500 mt-0.5">{r.projectSlug}</p>
              )}
            </div>
          ))}
          {pending.map((r) => (
            <div
              key={r.id}
              className="px-2 py-1.5 text-[10px] font-mono border-l-2 border-space-600"
            >
              <div className="flex items-start justify-between gap-1">
                <p className="text-text-dim leading-relaxed">{r.message}</p>
                <button
                  onClick={() => dismiss(r.id)}
                  className="text-space-500 hover:text-text flex-shrink-0"
                >
                  x
                </button>
              </div>
              <p className="text-space-500 mt-0.5">
                {r.conditionType}: {r.conditionValue}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
