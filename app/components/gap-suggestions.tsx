interface GapSuggestion {
  category: string;
  count: number;
  suggestion: string;
  priority: "high" | "medium" | "low";
}

interface GapSuggestionsProps {
  suggestions: GapSuggestion[];
}

const priorityColors = {
  high: "border-danger/40 text-danger",
  medium: "border-amber/40 text-amber",
  low: "border-info/40 text-info",
};

export function GapSuggestions({ suggestions }: GapSuggestionsProps) {
  if (suggestions.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-mono uppercase tracking-widest text-accent">
        Knowledge Gaps
      </h3>
      {suggestions.map((s) => (
        <div
          key={s.category}
          className={`p-2 border text-xs font-mono ${priorityColors[s.priority]}`}
        >
          <span className="text-[10px] uppercase">[{s.priority}]</span>{" "}
          {s.suggestion}
        </div>
      ))}
    </div>
  );
}
