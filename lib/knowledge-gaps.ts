import { PrismaClient } from "@/app/generated/prisma/client";

export interface GapSuggestion {
  category: string;
  count: number;
  suggestion: string;
  priority: "high" | "medium" | "low";
}

const ALL_CATEGORIES = [
  "deployment",
  "auth",
  "database",
  "performance",
  "testing",
  "error-handling",
  "integrations",
  "anti-patterns",
  "architecture",
  "tooling",
];

/**
 * Detect knowledge gaps — categories with thin or no coverage.
 */
export async function detectKnowledgeGaps(
  prisma: PrismaClient,
  minThreshold: number = 2
): Promise<GapSuggestion[]> {
  const lessons = await prisma.knowledgeLesson.findMany({
    select: { category: true },
  });

  const counts = new Map<string, number>();
  for (const cat of ALL_CATEGORIES) {
    counts.set(cat, 0);
  }
  for (const lesson of lessons) {
    counts.set(lesson.category, (counts.get(lesson.category) || 0) + 1);
  }

  const totalLessons = lessons.length;
  const suggestions: GapSuggestion[] = [];

  for (const [category, count] of counts) {
    if (count === 0) {
      suggestions.push({
        category,
        count,
        suggestion: `No lessons in "${category}" yet. Consider documenting patterns from your projects.`,
        priority: "high",
      });
    } else if (count < minThreshold) {
      suggestions.push({
        category,
        count,
        suggestion: `Only ${count} lesson${count === 1 ? "" : "s"} in "${category}". Look for undocumented patterns.`,
        priority: "medium",
      });
    } else if (totalLessons > 10 && count < totalLessons * 0.05) {
      suggestions.push({
        category,
        count,
        suggestion: `"${category}" has ${count} lessons but represents less than 5% of your knowledge base. May need attention.`,
        priority: "low",
      });
    }
  }

  return suggestions.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}
