"use client";

interface DispatchResult {
  success: boolean;
  projectName: string;
  projectSlug: string;
  mode: string;
  prompt: string;
  ready: boolean;
  readyIssues: string[];
  error: string | null;
}

interface DispatchResultsProps {
  results: DispatchResult[];
  onDismiss: () => void;
}

export function DispatchResults({ results, onDismiss }: DispatchResultsProps) {
  if (results.length === 0) return null;

  const launched = results.filter((r) => r.success).length;
  const skipped = results.filter((r) => r.ready === false).length;
  const failed = results.filter((r) => r.ready !== false && !r.success).length;

  return (
    <div className="mb-6 border border-space-600 bg-space-800">
      <div className="flex items-center justify-between px-4 py-2 border-b border-space-600">
        <div className="flex items-center gap-4 text-xs font-mono">
          <span className="text-cyan uppercase tracking-wider font-bold">
            Dispatch Report
          </span>
          <span className="text-success">{launched} launched</span>
          {skipped > 0 && (
            <span className="text-amber">{skipped} not ready</span>
          )}
          {failed > 0 && (
            <span className="text-danger">{failed} failed</span>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="text-[10px] font-mono text-space-500 hover:text-text transition-colors"
        >
          Dismiss
        </button>
      </div>

      <div className="max-h-64 overflow-y-auto">
        {results.map((r, i) => (
          <div
            key={i}
            className={`flex items-start gap-3 px-4 py-2 text-xs font-mono border-b border-space-700 last:border-b-0 ${
              !r.ready ? "opacity-60" : ""
            }`}
          >
            {/* Status icon */}
            <span
              className={`flex-shrink-0 mt-0.5 ${
                r.success
                  ? "text-success"
                  : !r.ready
                    ? "text-amber"
                    : "text-danger"
              }`}
            >
              {r.success ? ">" : !r.ready ? "?" : "X"}
            </span>

            {/* Project name */}
            <span className="text-text-bright w-28 flex-shrink-0 truncate">
              {r.projectName}
            </span>

            {/* Details */}
            <div className="flex-1 min-w-0">
              {r.success && (
                <p className="text-text truncate" title={r.prompt}>
                  {r.prompt}
                </p>
              )}
              {!r.ready && r.readyIssues && (
                <div className="text-amber">
                  {r.readyIssues.map((issue, j) => (
                    <p key={j}>- {issue}</p>
                  ))}
                </div>
              )}
              {!r.ready && !r.readyIssues && r.error && (
                <p className="text-amber">{r.error}</p>
              )}
              {r.ready !== false && !r.success && (
                <p className="text-danger">{r.error}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
