import Link from "next/link";
import { HealthIndicator } from "./health-indicator";
import { AdvisoryBadge } from "./advisory-badge";
import { BADGE_STYLES, type Badge } from "@/lib/badges";
import { getCompletionDisplay } from "@/lib/project-display";

export interface ProjectTileData {
  slug: string;
  name: string;
  currentPhase: string;
  health: string;
  openDebtCount: number;
  lastActivityAt: string;
  status: string;
  githubRepo: string | null;
  unreadAuditCount?: number;
  hasAdvisory?: boolean;
  advisoryRead?: boolean;
  currentRequest?: string;
  progressScore?: number;
  badges?: string;
  pendingHumanTasks?: number;
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
  const isDeployed = project.status === "deployed";
  const hasActiveSession = project.currentRequest?.includes("dispatched");

  // Parse badges once
  let parsedBadges: string[] = [];
  try {
    parsedBadges = JSON.parse(project.badges || "[]");
  } catch {
    // ignore
  }

  const tileClass = isDeployed
    ? "glow-deployed"
    : hasActiveSession
      ? "pulse-session"
      : project.health === "blocked"
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
        group block p-4 border bg-space-800 tile-3d
        transition-all duration-200 hover:glow-border
        hover:border-cyan/40 hover:bg-space-700/50
        ${tileClass}
      `}
    >
      {/* Header: name + health */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold font-mono text-text-bright truncate pr-2 group-hover:text-cyan transition-colors">
          {project.name}
        </h3>
        <div className="flex items-center gap-2">
          {project.unreadAuditCount && project.unreadAuditCount > 0 ? (
            <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-mono font-bold bg-accent/20 text-accent border border-accent/40 rounded-full pulse-warning">
              {project.unreadAuditCount}
            </span>
          ) : null}
          <AdvisoryBadge
            hasAdvisory={project.hasAdvisory || false}
            isRead={project.advisoryRead || false}
          />
          <HealthIndicator health={project.health} size="md" />
        </div>
      </div>

      {/* Phase + Progress (Phase 19.1 — status-aware) */}
      <div className="mb-3">
        {(() => {
          const display = getCompletionDisplay({
            status: project.status,
            progressScore: project.progressScore,
          });
          if (display.kind === "shipped") {
            return (
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-info">
                  {project.currentPhase.replace(/-/g, " ").replace(/phase /, "P")}
                </span>
                <span
                  className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 border border-success/40 bg-success/10 text-success"
                  title={`Phase progress score: ${display.score}%`}
                >
                  ✓ {display.label}
                </span>
              </div>
            );
          }
          return (
            <>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-mono text-info">
                  {project.currentPhase.replace(/-/g, " ").replace(/phase /, "P")}
                </span>
                <span className="text-[10px] font-mono text-space-400">
                  {display.score}%
                </span>
              </div>
              <div className="w-full h-1 bg-space-700 overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    display.score >= 75
                      ? "bg-success"
                      : display.score >= 40
                        ? "bg-cyan"
                        : display.score > 0
                          ? "bg-amber"
                          : "bg-space-600"
                  }`}
                  style={{ width: `${display.score}%` }}
                />
              </div>
            </>
          );
        })()}
      </div>

      {/* Badges */}
      {parsedBadges.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {parsedBadges.map((badge) => {
            const style = BADGE_STYLES[badge as Badge];
            if (!style) return null;
            return (
              <span
                key={badge}
                className={`text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 border ${style.color}`}
              >
                {style.label}
              </span>
            );
          })}
        </div>
      )}

      {/* Blocked-on-human indicator */}
      {(project.pendingHumanTasks ?? 0) > 0 && (
        <div className="text-[10px] font-mono text-amber mb-2">
          {project.pendingHumanTasks} task{(project.pendingHumanTasks ?? 0) > 1 ? "s" : ""} waiting on you
        </div>
      )}

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
      <div className="mt-3 pt-3 border-t border-space-600/50 flex items-center justify-between">
        <span
          className={`text-[10px] font-mono uppercase tracking-widest ${
            isDeployed
              ? "text-amber"
              : hasActiveSession
                ? "text-cyan"
                : "text-space-500"
          }`}
        >
          {isDeployed
            ? "deployed"
            : hasActiveSession
              ? "claude active"
              : project.status}
        </span>
        {project.currentRequest && !hasActiveSession && (
          <span className="text-[10px] font-mono text-info">
            {project.currentRequest}
          </span>
        )}
      </div>
    </Link>
  );
}
