"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { LessonCard } from "../../components/lesson-card";

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

export default function CategoryPage() {
  const params = useParams();
  const category = params.category as string;
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLessons = useCallback(async () => {
    try {
      const res = await fetch("/api/knowledge");
      const data = await res.json();
      if (Array.isArray(data)) {
        setLessons(data.filter((l: Lesson) => l.category === category));
      }
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    fetchLessons();
  }, [fetchLessons]);

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/knowledge"
          className="text-xs font-mono text-cyan hover:text-text-bright transition-colors"
        >
          &larr; Knowledge Base
        </Link>
        <h1 className="text-2xl font-bold font-mono tracking-wide text-text-bright uppercase mt-2">
          {category.replace(/-/g, " ")}
        </h1>
        <p className="text-sm text-text font-mono mt-1">
          {lessons.length} lesson{lessons.length !== 1 ? "s" : ""}
        </p>
      </div>

      {loading ? (
        <div className="text-sm font-mono text-space-500">Loading...</div>
      ) : lessons.length === 0 ? (
        <div className="p-6 border border-space-600 bg-space-800 text-center">
          <p className="text-sm font-mono text-text">
            No lessons in this category yet.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {lessons.map((lesson) => (
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
