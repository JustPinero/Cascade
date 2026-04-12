import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";
import { PrismaClient } from "@/app/generated/prisma/client";
import { categorize } from "./categorizer";

export interface RetroHarvestResult {
  projectName: string;
  slug: string;
  artifactsGathered: number;
  lessonsExtracted: number;
  lessonsStored: number;
  duplicatesSkipped: number;
  lessons: Array<{ title: string; category: string }>;
  error: string | null;
}

interface ProjectArtifacts {
  gitLog: string;
  handoff: string;
  claudeMd: string;
  debtResolved: string;
  auditFindings: string;
}

/**
 * Gather historical artifacts from a project directory.
 */
async function gatherArtifacts(
  projectPath: string
): Promise<ProjectArtifacts> {
  const artifacts: ProjectArtifacts = {
    gitLog: "",
    handoff: "",
    claudeMd: "",
    debtResolved: "",
    auditFindings: "",
  };

  // Git log — focus on fix/refactor/lesson commits
  try {
    await fs.access(path.join(projectPath, ".git"));
    const log = execSync(
      `git log --oneline --no-merges -100 --format="%s" 2>/dev/null`,
      { cwd: projectPath, stdio: "pipe" }
    ).toString();
    // Filter to interesting commits
    const interesting = log
      .split("\n")
      .filter(
        (line) =>
          /fix|refactor|workaround|hotfix|revert|breaking|migrate|lesson|gotcha|bug/i.test(
            line
          )
      )
      .slice(0, 40);
    if (interesting.length > 0) {
      artifacts.gitLog = interesting.join("\n");
    }
  } catch {
    // No git or git log failed
  }

  // Handoff
  try {
    artifacts.handoff = (
      await fs.readFile(
        path.join(projectPath, ".claude", "handoff.md"),
        "utf-8"
      )
    ).slice(0, 3000);
  } catch {
    // No handoff
  }

  // CLAUDE.md
  try {
    artifacts.claudeMd = (
      await fs.readFile(path.join(projectPath, "CLAUDE.md"), "utf-8")
    ).slice(0, 3000);
  } catch {
    // No CLAUDE.md
  }

  // Resolved debt items
  try {
    const debtContent = await fs.readFile(
      path.join(projectPath, "audits", "debt.md"),
      "utf-8"
    );
    const resolvedSection =
      debtContent.split("## Resolved")[1]?.split("##")[0] || "";
    const resolved = resolvedSection
      .split("\n")
      .filter((line) => line.startsWith("- ") || line.startsWith("* "))
      .map((line) => line.replace(/^[-*]\s+/, "").trim())
      .filter(Boolean);
    if (resolved.length > 0) {
      artifacts.debtResolved = resolved.slice(0, 20).join("\n");
    }
  } catch {
    // No debt file
  }

  // Audit findings
  try {
    const auditsDir = path.join(projectPath, "audits");
    const entries = await fs.readdir(auditsDir);
    const auditFiles = entries
      .filter((f) => f.startsWith("audit-") && f.endsWith(".md"))
      .sort()
      .reverse()
      .slice(0, 3);

    const findings: string[] = [];
    for (const file of auditFiles) {
      const content = await fs.readFile(
        path.join(auditsDir, file),
        "utf-8"
      );
      // Extract finding lines
      const lines = content
        .split("\n")
        .filter((l) =>
          /^-\s*\[(BUG|ISSUE|WARN|CRITICAL|OPT|FIX|LESSON)/i.test(l)
        );
      findings.push(...lines.slice(0, 10));
    }
    if (findings.length > 0) {
      artifacts.auditFindings = findings.join("\n");
    }
  } catch {
    // No audits
  }

  return artifacts;
}

/**
 * Count non-empty artifacts.
 */
function countArtifacts(artifacts: ProjectArtifacts): number {
  return Object.values(artifacts).filter((v) => v.length > 0).length;
}

/**
 * Build a prompt for Claude to extract lessons from project artifacts.
 */
function buildExtractionPrompt(
  projectName: string,
  artifacts: ProjectArtifacts
): string {
  const sections: string[] = [];

  if (artifacts.gitLog) {
    sections.push(`## Git History (fix/refactor commits)\n${artifacts.gitLog}`);
  }
  if (artifacts.handoff) {
    sections.push(`## Session Handoff\n${artifacts.handoff}`);
  }
  if (artifacts.claudeMd) {
    sections.push(`## Project Standards (CLAUDE.md)\n${artifacts.claudeMd}`);
  }
  if (artifacts.debtResolved) {
    sections.push(`## Resolved Debt Items\n${artifacts.debtResolved}`);
  }
  if (artifacts.auditFindings) {
    sections.push(`## Audit Findings\n${artifacts.auditFindings}`);
  }

  return `You are analyzing the history of "${projectName}" to extract reusable lessons for future projects.

${sections.join("\n\n")}

## Instructions
Extract 3-10 specific, actionable lessons from this project's history. Focus on:
- Non-obvious gotchas that would save time on future projects
- Patterns that worked well and should be repeated
- Mistakes that were fixed and should be avoided
- Integration-specific knowledge (API quirks, framework gotchas)

Do NOT include generic best practices everyone knows (like "write tests" or "use version control").

Return ONLY a JSON array of objects with this format:
[
  { "title": "Short lesson title", "content": "Detailed explanation of the lesson and why it matters", "severity": "critical|important|nice-to-know" }
]

Return raw JSON, no markdown fences.`;
}

/**
 * Call Claude to extract lessons from project artifacts.
 */
async function extractLessonsWithClaude(
  projectName: string,
  artifacts: ProjectArtifacts,
  apiKey: string
): Promise<Array<{ title: string; content: string; severity: string }>> {
  const prompt = buildExtractionPrompt(projectName, artifacts);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: controller.signal,
  });

  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || "[]";

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Try to extract JSON from the response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // Give up
      }
    }
  }

  return [];
}

