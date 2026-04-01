"use client";

import { useCallback, useEffect, useState } from "react";

export default function PlaybookPage() {
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchPlaybook = useCallback(async () => {
    try {
      const res = await fetch("/api/playbook");
      const data = await res.json();
      setContent(data.content || "");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlaybook();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    await fetch("/api/playbook", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (loading) {
    return <div className="text-sm font-mono text-space-500">Loading...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold font-mono tracking-wide text-text-bright uppercase">
            Overseer Playbook
          </h1>
          <p className="text-sm text-text font-mono mt-1">
            Rules that shape every dispatched Claude session. Edit these to train
            the overseer.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="text-xs font-mono text-success">Saved</span>
          )}
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm font-mono border border-cyan text-cyan hover:bg-cyan/10 transition-colors"
          >
            Save Playbook
          </button>
        </div>
      </div>

      <div className="mb-4 p-3 border border-space-600 bg-space-800 text-xs font-mono text-text space-y-1">
        <p className="text-cyan">How this works:</p>
        <p>
          - Every line starting with &quot;-&quot; becomes a rule in Claude&apos;s dispatch
          prompt
        </p>
        <p>
          - Add project-specific overrides under &quot;## Project-Specific
          Overrides&quot;
        </p>
        <p>
          - Changes take effect on the next dispatch — no restart needed
        </p>
        <p>
          - Use the Command Panel on any project to test how Claude follows
          these rules
        </p>
      </div>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="w-full h-[500px] px-4 py-3 text-sm font-mono bg-space-900 border border-space-600 text-text-bright focus:border-cyan focus:outline-none resize-none leading-relaxed"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "s") {
            e.preventDefault();
            handleSave();
          }
        }}
      />
    </div>
  );
}
