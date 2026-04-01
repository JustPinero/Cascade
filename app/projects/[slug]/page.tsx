"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { HealthIndicator } from "../../components/health-indicator";

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
