"use client";

import { useTheme } from "../components/theme-provider";

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
