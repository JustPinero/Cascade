"use client";

import { useEffect, useState } from "react";

/**
 * Phase 41.4 — minimal dashboard surface for fleet reconciliation drift:
 * a count + list of findings where the DB picture of a project
 * contradicts filesystem/git reality (dead paths, dirty "complete"
 * projects, unpushed work, ahead/behind origin).
 *
 * Fetches /api/reconciliation once on mount (local-only pass, no git
 * fetch). Renders nothing when the fleet is consistent or the check
 * fails — drift is an alarm, not wallpaper.
 */
interface DriftFinding {
  type: string;
  severity: string;
  message: string;
}

interface DriftProject {
  slug: string;
  name: string;
  findings: DriftFinding[];
}

interface DriftData {
  generatedAt: string;
  findingsCount: number;
  projects: DriftProject[];
}

const SEVERITY_CLASS: Record<string, string> = {
  critical: "text-danger",
  warning: "text-amber",
  notice: "text-space-400",
};

export function FleetDriftPanel() {
  const [drift, setDrift] = useState<DriftData | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const res = await fetch("/api/reconciliation");
        if (!res.ok) return;
        const data = (await res.json()) as DriftData;
        if (!cancelled) setDrift(data);
      } catch {
        // Best-effort — render nothing on failure.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!drift || drift.findingsCount === 0) return null;

  return (
    <div
      data-testid="fleet-drift-panel"
      className="mb-6 border border-amber/30 bg-space-900"
    >
      <div className="px-4 py-2 border-b border-space-700">
        <span className="text-xs font-mono text-amber uppercase tracking-wider font-bold">
          Fleet Drift — {drift.findingsCount} finding
          {drift.findingsCount !== 1 ? "s" : ""}
        </span>
      </div>
      <ul className="p-4 space-y-2">
        {drift.projects.map((project) => (
          <li key={project.slug} className="text-xs font-mono">
            <span className="text-text-bright">{project.slug}</span>
            <ul className="ml-4 mt-1 space-y-0.5">
              {project.findings.map((finding, i) => (
                <li
                  key={`${finding.type}-${i}`}
                  className={SEVERITY_CLASS[finding.severity] ?? "text-text"}
                >
                  [{finding.type}] {finding.message}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
