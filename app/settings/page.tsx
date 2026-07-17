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
import { speak, listVoices } from "@/lib/speak";
import { Portrait } from "@/app/components/portrait";

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
    description: "Cyberpunk dark — the original TenSixtyThree aesthetic",
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
  const [portraitIdle, setPortraitIdle] = useState(
    () => getOverseerSettings().portraitIdle
  );
  const [portraitTalking, setPortraitTalking] = useState(
    () => getOverseerSettings().portraitTalking ?? ""
  );
  const [usesTalkingFace, setUsesTalkingFace] = useState(
    () => getOverseerSettings().usesTalkingFace
  );
  const [saved, setSaved] = useState(false);

  function handleSave() {
    const trimmedTalking = portraitTalking.trim();
    setOverseerSettings({
      name: name.trim() || "Overseer",
      portraitIdle: portraitIdle.trim() || "/delamain.jpg",
      // Empty string clears it (single-face mode); non-empty stores it.
      portraitTalking: trimmedTalking ? trimmedTalking : null,
      usesTalkingFace,
    });
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
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder="Overseer"
            className="w-full px-3 py-1.5 text-sm font-mono bg-space-900 border border-space-600 text-text-bright placeholder:text-space-500 focus:border-cyan focus:outline-none"
          />
          <p className="text-[10px] font-mono text-space-500 mt-1">
            Your AI dispatcher&apos;s name. Appears in chat, sidebar, and briefings.
          </p>
        </div>

        <div className="p-3 border border-space-600 bg-space-800">
          <label className="text-sm font-mono text-text-bright block mb-2">
            Idle Portrait
          </label>
          <div className="flex gap-3 items-start">
            <div className="w-16 h-16 rounded border border-space-600 overflow-hidden bg-space-900 shrink-0">
              <Portrait
                src={portraitIdle}
                alt="idle preview"
                size="md"
                className="w-full h-full object-cover"
              />
            </div>
            <input
              type="text"
              value={portraitIdle}
              onChange={(e) => setPortraitIdle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              placeholder="/delamain.jpg"
              className="flex-1 px-3 py-1.5 text-sm font-mono bg-space-900 border border-space-600 text-text-bright placeholder:text-space-500 focus:border-cyan focus:outline-none"
            />
          </div>
          <p className="text-[10px] font-mono text-space-500 mt-1">
            Path or URL of the portrait shown when the Overseer is silent.
          </p>
        </div>

        <div className="p-3 border border-space-600 bg-space-800">
          <label className="flex items-center gap-3 cursor-pointer mb-2">
            <input
              type="checkbox"
              checked={usesTalkingFace}
              onChange={(e) => setUsesTalkingFace(e.target.checked)}
              className="accent-cyan"
            />
            <span className="text-sm font-mono text-text-bright">
              Use a talking portrait
            </span>
          </label>
          {usesTalkingFace ? (
            <>
              <div className="flex gap-3 items-start">
                <div className="w-16 h-16 rounded border border-space-600 overflow-hidden bg-space-900 shrink-0">
                  <Portrait
                    src={portraitTalking}
                    alt="talking preview"
                    size="md"
                    className="w-full h-full object-cover"
                  />
                </div>
                <input
                  type="text"
                  value={portraitTalking}
                  onChange={(e) => setPortraitTalking(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSave()}
                  placeholder="/delamain-talking.jpg"
                  className="flex-1 px-3 py-1.5 text-sm font-mono bg-space-900 border border-space-600 text-text-bright placeholder:text-space-500 focus:border-cyan focus:outline-none"
                />
              </div>
              <p className="text-[10px] font-mono text-space-500 mt-1">
                Shown while the Overseer is generating a response.
              </p>
            </>
          ) : (
            <p className="text-[10px] font-mono text-space-500">
              The idle portrait will be shown for both states.
            </p>
          )}
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            className="px-4 py-1.5 text-xs font-mono border border-cyan text-cyan hover:bg-cyan/10 transition-colors"
          >
            {saved ? "Saved" : "Save Identity"}
          </button>
        </div>
      </div>
    </div>
  );
}

function VoicePanel() {
  const [enabled, setEnabled] = useState(
    () => getOverseerSettings().voiceEnabled
  );
  const [voiceURI, setVoiceURI] = useState<string | null>(
    () => getOverseerSettings().voiceURI
  );
  const [rate, setRate] = useState(() => getOverseerSettings().voiceRate);
  const [pitch, setPitch] = useState(() => getOverseerSettings().voicePitch);
  const [silenceThresholdMs, setSilenceThresholdMs] = useState(
    () => getOverseerSettings().silenceThresholdMs
  );
  const [micMode, setMicMode] = useState<"toggle" | "push-to-talk">(
    () => getOverseerSettings().micMode
  );
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [saved, setSaved] = useState(false);

  // Some browsers populate the voice list asynchronously. Listen for
  // the voiceschanged event so the dropdown fills in once available.
  useEffect(() => {
    const refresh = () => setVoices(listVoices());
    refresh();
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.addEventListener("voiceschanged", refresh);
      return () => {
        window.speechSynthesis.removeEventListener("voiceschanged", refresh);
      };
    }
  }, []);

  function handleSave() {
    setOverseerSettings({
      voiceEnabled: enabled,
      voiceURI,
      voiceRate: rate,
      voicePitch: pitch,
      silenceThresholdMs,
      micMode,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleTest() {
    speak(
      "Delamain reporting in. Voice output is configured and ready.",
      {
        voiceEnabled: true,
        voiceURI,
        voiceRate: rate,
        voicePitch: pitch,
      }
    );
  }

  return (
    <div className="mb-8">
      <h2 className="text-sm font-mono font-bold text-cyan uppercase tracking-wider mb-4">
        Voice
      </h2>
      <div className="space-y-3">
        <div className="p-3 border border-space-600 bg-space-800">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="accent-cyan"
            />
            <span className="text-sm font-mono text-text-bright">
              Enable voice output
            </span>
          </label>
          <p className="text-[10px] font-mono text-space-500 mt-1 ml-6">
            Delamain speaks responses aloud after streaming completes.
            Uses your browser&apos;s built-in voices — no network call.
          </p>
        </div>

        <div className="p-3 border border-space-600 bg-space-800">
          <label className="text-sm font-mono text-text-bright block mb-2">
            Voice
          </label>
          <select
            value={voiceURI ?? ""}
            onChange={(e) =>
              setVoiceURI(e.target.value === "" ? null : e.target.value)
            }
            className="w-full px-3 py-1.5 text-sm font-mono bg-space-900 border border-space-600 text-text-bright focus:border-cyan focus:outline-none"
          >
            <option value="">Browser default</option>
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang})
                {v.localService ? " · local" : ""}
              </option>
            ))}
          </select>
          <p className="text-[10px] font-mono text-space-500 mt-1">
            Available voices come from your OS / browser. Quality and
            count vary by platform.
          </p>
        </div>

        <div className="p-3 border border-space-600 bg-space-800">
          <label className="text-sm font-mono text-text-bright block mb-2">
            Rate <span className="text-space-400">({rate.toFixed(2)}×)</span>
          </label>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.05"
            value={rate}
            onChange={(e) => setRate(parseFloat(e.target.value))}
            className="w-full accent-cyan"
          />
          <p className="text-[10px] font-mono text-space-500 mt-1">
            How fast Delamain speaks. 1.0 is normal speed.
          </p>
        </div>

        <div className="p-3 border border-space-600 bg-space-800">
          <label className="text-sm font-mono text-text-bright block mb-2">
            Pitch <span className="text-space-400">({pitch.toFixed(2)}×)</span>
          </label>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.05"
            value={pitch}
            onChange={(e) => setPitch(parseFloat(e.target.value))}
            className="w-full accent-cyan"
          />
          <p className="text-[10px] font-mono text-space-500 mt-1">
            Vocal pitch. 1.0 is the voice&apos;s natural tone.
          </p>
        </div>

        <div className="p-3 border border-space-600 bg-space-800">
          <label className="text-sm font-mono text-text-bright block mb-2">
            Mic Input Mode
          </label>
          <div className="space-y-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="mic-mode"
                value="toggle"
                checked={micMode === "toggle"}
                onChange={() => setMicMode("toggle")}
                className="accent-cyan"
              />
              <span className="text-xs font-mono text-text-bright">
                <span className="font-bold">Click to toggle</span> — click mic on, speak, click off, then Send
              </span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="mic-mode"
                value="push-to-talk"
                checked={micMode === "push-to-talk"}
                onChange={() => setMicMode("push-to-talk")}
                className="accent-cyan"
              />
              <span className="text-xs font-mono text-text-bright">
                <span className="font-bold">Hold to talk</span> — hold the mic button, release to auto-submit
              </span>
            </label>
          </div>
          <p className="text-[10px] font-mono text-space-500 mt-2">
            How the mic button behaves. Conversation Mode (chat-screen toggle) overrides this when active.
          </p>
        </div>

        <div className="p-3 border border-space-600 bg-space-800">
          <label className="text-sm font-mono text-text-bright block mb-2">
            Conversation Silence Threshold{" "}
            <span className="text-space-400">
              ({(silenceThresholdMs / 1000).toFixed(2)}s)
            </span>
          </label>
          <input
            type="range"
            min="500"
            max="4000"
            step="100"
            value={silenceThresholdMs}
            onChange={(e) =>
              setSilenceThresholdMs(parseInt(e.target.value, 10))
            }
            className="w-full accent-cyan"
          />
          <p className="text-[10px] font-mono text-space-500 mt-1">
            How long to wait after you stop speaking before Conversation Mode auto-submits. Shorter = snappier; longer = more pause-tolerant.
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={handleTest}
            className="px-3 py-1.5 text-xs font-mono border border-space-600 text-text hover:border-cyan hover:text-cyan transition-colors"
          >
            Test Voice
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-1.5 text-xs font-mono border border-cyan text-cyan hover:bg-cyan/10 transition-colors"
          >
            {saved ? "Saved" : "Save Voice"}
          </button>
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
        Customize TenSixtyThree
      </p>

      <OverseerPanel />

      <VoicePanel />

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
