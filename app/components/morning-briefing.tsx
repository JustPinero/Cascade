"use client";

import { useCallback, useEffect, useState } from "react";
import { getOverseerSettings } from "@/lib/overseer-settings";

interface BriefingData {
  briefing: string;
  generatedAt: string;
  projectCount: number;
  blockedCount: number;
  recentEventCount: number;
}

export function MorningBriefing() {
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [shouldShow, setShouldShow] = useState(false);
  const settings = getOverseerSettings();

  // Check if we should show the briefing (first visit of the day)
  useEffect(() => {
    const today = new Date().toISOString().split("T")[0];
    const lastBriefing = localStorage.getItem("cascade-last-briefing-date");
    if (lastBriefing !== today) {
      setShouldShow(true);
    }
  }, []);

  const generateBriefing = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/briefing", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setBriefing(data);
        const today = new Date().toISOString().split("T")[0];
        localStorage.setItem("cascade-last-briefing-date", today);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-generate on first visit of the day
  useEffect(() => {
    if (shouldShow && !briefing && !loading) {
      generateBriefing();
    }
  }, [shouldShow, briefing, loading, generateBriefing]);

  function handleDismiss() {
    setDismissed(true);
  }

  // Manual trigger button (always visible)
  if (!shouldShow || dismissed) {
    return (
      <div className="mb-4">
        <button
          onClick={() => {
            setShouldShow(true);
            setDismissed(false);
            generateBriefing();
          }}
          disabled={loading}
          className="px-3 py-1.5 text-xs font-mono border border-space-600 text-space-400 hover:text-cyan hover:border-cyan/30 transition-colors"
        >
          {loading ? "Generating..." : "Brief me"}
        </button>
      </div>
    );
  }

  if (loading && !briefing) {
    return (
      <div className="mb-6 p-4 border border-cyan/20 bg-space-900">
        <div className="flex items-center gap-2">
          <img
            src={settings.portraitIdle}
            alt={settings.name}
            className="w-5 h-5 rounded-full ring-1 ring-cyan/40 pulse-healthy"
          />
          <span className="text-xs font-mono text-cyan">
            {settings.name} is preparing your morning briefing...
          </span>
        </div>
      </div>
    );
  }

  if (!briefing) return null;

  return (
    <div className="mb-6 border border-cyan/20 bg-space-900 animate-fade-in">
      <div className="flex items-center justify-between px-4 py-2 border-b border-space-700">
        <div className="flex items-center gap-2">
          <img
            src={settings.portraitIdle}
            alt={settings.name}
            className="w-5 h-5 rounded-full ring-1 ring-cyan/40"
          />
          <span className="text-xs font-mono text-cyan uppercase tracking-wider font-bold">
            Morning Briefing
          </span>
        </div>
        <button
          onClick={handleDismiss}
          className="text-xs font-mono text-space-500 hover:text-text transition-colors"
        >
          Dismiss
        </button>
      </div>
      <div className="p-4 text-sm font-mono text-text leading-relaxed whitespace-pre-wrap">
        {briefing.briefing}
      </div>
    </div>
  );
}
