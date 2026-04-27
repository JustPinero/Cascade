"use client";

import { useState } from "react";
import type { Orphan, RepairAction } from "@/lib/migration-repair";

type OrphanRow = Orphan & { recommendedAction: RepairAction };

const ACTION_LABELS: Record<RepairAction, string> = {
  clone: "Clone from GitHub",
  archive: "Archive",
  delete: "Delete from DB",
  skip: "Skip",
};

interface RowState {
  selectedAction: RepairAction;
  status: "idle" | "applying" | "done" | "error";
  message: string | null;
}

export function MigrateClient({ rows }: { rows: OrphanRow[] }) {
  const [rowStates, setRowStates] = useState<Record<number, RowState>>(
    Object.fromEntries(
      rows.map((r) => [r.id, { selectedAction: r.recommendedAction, status: "idle", message: null }])
    )
  );

  function setAction(id: number, action: RepairAction) {
    setRowStates((prev) => ({
      ...prev,
      [id]: { ...prev[id], selectedAction: action },
    }));
  }

  async function applyOne(id: number) {
    const { selectedAction } = rowStates[id];
    setRowStates((prev) => ({ ...prev, [id]: { ...prev[id], status: "applying", message: null } }));

    try {
      const res = await fetch("/api/projects/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply", id, repair: selectedAction }),
      });
      const data = await res.json() as { message?: string; error?: string };
      if (res.ok) {
        setRowStates((prev) => ({ ...prev, [id]: { ...prev[id], status: "done", message: data.message ?? "Done" } }));
      } else {
        setRowStates((prev) => ({ ...prev, [id]: { ...prev[id], status: "error", message: data.error ?? "Failed" } }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setRowStates((prev) => ({ ...prev, [id]: { ...prev[id], status: "error", message: msg } }));
    }
  }

  async function applyAll() {
    const pending = rows.filter((r) => rowStates[r.id].status === "idle");
    for (const row of pending) {
      await applyOne(row.id);
    }
  }

  const pendingCount = rows.filter((r) => rowStates[r.id].status === "idle").length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-space-400 font-mono">
          {rows.length} orphaned project{rows.length !== 1 ? "s" : ""}
        </span>
        <button
          onClick={applyAll}
          disabled={pendingCount === 0}
          className="px-4 py-2 text-sm font-mono uppercase tracking-wider border border-accent text-accent hover:bg-accent/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          Apply All Recommended ({pendingCount})
        </button>
      </div>

      <div className="space-y-3">
        {rows.map((row) => {
          const state = rowStates[row.id];
          const isDone = state.status === "done";
          const isError = state.status === "error";
          const isApplying = state.status === "applying";

          return (
            <div
              key={row.id}
              className={`border p-4 font-mono text-sm transition-all ${
                isDone ? "border-success/40 bg-success/5" :
                isError ? "border-error/40 bg-error/5" :
                "border-space-700 bg-space-900/30"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-space-100 font-semibold">{row.name}</span>
                    <span className="text-space-500 text-xs">({row.slug})</span>
                    <span className="text-xs border border-space-600 px-1 text-space-400">{row.status}</span>
                  </div>
                  <div className="text-space-500 text-xs truncate" title={row.oldPath}>
                    old: {row.oldPath}
                  </div>
                  <div className="text-space-400 text-xs">
                    suggested: {row.candidates.suggestedLocalPath}
                    {row.candidates.onDiskNow && (
                      <span className="ml-2 text-success">✓ already on disk</span>
                    )}
                  </div>
                  {row.candidates.githubRemote && (
                    <div className="text-xs text-accent truncate" title={row.candidates.githubRemote}>
                      remote: {row.candidates.githubRemote}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {!isDone && (
                    <>
                      <select
                        value={state.selectedAction}
                        onChange={(e) => setAction(row.id, e.target.value as RepairAction)}
                        disabled={isApplying}
                        className="bg-space-800 border border-space-600 text-space-200 px-2 py-1 text-xs font-mono"
                      >
                        {(["clone", "archive", "delete", "skip"] as RepairAction[]).map((a) => (
                          <option key={a} value={a}>
                            {ACTION_LABELS[a]}
                            {a === row.recommendedAction ? " ★" : ""}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => applyOne(row.id)}
                        disabled={isApplying}
                        className="px-3 py-1 text-xs border border-space-500 text-space-200 hover:border-accent hover:text-accent disabled:opacity-40 transition-all"
                      >
                        {isApplying ? "…" : "Apply"}
                      </button>
                    </>
                  )}
                  {isDone && (
                    <span className="text-success text-xs">✓ {state.message}</span>
                  )}
                  {isError && (
                    <span className="text-error text-xs" title={state.message ?? ""}>
                      ✗ {state.message}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
