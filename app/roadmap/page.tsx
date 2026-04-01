"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Project {
  slug: string;
  name: string;
  status: string;
  health: string;
  currentPhase: string;
  currentRequest: string | null;
  lastActivityAt: string;
}

const healthOrder: Record<string, number> = {
  blocked: 0,
  warning: 1,
  idle: 2,
  healthy: 3,
};

const healthColors: Record<string, string> = {
  healthy: "text-success",
  warning: "text-amber",
  blocked: "text-danger",
  idle: "text-space-500",
};

const statusColors: Record<string, string> = {
  building: "text-cyan",
  deployed: "text-amber",
  paused: "text-space-500",
  archived: "text-space-500",
};

function PhaseBar({ currentPhase }: { currentPhase: string }) {
  const phaseMatch = currentPhase.match(/phase-(\d+)/);
  const current = phaseMatch ? parseInt(phaseMatch[1]) : 1;
  const total = 6;

  return (
    <div className="flex gap-0.5">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-2 w-6 ${
            i + 1 < current
              ? "bg-success"
              : i + 1 === current
                ? "bg-cyan"
                : "bg-space-600"
          }`}
        />
      ))}
    </div>
  );
}

function formatTimeAgo(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffHours / 24);
  if (diffHours < 1) return "just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

export default function RoadmapPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sortBy, setSortBy] = useState<"health" | "activity" | "name">(
    "health"
  );
  const [filterStatus, setFilterStatus] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    const res = await fetch("/api/projects");
    const data = await res.json();
    if (Array.isArray(data)) setProjects(data);
  }, []);

  useEffect(() => {
    fetchProjects();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  let displayed = [...projects];

  if (filterStatus) {
    displayed = displayed.filter((p) => p.status === filterStatus);
  }

  displayed.sort((a, b) => {
    if (sortBy === "health") {
      return (healthOrder[a.health] ?? 9) - (healthOrder[b.health] ?? 9);
    }
    if (sortBy === "activity") {
      return (
        new Date(b.lastActivityAt).getTime() -
        new Date(a.lastActivityAt).getTime()
      );
    }
    return a.name.localeCompare(b.name);
  });

  const buildingCount = projects.filter((p) => p.status === "building").length;
  const deployedCount = projects.filter((p) => p.status === "deployed").length;
  const blockedCount = projects.filter((p) => p.health === "blocked").length;

  return (
    <div>
      <h1 className="text-2xl font-bold font-mono tracking-wide text-text-bright uppercase mb-2">
        Roadmap
      </h1>
      <div className="flex gap-4 text-xs font-mono text-text mb-6">
        <span>
          <span className="text-cyan">{buildingCount}</span> building
        </span>
        <span>
          <span className="text-amber">{deployedCount}</span> deployed
        </span>
        {blockedCount > 0 && (
          <span>
            <span className="text-danger">{blockedCount}</span> blocked
          </span>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="flex gap-1">
          {["health", "activity", "name"].map((s) => (
            <button
              key={s}
              onClick={() => setSortBy(s as typeof sortBy)}
              className={`px-2 py-1 text-[10px] font-mono uppercase border transition-colors ${
                sortBy === s
                  ? "border-cyan text-cyan"
                  : "border-space-600 text-space-500 hover:text-text"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {[null, "building", "deployed", "paused"].map((s) => (
            <button
              key={s || "all"}
              onClick={() => setFilterStatus(s)}
              className={`px-2 py-1 text-[10px] font-mono uppercase border transition-colors ${
                filterStatus === s
                  ? "border-cyan text-cyan"
                  : "border-space-600 text-space-500 hover:text-text"
              }`}
            >
              {s || "all"}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="border border-space-600 overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="border-b border-space-600 bg-space-800">
              <th className="text-left px-3 py-2 text-cyan uppercase tracking-wider">
                Project
              </th>
              <th className="text-left px-3 py-2 text-cyan uppercase tracking-wider">
                Phase
              </th>
              <th className="text-left px-3 py-2 text-cyan uppercase tracking-wider">
                Progress
              </th>
              <th className="text-left px-3 py-2 text-cyan uppercase tracking-wider">
                Status
              </th>
              <th className="text-left px-3 py-2 text-cyan uppercase tracking-wider">
                Health
              </th>
              <th className="text-left px-3 py-2 text-cyan uppercase tracking-wider">
                Activity
              </th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((p) => (
              <tr
                key={p.slug}
                className="border-b border-space-700 hover:bg-space-800/50"
              >
                <td className="px-3 py-2">
                  <Link
                    href={`/projects/${p.slug}`}
                    className="text-text-bright hover:text-cyan transition-colors"
                  >
                    {p.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-info">
                  {p.currentPhase.replace(/-/g, " ").replace(/phase /, "P")}
                </td>
                <td className="px-3 py-2">
                  <PhaseBar currentPhase={p.currentPhase} />
                </td>
                <td className="px-3 py-2">
                  <span className={statusColors[p.status] || "text-text"}>
                    {p.status}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={healthColors[p.health] || "text-text"}>
                    {p.health}
                  </span>
                </td>
                <td className="px-3 py-2 text-space-500">
                  {formatTimeAgo(p.lastActivityAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
