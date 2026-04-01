"use client";

import { useCallback, useEffect, useState } from "react";

interface Project {
  id: number;
  name: string;
  slug: string;
  path: string;
  status: string;
  health: string;
  currentPhase: string;
}

interface ProjectListProps {
  refreshKey: number;
}

const healthColors: Record<string, string> = {
  healthy: "bg-success",
  warning: "bg-amber",
  blocked: "bg-danger",
  idle: "bg-space-500",
};

export function ProjectList({ refreshKey }: ProjectListProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      if (Array.isArray(data)) {
        setProjects(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [refreshKey, fetchProjects]);

  if (loading) {
    return (
      <div className="mt-8 p-6 border border-space-600 bg-space-800">
        <p className="text-sm text-space-500 font-mono">Loading projects...</p>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="mt-8 p-6 border border-space-600 bg-space-800 glow-border">
        <p className="text-sm text-text font-mono">
          No projects imported yet. Click &quot;Scan Projects&quot; to detect projects in
          your workspace.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-2">
      {projects.map((project) => (
        <div
          key={project.id}
          className="flex items-center gap-4 p-4 border border-space-600 bg-space-800 hover:border-cyan-dim transition-colors"
        >
          <div
            className={`w-2.5 h-2.5 rounded-full ${healthColors[project.health] || healthColors.idle}`}
          />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold font-mono text-text-bright truncate">
              {project.name}
            </h3>
            <p className="text-xs font-mono text-space-500 truncate">
              {project.path}
            </p>
          </div>
          <span className="text-xs font-mono text-text px-2 py-1 border border-space-600 uppercase">
            {project.status}
          </span>
          <span className="text-xs font-mono text-info">
            {project.currentPhase}
          </span>
        </div>
      ))}
    </div>
  );
}
