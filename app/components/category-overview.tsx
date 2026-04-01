import Link from "next/link";

interface CategoryOverviewProps {
  categories: { name: string; count: number; recent: string | null }[];
}

const categoryIcons: Record<string, string> = {
  deployment: ">>",
  auth: "##",
  database: "[]",
  performance: "%%",
  testing: "()",
  "error-handling": "!!",
  integrations: "<>",
  "anti-patterns": "XX",
  architecture: "//",
  tooling: "$$",
};

export function CategoryOverview({ categories }: CategoryOverviewProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {categories.map((cat) => (
        <Link
          key={cat.name}
          href={`/knowledge/${cat.name}`}
          className="group p-3 border border-space-600 bg-space-800 hover:border-cyan-dim transition-colors"
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-mono text-cyan">
              {categoryIcons[cat.name] || "??"}
            </span>
            <span className="text-xs font-mono font-bold text-text-bright group-hover:text-cyan transition-colors">
              {cat.name}
            </span>
          </div>
          <div className="text-lg font-mono font-bold text-text-bright">
            {cat.count}
          </div>
          {cat.recent && (
            <p className="text-[10px] font-mono text-space-500 truncate mt-1">
              Latest: {cat.recent}
            </p>
          )}
        </Link>
      ))}
    </div>
  );
}
