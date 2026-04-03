"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { HealthIndicator } from "../../components/health-indicator";
import { CommandPanel } from "../../components/command-panel";

interface Project {
  id: number;
  name: string;
  slug: string;
  path: string;
  status: string;
  health: string;
  currentPhase: string;
  githubRepo: string | null;
  autonomyMode: string;
  healthDetails: string;
  stack: string;
  auditSnapshots: { id: number; auditType: string; grade: string | null; capturedAt: string }[];
  activityEvents: { id: number; eventType: string; summary: string; createdAt: string }[];
}

interface EnvStatus {
  authenticated: boolean;
  vars: { name: string; expected: boolean; inVault: boolean }[];
}

function DispatchPanel({
  slug,
  health,
  onAction,
}: {
  slug: string;
  health: string;
  onAction: () => void;
}) {
  const [dispatching, setDispatching] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState("");

  async function dispatch(mode: string, prompt?: string) {
    setDispatching(mode);
    setResult(null);
    try {
      const res = await fetch(`/api/projects/${slug}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, prompt }),
      });
      const data = await res.json();
      if (data.success) {
        setResult(`Launched: ${mode} mode`);
        onAction();
      } else {
        setResult(`Failed: ${data.error}`);
      }
    } catch {
      setResult("Failed to dispatch");
    } finally {
      setDispatching(null);
    }
  }

  return (
    <div className="mb-6 p-4 border border-space-600 bg-space-800">
      <h2 className="text-sm font-mono font-bold text-cyan uppercase tracking-wider mb-3">
        Dispatch Claude
      </h2>
      <div className="flex flex-wrap gap-2 mb-3">
        <button
          onClick={() => dispatch("continue")}
          disabled={dispatching !== null}
          className="px-3 py-1.5 text-xs font-mono border border-cyan text-cyan hover:bg-cyan/10 disabled:opacity-50 transition-colors"
        >
          {dispatching === "continue" ? "Launching..." : "Continue Build"}
        </button>
        <button
          onClick={() => dispatch("audit")}
          disabled={dispatching !== null}
          className="px-3 py-1.5 text-xs font-mono border border-accent text-accent hover:bg-accent/10 disabled:opacity-50 transition-colors"
        >
          {dispatching === "audit" ? "Launching..." : "Run Audits"}
        </button>
        {health === "blocked" && (
          <button
            onClick={() => dispatch("investigate")}
            disabled={dispatching !== null}
            className="px-3 py-1.5 text-xs font-mono border border-amber text-amber hover:bg-amber/10 disabled:opacity-50 transition-colors"
          >
            {dispatching === "investigate"
              ? "Launching..."
              : "Investigate Blocker"}
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && customPrompt.trim()) {
              dispatch("custom", customPrompt);
            }
          }}
          placeholder="Custom command..."
          className="flex-1 px-3 py-1.5 text-xs font-mono bg-space-900 border border-space-600 text-text-bright placeholder:text-space-500 focus:border-info focus:outline-none"
        />
        <button
          onClick={() => dispatch("custom", customPrompt)}
          disabled={dispatching !== null || !customPrompt.trim()}
          className="px-3 py-1.5 text-xs font-mono border border-info text-info hover:bg-info/10 disabled:opacity-50 transition-colors"
        >
          Send
        </button>
      </div>
      {result && (
        <p className="text-xs font-mono text-text mt-2">{result}</p>
      )}
    </div>
  );
}

function DeployStatusPanel({ project }: { project: Project }) {
  const [deployStatus, setDeployStatus] = useState<{
    platform: string;
    state: string;
    url: string | null;
  } | null>(null);

  useEffect(() => {
    let stack: { deployPlatform?: string; deployProjectId?: string } = {};
    try {
      stack = JSON.parse(project.stack);
    } catch {
      return;
    }
    if (!stack.deployPlatform || !stack.deployProjectId) return;

    fetch(
      `/api/integrations/deploy-status?platform=${stack.deployPlatform}&projectId=${stack.deployProjectId}`
    )
      .then((res) => res.json())
      .then((data) => {
        if (data.platform) setDeployStatus(data);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!deployStatus) return null;

  const stateColors: Record<string, string> = {
    deployed: "text-success",
    building: "text-amber",
    failed: "text-danger",
    unknown: "text-space-500",
  };

  return (
    <div className="p-4 border border-space-600 bg-space-800 space-y-3">
      <h2 className="text-sm font-mono font-bold text-cyan uppercase tracking-wider">
        Deployment
      </h2>
      <div className="space-y-2 text-xs font-mono">
        <div className="flex justify-between">
          <span className="text-space-500">Platform</span>
          <span className="text-text">{deployStatus.platform}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-space-500">Status</span>
          <span className={stateColors[deployStatus.state] || "text-text"}>
            {deployStatus.state}
          </span>
        </div>
        {deployStatus.url && (
          <div className="flex justify-between">
            <span className="text-space-500">URL</span>
            <span className="text-info truncate ml-2">{deployStatus.url}</span>
          </div>
        )}
      </div>
    </div>
  );
}

interface WorkRequest {
  number: string;
  title: string;
  filename: string;
  status: "done" | "current" | "upcoming";
}

interface WorkPhase {
  name: string;
  label: string;
  isCurrent: boolean;
  requests: WorkRequest[];
}

interface RemainingWorkData {
  type: "phased" | "flat" | "empty";
  phases: WorkPhase[];
  totalRequests: number;
  completedRequests: number;
  remainingRequests: number;
}

function RemainingWorkPanel({ slug }: { slug: string }) {
  const [work, setWork] = useState<RemainingWorkData | null>(null);
  const [expandedPhase, setExpandedPhase] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`/api/projects/${slug}/work`)
      .then((res) => res.json())
      .then((data) => {
        if (data.phases) {
          setWork(data);
          // Auto-expand current phase
          const current = data.phases.find(
            (p: WorkPhase) => p.isCurrent
          );
          if (current) setExpandedPhase(current.name);
        }
      })
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!loaded) {
    return (
      <div className="p-4 border border-space-600 bg-space-800">
        <p className="text-xs font-mono text-space-500">Loading...</p>
      </div>
    );
  }

  if (!work || work.type === "empty" || work.phases.length === 0) {
    return (
      <div className="p-4 border border-space-600 bg-space-800 space-y-3">
        <h2 className="text-sm font-mono font-bold text-cyan uppercase tracking-wider">
          Remaining Work
        </h2>
        <p className="text-xs font-mono text-space-500">
          No requests found
        </p>
      </div>
    );
  }

  const statusIcon = (status: WorkRequest["status"]) => {
    switch (status) {
      case "done":
        return <span className="text-success">&#10003;</span>;
      case "current":
        return <span className="text-cyan">&#8594;</span>;
      case "upcoming":
        return <span className="text-space-600">&middot;</span>;
    }
  };

  const statusColor = (status: WorkRequest["status"]) => {
    switch (status) {
      case "done":
        return "text-space-500 line-through";
      case "current":
        return "text-cyan font-bold";
      case "upcoming":
        return "text-text";
    }
  };

  return (
    <div className="p-4 border border-space-600 bg-space-800 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-mono font-bold text-cyan uppercase tracking-wider">
          Remaining Work
        </h2>
        <span className="text-[10px] font-mono text-space-400">
          {work.completedRequests}/{work.totalRequests} done
          {work.remainingRequests > 0 &&
            ` \u2022 ${work.remainingRequests} remaining`}
        </span>
      </div>

      <div className="space-y-1">
        {work.phases.map((phase) => {
          const isExpanded = expandedPhase === phase.name;
          const doneCount = phase.requests.filter(
            (r) => r.status === "done"
          ).length;

          return (
            <div key={phase.name}>
              <button
                onClick={() =>
                  setExpandedPhase(isExpanded ? null : phase.name)
                }
                className={`w-full text-left px-2 py-1.5 flex items-center justify-between text-xs font-mono transition-colors hover:bg-space-700/50 ${
                  phase.isCurrent
                    ? "border-l-2 border-cyan"
                    : "border-l-2 border-transparent"
                }`}
              >
                <span
                  className={
                    phase.isCurrent ? "text-cyan" : "text-text"
                  }
                >
                  {phase.label}
                </span>
                <span className="text-space-500">
                  {doneCount}/{phase.requests.length}
                </span>
              </button>

              {isExpanded && (
                <div className="ml-4 space-y-0.5 pb-2">
                  {phase.requests.map((req) => (
                    <div
                      key={req.filename}
                      className="flex items-center gap-2 px-2 py-0.5 text-xs font-mono"
                    >
                      <span className="w-4 text-center">
                        {statusIcon(req.status)}
                      </span>
                      <span className="text-space-500 w-8">
                        {req.number}
                      </span>
                      <span className={statusColor(req.status)}>
                        {req.title}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface SessionLogEntry {
  filename: string;
  timestamp: string;
  content: string;
  summary: string;
}

function SessionHistoryPanel({ slug }: { slug: string }) {
  const [sessions, setSessions] = useState<SessionLogEntry[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`/api/projects/${slug}/sessions?limit=10`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setSessions(data);
      })
      .finally(() => setLoaded(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-4 border border-space-600 bg-space-800 space-y-3">
      <h2 className="text-sm font-mono font-bold text-cyan uppercase tracking-wider">
        Session History
      </h2>
      {!loaded ? (
        <p className="text-xs font-mono text-space-500">Loading...</p>
      ) : sessions.length === 0 ? (
        <p className="text-xs font-mono text-space-500">No sessions recorded yet</p>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <div key={s.filename} className="border border-space-700">
              <button
                onClick={() =>
                  setExpanded(expanded === s.filename ? null : s.filename)
                }
                className="w-full text-left px-3 py-2 flex items-center justify-between hover:bg-space-700/50 transition-colors"
              >
                <span className="text-xs font-mono text-info">
                  {s.timestamp.replace("T", " ")}
                </span>
                <span className="text-[10px] font-mono text-space-500">
                  {expanded === s.filename ? "collapse" : "expand"}
                </span>
              </button>
              {expanded === s.filename ? (
                <pre className="px-3 pb-3 text-xs font-mono text-text whitespace-pre-wrap max-h-64 overflow-auto">
                  {s.content}
                </pre>
              ) : (
                <p className="px-3 pb-2 text-xs font-mono text-space-400 truncate">
                  {s.summary.replace(/^#.*\n/gm, "").trim().slice(0, 120)}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProjectDetailPage() {
  const params = useParams();
  const slug = params.slug as string;
  const [project, setProject] = useState<Project | null>(null);
  const [envStatus, setEnvStatus] = useState<EnvStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProject = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${slug}`);
      if (res.ok) {
        const data = await res.json();
        setProject(data);

        // Fetch env status
        const envRes = await fetch(
          `/api/integrations/onepassword?path=${encodeURIComponent(data.path)}&name=${encodeURIComponent(data.name)}`
        );
        if (envRes.ok) {
          setEnvStatus(await envRes.json());
        }
      }
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchProject();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return <div className="text-sm font-mono text-space-500">Loading...</div>;
  }

  if (!project) {
    return (
      <div className="text-sm font-mono text-danger">Project not found.</div>
    );
  }

  return (
    <div>
      <Link
        href="/"
        className="text-xs font-mono text-cyan hover:text-text-bright transition-colors"
      >
        &larr; Dashboard
      </Link>

      <div className="flex items-center gap-4 mt-4 mb-6">
        <HealthIndicator health={project.health} size="lg" />
        <div>
          <h1 className="text-2xl font-bold font-mono text-text-bright">
            {project.name}
          </h1>
          <p className="text-xs font-mono text-space-500">{project.path}</p>
        </div>
      </div>

      {/* Dispatch Actions */}
      <DispatchPanel slug={slug} health={project.health} onAction={fetchProject} />

      {/* Command Panel */}
      <div className="mb-6">
        <CommandPanel projectSlug={slug} projectName={project.name} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Info Panel */}
        <div className="p-4 border border-space-600 bg-space-800 space-y-3">
          <h2 className="text-sm font-mono font-bold text-cyan uppercase tracking-wider">
            Project Info
          </h2>
          <div className="space-y-2 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-space-500">Status</span>
              <span className="text-text-bright">{project.status}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-space-500">Phase</span>
              <span className="text-text">{project.currentPhase}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-space-500">Autonomy</span>
              <span className="text-text">{project.autonomyMode}</span>
            </div>
            {project.githubRepo && (
              <div className="flex justify-between">
                <span className="text-space-500">GitHub</span>
                <span className="text-info">{project.githubRepo}</span>
              </div>
            )}
          </div>
        </div>

        {/* Env Status */}
        <div className="p-4 border border-space-600 bg-space-800 space-y-3">
          <h2 className="text-sm font-mono font-bold text-cyan uppercase tracking-wider">
            Environment Variables
          </h2>
          {!envStatus ? (
            <p className="text-xs font-mono text-space-500">Loading...</p>
          ) : !envStatus.authenticated ? (
            <p className="text-xs font-mono text-amber">
              1Password CLI not authenticated
            </p>
          ) : envStatus.vars.length === 0 ? (
            <p className="text-xs font-mono text-space-500">
              No .env.example found
            </p>
          ) : (
            <div className="space-y-1">
              {envStatus.vars.map((v) => (
                <div
                  key={v.name}
                  className="flex items-center justify-between text-xs font-mono"
                >
                  <span className="text-text">{v.name}</span>
                  <span
                    className={
                      v.inVault ? "text-success" : "text-danger"
                    }
                  >
                    {v.inVault ? "in vault" : "missing"}
                  </span>
                </div>
              ))}
              {envStatus.vars.some((v) => !v.inVault) && (
                <button
                  onClick={async () => {
                    await fetch("/api/integrations/onepassword", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "populate",
                        projectPath: project.path,
                        projectName: project.name,
                      }),
                    });
                    fetchProject();
                  }}
                  className="mt-2 px-3 py-1.5 text-xs font-mono border border-cyan text-cyan hover:bg-cyan/10 transition-colors"
                >
                  Populate .env.local
                </button>
              )}
            </div>
          )}
        </div>

        {/* Audit History */}
        <div className="p-4 border border-space-600 bg-space-800 space-y-3">
          <h2 className="text-sm font-mono font-bold text-cyan uppercase tracking-wider">
            Audit History
          </h2>
          {project.auditSnapshots.length === 0 ? (
            <p className="text-xs font-mono text-space-500">No audits yet</p>
          ) : (
            <div className="space-y-1">
              {project.auditSnapshots.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between text-xs font-mono"
                >
                  <span className="text-text">{a.auditType}</span>
                  <div className="flex gap-3">
                    <span className="text-info">{a.grade || "—"}</span>
                    <span className="text-space-500">
                      {new Date(a.capturedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Remaining Work */}
        <RemainingWorkPanel slug={slug} />

        {/* Session History */}
        <SessionHistoryPanel slug={slug} />

        {/* Deploy Status */}
        <DeployStatusPanel project={project} />

        {/* Activity */}
        <div className="p-4 border border-space-600 bg-space-800 space-y-3">
          <h2 className="text-sm font-mono font-bold text-cyan uppercase tracking-wider">
            Recent Activity
          </h2>
          {project.activityEvents.length === 0 ? (
            <p className="text-xs font-mono text-space-500">No activity yet</p>
          ) : (
            <div className="space-y-1">
              {project.activityEvents.slice(0, 10).map((e) => (
                <div key={e.id} className="text-xs font-mono">
                  <span className="text-space-500">
                    [{e.eventType}]
                  </span>{" "}
                  <span className="text-text">{e.summary}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
