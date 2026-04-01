import fs from "fs/promises";
import path from "path";
import { PrismaClient } from "@/app/generated/prisma/client";
import { categorize } from "./categorizer";

export interface HarvestResult {
  scannedProjects: number;
  newLessons: number;
  duplicatesSkipped: number;
  lessons: { title: string; category: string; source: string }[];
}

interface RawLesson {
  title: string;
  content: string;
  sourceFile: string;
  sourcePhase: string | null;
}

/**
 * Extract lessons tagged with [LESSON] from a file's content.
 * Format: [LESSON] Title: content until next [LESSON] or end of section.
 */
function extractTaggedLessons(
  content: string,
  filePath: string
): RawLesson[] {
  const lessons: RawLesson[] = [];
  const lessonRegex = /\[LESSON\]\s*(.+?)(?:\n|$)([\s\S]*?)(?=\[LESSON\]|##|$)/gi;

  let match;
  while ((match = lessonRegex.exec(content)) !== null) {
    const titleLine = match[1].trim();
    const body = match[2].trim();

    // Split title on colon if present
    const colonIdx = titleLine.indexOf(":");
    const title =
      colonIdx > 0 ? titleLine.slice(0, colonIdx).trim() : titleLine;
    const extraContent =
      colonIdx > 0 ? titleLine.slice(colonIdx + 1).trim() : "";

    const fullContent = [extraContent, body].filter(Boolean).join("\n");

    if (title) {
      lessons.push({
        title,
        content: fullContent || title,
        sourceFile: filePath,
        sourcePhase: extractPhaseFromPath(filePath),
      });
    }
  }

  return lessons;
}

/**
 * Extract lessons from course correction reports.
 * Looks for structured findings in correction-*.md files.
 */
function extractCorrectionLessons(
  content: string,
  filePath: string
): RawLesson[] {
  const lessons: RawLesson[] = [];

  // Look for "### Correction Actions" or "### Recommendations" sections
  const sections = content.split(/^###?\s+/m);
  for (const section of sections) {
    const lines = section.split("\n");
    const heading = lines[0]?.trim() || "";

    if (
      /correction|recommendation|lesson|finding/i.test(heading)
    ) {
      // Extract bullet points as individual lessons
      for (const line of lines.slice(1)) {
        const bulletMatch = line.match(
          /^[-*]\s+(?:\[(?:REVERT|ADD|FIX|LESSON)\]\s+)?(.+)/
        );
        if (bulletMatch) {
          const title = bulletMatch[1].trim();
          if (title.length > 10) {
            lessons.push({
              title,
              content: title,
              sourceFile: filePath,
              sourcePhase: extractPhaseFromPath(filePath),
            });
          }
        }
      }
    }
  }

  return lessons;
}

function extractPhaseFromPath(filePath: string): string | null {
  const match = filePath.match(/phase-(\d+[-\w]*)/i);
  return match ? `phase-${match[1]}` : null;
}

/**
 * Scan a single file for lessons.
 */
async function harvestFile(filePath: string): Promise<RawLesson[]> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const lessons: RawLesson[] = [];

    // Extract [LESSON] tagged items
    lessons.push(...extractTaggedLessons(content, filePath));

    // Extract from correction reports
    if (path.basename(filePath).startsWith("correction-")) {
      lessons.push(...extractCorrectionLessons(content, filePath));
    }

    return lessons;
  } catch {
    return [];
  }
}

/**
 * Scan all registered projects for knowledge lessons.
 * Creates new KnowledgeLesson records and logs ActivityEvents.
 */
export async function harvestKnowledge(
  prisma: PrismaClient
): Promise<HarvestResult> {
  const projects = await prisma.project.findMany();
  const result: HarvestResult = {
    scannedProjects: projects.length,
    newLessons: 0,
    duplicatesSkipped: 0,
    lessons: [],
  };

  for (const project of projects) {
    const rawLessons: RawLesson[] = [];

    // Scan audits/ directory
    const auditsDir = path.join(project.path, "audits");
    try {
      const entries = await fs.readdir(auditsDir);
      for (const entry of entries) {
        if (entry.endsWith(".md")) {
          const lessons = await harvestFile(path.join(auditsDir, entry));
          rawLessons.push(...lessons);
        }
      }
    } catch {
      // No audits dir — skip
    }

    // Scan .claude/handoff.md
    const handoffPath = path.join(project.path, ".claude", "handoff.md");
    rawLessons.push(...(await harvestFile(handoffPath)));

    // Scan audits/correction-*.md
    try {
      const auditsEntries = await fs.readdir(auditsDir);
      for (const entry of auditsEntries) {
        if (entry.startsWith("correction-") && entry.endsWith(".md")) {
          const lessons = await harvestFile(path.join(auditsDir, entry));
          rawLessons.push(...lessons);
        }
      }
    } catch {
      // Skip
    }

    // Deduplicate and create records
    for (const raw of rawLessons) {
      const existing = await prisma.knowledgeLesson.findFirst({
        where: {
          title: raw.title,
          sourceProjectId: project.id,
        },
      });

      if (existing) {
        result.duplicatesSkipped++;
        continue;
      }

      const { category, tags } = categorize(
        raw.title,
        raw.content,
        raw.sourceFile
      );

      await prisma.knowledgeLesson.create({
        data: {
          title: raw.title,
          content: raw.content,
          category,
          tags: JSON.stringify(tags),
          sourceProjectId: project.id,
          sourceFile: raw.sourceFile,
          sourcePhase: raw.sourcePhase,
        },
      });

      // Log activity event
      await prisma.activityEvent.create({
        data: {
          projectId: project.id,
          eventType: "lesson-harvested",
          summary: `Harvested lesson: ${raw.title}`,
        },
      });

      result.newLessons++;
      result.lessons.push({
        title: raw.title,
        category,
        source: `${project.name}/${raw.sourceFile}`,
      });
    }
  }

  return result;
}