/**
 * Run a retroactive harvest on a single project.
 * Gathers historical artifacts and uses Claude to extract lessons.
 */
export async function retroHarvestProject(
  prisma: PrismaClient,
  projectPath: string,
  projectName: string,
  projectSlug: string,
  apiKey: string
): Promise<RetroHarvestResult> {
  const result: RetroHarvestResult = {
    projectName,
    slug: projectSlug,
    artifactsGathered: 0,
    lessonsExtracted: 0,
    lessonsStored: 0,
    duplicatesSkipped: 0,
    lessons: [],
    error: null,
  };

  try {
    // Gather artifacts
    const artifacts = await gatherArtifacts(projectPath);
    result.artifactsGathered = countArtifacts(artifacts);

    if (result.artifactsGathered === 0) {
      result.error = "No historical artifacts found";
      return result;
    }

    // Extract lessons with Claude
    const extracted = await extractLessonsWithClaude(
      projectName,
      artifacts,
      apiKey
    );
    result.lessonsExtracted = extracted.length;

    // Find project in DB
    const project = await prisma.project.findUnique({
      where: { slug: projectSlug },
    });

    // Store lessons, deduplicating
    for (const lesson of extracted) {
      if (!lesson.title || !lesson.content) continue;

      const existing = await prisma.knowledgeLesson.findFirst({
        where: {
          title: lesson.title,
          sourceProjectId: project?.id,
        },
      });

      if (existing) {
        result.duplicatesSkipped++;
        continue;
      }

      const { category, tags } = categorize(
        lesson.title,
        lesson.content,
        projectPath
      );

      const validSeverities = new Set([
        "critical",
        "important",
        "nice-to-know",
      ]);
      const severity = validSeverities.has(lesson.severity)
        ? lesson.severity
        : "nice-to-know";

      await prisma.knowledgeLesson.create({
        data: {
          title: lesson.title,
          content: lesson.content,
          category,
          tags: JSON.stringify(tags),
          severity,
          sourceProjectId: project?.id || null,
          sourceFile: "retroactive-harvest",
          sourcePhase: null,
        },
      });

      if (project) {
        await prisma.activityEvent.create({
          data: {
            projectId: project.id,
            eventType: "lesson-harvested",
            summary: `[retro] ${lesson.title}`,
          },
        });
      }

      result.lessonsStored++;
      result.lessons.push({ title: lesson.title, category });
    }

    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : "Unknown error";
    return result;
  }
}

/**
 * Run retroactive harvest across all projects.
 */
export async function retroHarvestAll(
  prisma: PrismaClient,
  apiKey: string
): Promise<RetroHarvestResult[]> {
  const projects = await prisma.project.findMany();
  const results: RetroHarvestResult[] = [];

  for (const project of projects) {
    const result = await retroHarvestProject(
      prisma,
      project.path,
      project.name,
      project.slug,
      apiKey
    );
    results.push(result);
  }

  return results;
}
