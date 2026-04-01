interface LessonCardProps {
  title: string;
  content: string;
  category: string;
  severity: string;
  sourceProject: string | null;
  sourcePhase: string | null;
  discoveredAt: string;
  tags: string[];
}

const severityConfig: Record<string, { color: string; label: string }> = {
  critical: { color: "text-danger border-danger/40", label: "CRITICAL" },
  important: { color: "text-amber border-amber/40", label: "IMPORTANT" },
  "nice-to-know": { color: "text-space-500 border-space-600", label: "INFO" },
};

export function LessonCard({
  title,
  content,
  severity,
  sourceProject,
  sourcePhase,
  discoveredAt,
  tags,
}: LessonCardProps) {
  const sev = severityConfig[severity] || severityConfig["nice-to-know"];
  const preview = content.split("\n")[0].slice(0, 120);

  return (
    <div className="p-4 border border-space-600 bg-space-800 hover:border-cyan-dim transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-sm font-bold font-mono text-text-bright">
          {title}
        </h3>
        <span
          className={`text-[10px] font-mono px-1.5 py-0.5 border ${sev.color} flex-shrink-0`}
        >
          {sev.label}
        </span>
      </div>

      <p className="text-xs font-mono text-text mb-3 line-clamp-2">
        {preview}
      </p>

      <div className="flex items-center gap-3 text-[10px] font-mono text-space-500">
        {sourceProject && <span>{sourceProject}</span>}
        {sourcePhase && (
          <span>{sourcePhase.replace(/-/g, " ")}</span>
        )}
        <span>{new Date(discoveredAt).toLocaleDateString()}</span>
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {tags.slice(0, 5).map((tag) => (
            <span
              key={tag}
              className="text-[10px] font-mono px-1.5 py-0.5 bg-space-700 text-info"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
