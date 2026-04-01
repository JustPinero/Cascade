"use client";

interface ErrorDisplayProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export function ErrorDisplay({ error, reset }: ErrorDisplayProps) {
  return (
    <div className="p-6 border border-danger/40 bg-space-800">
      <h2 className="text-sm font-mono font-bold text-danger uppercase tracking-wider mb-2">
        System Error
      </h2>
      <p className="text-xs font-mono text-text mb-4">
        {error.message || "An unexpected error occurred."}
      </p>
      <button
        onClick={reset}
        className="px-4 py-2 text-xs font-mono border border-cyan text-cyan hover:bg-cyan/10 transition-colors"
      >
        Retry
      </button>
    </div>
  );
}
