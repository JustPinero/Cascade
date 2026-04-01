import Link from "next/link";
import { HealthIndicator } from "./health-indicator";

export interface ProjectTileData {
  slug: string;
  name: string;
  currentPhase: string;
  health: string;
  openDebtCount: number;
  lastActivityAt: string;
  status: string;
  githubRepo: string | null;
}

interface ProjectTileProps {
  project: ProjectTileData;
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function ProjectTile({ project }: ProjectTileProps) {
  const borderColor =
    project.health === "blocked"
      ? "border-danger/40"
      : project.health === "warning"
        ? "border-amber/30"
        : project.health === "healthy"
          ? "border-cyan/20"
          : "border-space-600";

  return (
    <Link
      href={`/projects/${project.slug}`}
      className={`
        group block p-4 border bg-space-800
        transition-all duration-200 hover:glow-border
        hover:border-cyan/40 hover:bg-space-700/50
        ${borderColor}
      `}
    >
      {/* Header: name + health */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold font-mono text-text-bright truncate pr-2 group-hover:text-cyan transition-colors">
          {project.name}
        </h3>
        <HealthIndicator health={project.health} size="md" />
      </div>

      {/* Phase */}
      <div className="mb-3">
        <span className="text-xs font-mono text-info">
          {project.currentPhase.replace(/-/g, " ").replace(/phase /, "P")}
        </span>
      </div>

      {/* Footer: debt count + last activity */}
      <div className="flex items-center justify-between text-xs font-mono">
        <span
          className={
            project.openDebtCount > 0 ? "text-amber" : "text-space-500"
          }
        >
          {project.openDebtCount > 0
            ? `${project.openDebtCount} debt`
            : "no debt"}
        </span>
        <span className="text-space-500">
          {formatTimeAgo(project.lastActivityAt)}
        </span>
      </div>

      {/* Status badge */}
      <div className="mt-3 pt-3 border-t border-space-600/50">
        <span className="text-[10px] font-mono uppercase tracking-widest text-space-500">
          {project.status}
        </span>
      </div>
    </Link>
  );
}
