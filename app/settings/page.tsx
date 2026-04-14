"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "../components/theme-provider";
import {
  isNotificationSupported,
  getNotificationPreference,
  setNotificationPreference,
  requestNotificationPermission,
} from "@/lib/notify";
import {
  getOverseerSettings,
  setOverseerSettings,
} from "@/lib/overseer-settings";
import {
  getSoundPreference,
  setSoundPreference,
} from "@/lib/sounds";

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

function NotificationsPanel() {
  const [enabled, setEnabled] = useState(() => getNotificationPreference());
  const [supported] = useState(() => isNotificationSupported());
  const [permission, setPermission] = useState(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      return Notification.permission;
    }
    return "default";
  });

  async function handleToggle() {
    const newValue = !enabled;
    setEnabled(newValue);
    setNotificationPreference(newValue);
    if (newValue && permission !== "granted") {
      const granted = await requestNotificationPermission();
      setPermission(granted ? "granted" : "denied");
    }
  }

  if (!supported) {
    return (
      <div className="mb-8">
        <h2 className="text-sm font-mono font-bold text-cyan uppercase tracking-wider mb-4">
          Notifications
        </h2>
        <p className="text-xs font-mono text-space-500">
          Desktop notifications not supported in this browser.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-8">
      <h2 className="text-sm font-mono font-bold text-cyan uppercase tracking-wider mb-4">
        Notifications
      </h2>
      <div className="flex items-center justify-between p-3 border border-space-600 bg-space-800">
        <div>
          <span className="text-sm font-mono text-text-bright">
            Desktop Notifications
          </span>
          <p className="text-[10px] font-mono text-space-500 mt-0.5">
            {permission === "granted"
              ? "Get notified when sessions end, blockers are detected, or reminders trigger"
              : permission === "denied"
                ? "Browser notifications are blocked — enable in browser settings"
                : "Click to enable browser notification permission"}
          </p>
        </div>
        <button
          onClick={handleToggle}
          disabled={permission === "denied"}
          className={`w-10 h-5 rounded-full transition-colors relative ${
            enabled && permission === "granted"
              ? "bg-cyan"
              : "bg-space-600"
          } ${permission === "denied" ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <div
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              enabled && permission === "granted"
                ? "translate-x-5"
                : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
    </div>
  );
}

function SoundsPanel() {
  const [enabled, setEnabled] = useState(() => getSoundPreference());

  function handleToggle() {
    const newValue = !enabled;
    setEnabled(newValue);
    setSoundPreference(newValue);
  }

  return (
    <div className="flex items-center justify-between p-3 border border-space-600 bg-space-800 mt-2">
      <div>
        <span className="text-sm font-mono text-text-bright">
          Delamain Sound Effects
        </span>
        <p className="text-[10px] font-mono text-space-500 mt-0.5">
          Chimes when Delamain starts and finishes responding, alerts on blockers
        </p>
      </div>
      <button
        onClick={handleToggle}
        className={`w-10 h-5 rounded-full transition-colors relative ${
          enabled ? "bg-cyan" : "bg-space-600"
        }`}
      >
        <div
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
            enabled ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function AutomationPanel() {
  const [autoDispatch, setAutoDispatch] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("cascade-auto-dispatch") === "true";
  });

  function handleToggle() {
    const newValue = !autoDispatch;
    setAutoDispatch(newValue);
    localStorage.setItem("cascade-auto-dispatch", String(newValue));
  }

  return (
    <div className="mb-8">
      <h2 className="text-sm font-mono font-bold text-cyan uppercase tracking-wider mb-4">
        Automation
      </h2>
      <div className="flex items-center justify-between p-3 border border-space-600 bg-space-800">
        <div>
          <span className="text-sm font-mono text-text-bright">
            Auto-Dispatch (Continue)
          </span>
          <p className="text-[10px] font-mono text-space-500 mt-0.5">
            When Delamain suggests only &quot;continue&quot; on healthy
            projects, execute immediately without waiting for approval
          </p>
        </div>
        <button
          onClick={handleToggle}
          className={`w-10 h-5 rounded-full transition-colors relative ${
            autoDispatch ? "bg-cyan" : "bg-space-600"
          }`}
        >
          <div
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              autoDispatch ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
    </div>
  );
}

function OverseerPanel() {
  const [name, setName] = useState(() => getOverseerSettings().name);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setOverseerSettings({ name: name.trim() || "Overseer" });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="mb-8">
      <h2 className="text-sm font-mono font-bold text-cyan uppercase tracking-wider mb-4">
        Overseer Identity
      </h2>
      <div className="space-y-3">
        <div className="p-3 border border-space-600 bg-space-800">
          <label className="text-sm font-mono text-text-bright block mb-2">
            Name
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              placeholder="Overseer"
              className="flex-1 px-3 py-1.5 text-sm font-mono bg-space-900 border border-space-600 text-text-bright placeholder:text-space-500 focus:border-cyan focus:outline-none"
            />
            <button
              onClick={handleSave}
              className="px-3 py-1.5 text-xs font-mono border border-cyan text-cyan hover:bg-cyan/10 transition-colors"
            >
              {saved ? "Saved" : "Save"}
            </button>
          </div>
          <p className="text-[10px] font-mono text-space-500 mt-1">
            Your AI dispatcher&apos;s name. Appears in chat, sidebar, and briefings.
          </p>
        </div>
      </div>
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
        Customize Cascade
      </p>

      <OverseerPanel />

      <div className="divider-h mb-8" />

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

      <NotificationsPanel />
      <SoundsPanel />

      <div className="divider-h mb-8" />

      <AutomationPanel />

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
