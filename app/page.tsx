"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ScanButton } from "./components/scan-button";
import { ProjectGrid } from "./components/project-grid";
import {
  DashboardFilters,
  type FilterState,
} from "./components/dashboard-filters";
import { ActivityFeed } from "./components/activity-feed";
import type { ProjectTileData } from "./components/project-tile";

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
      if (Array.isArray(data)) {
        setProjects(
          data.map((p: Record<string, unknown>) => ({
            slug: p.slug as string,
            name: p.name as string,
            currentPhase: p.currentPhase as string,
            health: p.health as string,
            openDebtCount: 0,
            lastActivityAt: p.lastActivityAt as string,
            status: p.status as string,
            githubRepo: (p.githubRepo as string) || null,
            unreadAuditCount: (p.unreadAuditCount as number) || 0,
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
        <ScanButton
          onScanComplete={() => setRefreshKey((k) => k + 1)}
        />
      </div>

      <DashboardFilters
        filters={filters}
        onChange={handleFilterChange}
      />

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
