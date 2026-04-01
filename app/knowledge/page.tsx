"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CategoryOverview } from "../components/category-overview";
import { GapSuggestions } from "../components/gap-suggestions";
import { LessonCard } from "../components/lesson-card";

interface Lesson {
  id: number;
  title: string;
  content: string;
  category: string;
  severity: string;
  tags: string;
  discoveredAt: string;
  sourcePhase: string | null;
  sourceProject: { name: string; slug: string } | null;
}

export default function KnowledgePage() {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [searchResults, setSearchResults] = useState<Lesson[] | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [gaps, setGaps] = useState<{ category: string; count: number; suggestion: string; priority: "high" | "medium" | "low" }[]>([]);
  const [loading, setLoading] = useState(true);
  const [harvesting, setHarvesting] = useState(false);
  const [harvestResult, setHarvestResult] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchLessons = useCallback(async () => {
    try {
      const [lessonsRes, gapsRes] = await Promise.all([
        fetch("/api/knowledge"),
        fetch("/api/knowledge/gaps"),
      ]);
      const lessonsData = await lessonsRes.json();
      const gapsData = await gapsRes.json();
      if (Array.isArray(lessonsData)) setLessons(lessonsData);
      if (Array.isArray(gapsData)) setGaps(gapsData);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLessons();
  }, [fetchLessons]);

  function handleSearch(q: string) {
    setSearchQuery(q);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!q.trim()) {
      setSearchResults(null);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const res = await fetch(
        `/api/knowledge/search?q=${encodeURIComponent(q)}`
      );
      const data = await res.json();
      if (Array.isArray(data)) setSearchResults(data);
    }, 300);
  }

  // Build category overview
  const categoryMap = new Map<
    string,
    { count: number; recent: string | null }
  >();
  for (const lesson of lessons) {
    const existing = categoryMap.get(lesson.category);
    if (!existing) {
      categoryMap.set(lesson.category, {
        count: 1,
        recent: lesson.title,
      });
    } else {
      existing.count++;
    }
  }

  const categories = [
    "deployment", "auth", "database", "performance", "testing",
    "error-handling", "integrations", "anti-patterns", "architecture", "tooling",
  ].map((name) => ({
    name,
    count: categoryMap.get(name)?.count || 0,
    recent: categoryMap.get(name)?.recent || null,
  }));

  const displayLessons = searchResults !== null ? searchResults : lessons;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold font-mono tracking-wide text-text-bright uppercase">
            Knowledge Base
          </h1>
          <p className="text-sm text-text font-mono mt-1">
            {lessons.length} lesson{lessons.length !== 1 ? "s" : ""} across{" "}
            {categoryMap.size} categories
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={async () => {
              setHarvesting(true);
              setHarvestResult(null);
              try {
                const res = await fetch("/api/knowledge/harvest", { method: "POST" });
                const data = await res.json();
                if (res.ok) {
                  setHarvestResult(`${data.newLessons} new, ${data.duplicatesSkipped} skipped`);
                  fetchLessons();
                } else {
                  setHarvestResult(`Error: ${data.error}`);
                }
              } finally {
                setHarvesting(false);
              }
            }}
            disabled={harvesting}
            className={`px-3 py-1.5 text-xs font-mono uppercase tracking-wider border transition-colors ${
              harvesting
                ? "border-space-500 text-space-500 cursor-wait"
                : "border-accent text-accent hover:bg-accent/10"
            }`}
          >
            {harvesting ? "Harvesting..." : "Harvest"}
          </button>
          {harvestResult && (
            <span className="text-xs font-mono text-text">{harvestResult}</span>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search lessons..."
          className="w-full max-w-md px-3 py-2 text-sm font-mono bg-space-800 border border-space-600 text-text-bright placeholder:text-space-500 focus:border-cyan focus:outline-none transition-colors"
        />
      </div>

      {/* Knowledge gaps */}
      {!searchResults && !loading && gaps.length > 0 && (
        <div className="mb-6">
          <GapSuggestions suggestions={gaps} />
        </div>
      )}

      {/* Category overview */}
      {!searchResults && !loading && (
        <div className="mb-8">
          <CategoryOverview categories={categories} />
        </div>
      )}

      {/* Search results label */}
      {searchResults && (
        <div className="mb-4 text-xs font-mono text-space-500">
          {searchResults.length} result{searchResults.length !== 1 ? "s" : ""}{" "}
          for &quot;{searchQuery}&quot;
        </div>
      )}

      {/* Lessons */}
      {loading ? (
        <div className="text-sm font-mono text-space-500">Loading...</div>
      ) : displayLessons.length === 0 ? (
        <div className="p-6 border border-space-600 bg-space-800 text-center">
          <p className="text-sm font-mono text-text">
            {searchResults
              ? "No lessons match your search."
              : "No lessons harvested yet. Run the harvester to populate."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {displayLessons.slice(0, 50).map((lesson) => (
            <LessonCard
              key={lesson.id}
              title={lesson.title}
              content={lesson.content}
              category={lesson.category}
              severity={lesson.severity}
              sourceProject={lesson.sourceProject?.name || null}
              sourcePhase={lesson.sourcePhase}
              discoveredAt={lesson.discoveredAt}
              tags={JSON.parse(lesson.tags)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
