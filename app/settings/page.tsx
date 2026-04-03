"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "../components/theme-provider";

interface AuthStatus {
  service: string;
  label: string;
  installed: boolean;
  authenticated: boolean;
  user: string | null;
  error: string | null;
}

const themes = [
  {
    id: "dark" as const,
    name: "Dark",
    description: "Cyberpunk dark — the original Cascade aesthetic",
    preview: ["#060910", "#111620", "#41a6b5", "#e0af68"],
  },
  {
    id: "light" as const,
    name: "Light",
    description: "Capsule Corp clean — bright with cyan accents",
    preview: ["#f0f2f5", "#ffffff", "#1a8a99", "#c49030"],
  },
];

function IntegrationsPanel() {
  const [statuses, setStatuses] = useState<AuthStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState<string | null>(null);

  const fetchStatuses = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/auth");
      const data = await res.json();
      if (Array.isArray(data)) setStatuses(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatuses();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogin(service: string) {
    setLaunching(service);
    try {
      await fetch("/api/integrations/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service }),
      });
      // Wait a moment then refresh statuses
      setTimeout(() => {
        fetchStatuses();
        setLaunching(null);
      }, 3000);
    } catch {
      setLaunching(null);
    }
  }

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-mono font-bold text-cyan uppercase tracking-wider">
          Integrations
        </h2>
        <button
          onClick={() => {
            setLoading(true);
            fetchStatuses();
          }}
          className="px-2 py-1 text-[10px] font-mono uppercase border border-space-600 text-space-400 hover:text-text hover:border-space-500 transition-colors"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-xs font-mono text-space-500">Checking CLI auth status...</p>
      ) : (
        <div className="space-y-2">
          {statuses.map((s) => (
            <div
              key={s.service}
              className="flex items-center justify-between p-3 border border-space-600 bg-space-800"
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-2 h-2 rounded-full ${
                    !s.installed
                      ? "bg-space-600"
                      : s.authenticated
                        ? "bg-success"
                        : "bg-amber"
                  }`}
                />
                <div>
                  <span className="text-sm font-mono text-text-bright">
                    {s.label}
                  </span>
                  <span className="text-xs font-mono text-space-500 ml-2">
                    {!s.installed
                      ? "not installed"
                      : s.authenticated
                        ? s.user || "authenticated"
                        : "not authenticated"}
                  </span>
                </div>
              </div>

              {s.installed && !s.authenticated && (
                <button
                  onClick={() => handleLogin(s.service)}
                  disabled={launching === s.service}
                  className={`px-3 py-1 text-xs font-mono border transition-colors ${
                    launching === s.service
                      ? "border-space-500 text-space-500 cursor-wait"
                      : "border-cyan text-cyan hover:bg-cyan/10"
                  }`}
                >
                  {launching === s.service ? "Opening..." : "Login"}
                </button>
              )}

              {s.installed && s.authenticated && (
                <span className="text-[10px] font-mono text-success uppercase tracking-wider">
                  Connected
                </span>
              )}

              {!s.installed && (
                <span className="text-[10px] font-mono text-space-500 uppercase tracking-wider">
                  Not Found
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="animate-fade-in">
      <h1 className="text-2xl font-bold font-mono tracking-wide text-text-bright uppercase mb-2 glow-text-cyan">
        Settings
      </h1>
      <p className="text-sm text-text font-mono mb-8">
        Customize Cascade&apos;s appearance
      </p>

      <div className="mb-8">
        <h2 className="text-sm font-mono font-bold text-cyan uppercase tracking-wider mb-4">
          Theme
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {themes.map((t) => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={`text-left p-4 border transition-all tile-3d ${
                theme === t.id
                  ? "border-cyan glow-border"
                  : "border-space-600 hover:border-space-500"
              }`}
              style={{ background: "var(--bg-panel)" }}
            >
              {/* Color preview */}
              <div className="flex gap-1.5 mb-3">
                {t.preview.map((color, i) => (
                  <div
                    key={i}
                    className="w-8 h-8 rounded-sm"
                    style={{
                      background: color,
                      boxShadow:
                        theme === t.id
                          ? `0 0 8px ${color}40`
                          : "none",
                    }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-mono font-bold text-text-bright">
                  {t.name}
                </span>
                {theme === t.id && (
                  <span className="text-[10px] font-mono text-cyan border border-cyan/40 px-1.5 py-0.5">
                    ACTIVE
                  </span>
                )}
              </div>
              <p className="text-xs font-mono text-text-dim">
                {t.description}
              </p>
            </button>
          ))}
        </div>
      </div>

      <div className="divider-h mb-8" />

      <IntegrationsPanel />

      <div className="divider-h mb-8" />

      <div>
        <h2 className="text-sm font-mono font-bold text-cyan uppercase tracking-wider mb-4">
          About
        </h2>
        <div className="space-y-2 text-xs font-mono text-text">
          <p>
            <span className="text-text-dim">Version:</span>{" "}
            <span className="text-text-bright">Delamain v1</span>
          </p>
          <p>
            <span className="text-text-dim">Engine:</span>{" "}
            Next.js + Prisma + SQLite
          </p>
          <p>
            <span className="text-text-dim">AI:</span>{" "}
            Anthropic Claude API
          </p>
        </div>
      </div>
    </div>
  );
}
