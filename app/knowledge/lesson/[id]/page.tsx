/**
 * Phase 25.3 — lesson detail page.
 *
 * Citation links from the Overseer chat (`[L-42]`) target this
 * route. Renders title, content, severity, and category in a clean
 * single-purpose view so the model's pointer feels like a real
 * destination rather than a deep-link into a category page.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { parseLessonTags } from "@/lib/lesson-utils";

export const dynamic = "force-dynamic";

const SEVERITY_COLOR: Record<string, string> = {
  critical: "text-amber",
  important: "text-cyan",
  "nice-to-know": "text-space-400",
};

export default async function LessonDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const lesson = await prisma.knowledgeLesson.findUnique({
    where: { id },
    include: { sourceProject: true },
  });
  if (!lesson) notFound();

  const tags = parseLessonTags(lesson.tags);

  return (
    <main className="container mx-auto p-6 max-w-3xl">
      <nav className="mb-6 text-sm text-space-400">
        <Link href="/knowledge" className="hover:text-text">
          ← Knowledge Base
        </Link>
        <span className="mx-2">/</span>
        <Link
          href={`/knowledge/${lesson.category}`}
          className="hover:text-text"
        >
          {lesson.category}
        </Link>
      </nav>

      <header className="mb-6">
        <div className="text-xs text-space-400 mb-2 font-mono">
          L-{lesson.id}
        </div>
        <h1 className="text-2xl font-semibold mb-3">{lesson.title}</h1>
        <div className="flex items-center gap-3 text-xs text-space-400">
          <span
            className={
              SEVERITY_COLOR[lesson.severity] ?? "text-space-400"
            }
          >
            {lesson.severity}
          </span>
          <span>·</span>
          <span>{lesson.category}</span>
          {lesson.timesReferenced > 0 && (
            <>
              <span>·</span>
              <span>referenced {lesson.timesReferenced}×</span>
            </>
          )}
          {lesson.sourceProject && (
            <>
              <span>·</span>
              <span>from {lesson.sourceProject.slug}</span>
            </>
          )}
        </div>
      </header>

      <article className="prose prose-invert max-w-none whitespace-pre-wrap text-sm leading-relaxed">
        {lesson.content}
      </article>

      {tags.length > 0 && (
        <footer className="mt-8 pt-4 border-t border-space-700">
          <div className="text-xs text-space-400 mb-2">Tags</div>
          <div className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <span
                key={t}
                className="text-xs px-2 py-1 bg-space-800 rounded font-mono"
              >
                {t}
              </span>
            ))}
          </div>
        </footer>
      )}
    </main>
  );
}
