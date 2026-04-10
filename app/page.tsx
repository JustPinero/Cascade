"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { requestNotificationPermission } from "@/lib/notify";
import { ScanButton } from "./components/scan-button";
import { MorningBriefing } from "./components/morning-briefing";
import { ProjectGrid } from "./components/project-grid";
import {
  DashboardFilters,
  type FilterState,
} from "./components/dashboard-filters";
import { ActivityFeed } from "./components/activity-feed";
import { DispatchResults } from "./components/dispatch-results";
import { OverseerChat } from "./components/overseer-chat";
import type { ProjectTileData } from "./components/project-tile";
import { z } from "zod/v4";

const projectSchema = z.object({
  slug: z.string(),
  name: z.string(),
  currentPhase: z.string(),
  health: z.string(),
  lastActivityAt: z.string(),
  status: z.string(),
  githubRepo: z.string().nullable().optional(),
  unreadAuditCount: z.number().optional(),
  hasAdvisory: z.boolean().optional(),
  advisoryRead: z.boolean().optional(),
  currentRequest: z.string().nullable().optional(),
  progressScore: z.number().optional(),
});

const projectsArraySchema = z.array(projectSchema);

interface DispatchResultData {
  success: boolean;
  projectName: string;
  projectSlug: string;
  mode: string;
  prompt: string;
  ready: boolean;
  readyIssues: string[];
  error: string | null;
}

function ResumeAllButton({
  onResults,
}: {
  onResults: (results: DispatchResultData[]) => void;
}) {
  const [launching, setLaunching] = useState(false);

  async function handleResumeAll() {
    setLaunching(true);
    try {
      const res = await fetch("/api/dispatch/all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "continue" }),
      });
      const data = await res.json();
      if (res.ok && data.results) {
        onResults(data.results);
      }
    } catch {
      // handled
    } finally {
      setLaunching(false);
    }
  }

  return (
    <button
      onClick={handleResumeAll}
      disabled={launching}
      className={`px-4 py-2 text-sm font-mono uppercase tracking-wider border transition-all ${
        launching
          ? "border-space-500 text-space-500 cursor-wait"
          : "border-success text-success hover:bg-success/10 hover:shadow-[0_0_12px_rgba(100,212,118,0.15)]"
      }`}
    >
      {launching ? "Dispatching..." : "Resume All"}
    </button>
  );
}

function HarvestAllButton() {
  const [harvesting, setHarvesting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleHarvest() {
    setHarvesting(true);
    setResult(null);
    try {
      const res = await fetch("/api/knowledge/harvest-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok) {
        setResult(
          `Harvested ${data.totalLessons} lessons from ${data.totalProjects} projects`
        );
      } else {
        setResult(`Error: ${data.error}`);
      }
    } catch {
      setResult("Failed to harvest");
    } finally {
      setHarvesting(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={handleHarvest}
        disabled={harvesting}
        className={`px-4 py-2 text-sm font-mono uppercase tracking-wider border transition-all ${
          harvesting
            ? "border-space-500 text-space-500 cursor-wait"
            : "border-accent text-accent hover:bg-accent/10 hover:shadow-[0_0_12px_rgba(187,154,247,0.15)]"
        }`}
      >
        {harvesting ? "Harvesting..." : "Harvest All"}
      </button>
      {result && (
        <div className="absolute top-full right-0 mt-1 px-3 py-1.5 text-[10px] font-mono text-text bg-space-800 border border-space-600 whitespace-nowrap z-10">
          {result}
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="text-sm font-mono text-space-500">Loading...</div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectTileData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [dispatchResults, setDispatchResults] = useState<DispatchResultData[]>([]);

  // Initialize filters from URL params
  const [filters, setFilters] = useState<FilterState>({
    search: searchParams.get("q") || "",
    status: searchParams.get("status") || null,
    groupBy:
      (searchParams.get("group") as "none" | "status") || "none",
  });

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      const parsed = projectsArraySchema.safeParse(data);
      if (parsed.success) {
        setProjects(
          parsed.data.map((p): ProjectTileData => ({
            slug: p.slug,
            name: p.name,
            currentPhase: p.currentPhase,
            health: p.health,
            openDebtCount: 0,
            lastActivityAt: p.lastActivityAt,
            status: p.status,
            githubRepo: p.githubRepo || null,
            unreadAuditCount: p.unreadAuditCount || 0,
            hasAdvisory: p.hasAdvisory || false,
            advisoryRead: p.advisoryRead || false,
            currentRequest: p.currentRequest || undefined,
            progressScore: p.progressScore || 0,
          }))
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [refreshKey, fetchProjects]);

  // Request notification permission on first load
  useEffect(() => {
    requestNotificationPermission();
  }, []);

  // Auto-refresh when tab regains focus (debounced)
  useEffect(() => {
    let lastRefresh = Date.now();
    function handleVisibility() {
      if (document.visibilityState === "visible" && Date.now() - lastRefresh > 10_000) {
        lastRefresh = Date.now();
        fetchProjects();
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [fetchProjects]);

  // Sync filters to URL
  function handleFilterChange(newFilters: FilterState) {
    setFilters(newFilters);
    const params = new URLSearchParams();
    if (newFilters.search) params.set("q", newFilters.search);
    if (newFilters.status) params.set("status", newFilters.status);
    if (newFilters.groupBy !== "none")
      params.set("group", newFilters.groupBy);
    const query = params.toString();
    router.replace(query ? `/?${query}` : "/", { scroll: false });
  }

  // Apply filters
  const filtered = projects.filter((p) => {
    if (
      filters.search &&
      !p.name.toLowerCase().includes(filters.search.toLowerCase())
    ) {
      return false;
    }
    if (filters.status && p.status !== filters.status) {
      return false;
    }
    return true;
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold font-mono tracking-wide text-text-bright uppercase">
            Dashboard
          </h1>
          <p className="text-sm text-text font-mono mt-1">
            {projects.length} project{projects.length !== 1 ? "s" : ""}{" "}
            monitored
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ScanButton
            onScanComplete={() => setRefreshKey((k) => k + 1)}
          />
          <HarvestAllButton />
          <ResumeAllButton onResults={setDispatchResults} />
        </div>
      </div>

      <MorningBriefing />

      <DashboardFilters
        filters={filters}
        onChange={handleFilterChange}
      />

      {dispatchResults.length > 0 && (
        <DispatchResults
          results={dispatchResults}
          onDismiss={() => setDispatchResults([])}
        />
      )}

      {/* Overseer Chat */}
      <div className="mb-6">
        <OverseerChat onDispatch={(r) => setDispatchResults(r as DispatchResultData[])} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
        <ProjectGrid
          projects={filtered}
          loading={loading}
          groupBy={filters.groupBy}
        />
        <ActivityFeed />
      </div>
    </div>
  );
}
