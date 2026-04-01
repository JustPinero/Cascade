import { PrismaClient } from "@/app/generated/prisma/client";
import fs from "fs/promises";
import path from "path";

/**
 * Generate knowledge/manifest.md with a summary of all lessons by category.
 */
export async function generateManifest(
  prisma: PrismaClient,
  outputPath: string
): Promise<{ lessonCount: number; categoryCount: number }> {
  const lessons = await prisma.knowledgeLesson.findMany({
    orderBy: [{ category: "asc" }, { severity: "asc" }, { title: "asc" }],
    include: {
      sourceProject: { select: { name: true } },
    },
  });

  const categories = new Map<
    string,
    typeof lessons
  >();

  for (const lesson of lessons) {
    const list = categories.get(lesson.category) || [];
    list.push(lesson);
    categories.set(lesson.category, list);
  }

  const timestamp = new Date().toISOString().split("T")[0];
  const lines: string[] = [
    "# Knowledge Base Manifest",
    "",
    `Generated: ${timestamp} | Total lessons: ${lessons.length} | Categories: ${categories.size}`,
    "",
    "---",
    "",
  ];

  const sortedCategories = [...categories.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  for (const [category, catLessons] of sortedCategories) {
    lines.push(`## ${category} (${catLessons.length})`);
    lines.push("");

    for (const lesson of catLessons) {
      const severity =
        lesson.severity === "critical"
          ? "!!!"
          : lesson.severity === "important"
            ? "!!"
            : "";
      const source = lesson.sourceProject?.name || "unknown";
      const summary = lesson.content.split("\n")[0].slice(0, 80);
      lines.push(
        `- ${severity ? `[${severity}] ` : ""}**${lesson.title}** — ${summary} _(from ${source})_`
      );
    }

    lines.push("");
  }

  const content = lines.join("\n");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, content, "utf-8");

  return {
    lessonCount: lessons.length,
    categoryCount: categories.size,
  };
}
