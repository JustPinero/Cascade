import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get("q") || "";

    if (!q.trim()) {
      return NextResponse.json([]);
    }

    const searchTerm = q.toLowerCase();

    // SQLite doesn't have full-text search built in with Prisma,
    // so we fetch and filter in-memory for now.
    const allLessons = await prisma.knowledgeLesson.findMany({
      include: {
        sourceProject: { select: { name: true, slug: true } },
      },
    });

    const scored = allLessons
      .map((lesson) => {
        let score = 0;
        const titleLower = lesson.title.toLowerCase();
        const contentLower = lesson.content.toLowerCase();
        const tagsLower = lesson.tags.toLowerCase();

        // Title match is strongest signal
        if (titleLower.includes(searchTerm)) score += 10;
        // Content match
        if (contentLower.includes(searchTerm)) score += 5;
        // Tag match
        if (tagsLower.includes(searchTerm)) score += 7;
        // Exact word match bonus
        if (titleLower.split(/\s+/).includes(searchTerm)) score += 5;

        return { ...lesson, score };
      })
      .filter((l) => l.score > 0)
      .sort((a, b) => b.score - a.score);

    return NextResponse.json(scored);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
