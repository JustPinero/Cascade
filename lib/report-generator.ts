import { PrismaClient } from "@/app/generated/prisma/client";

export interface SingleProjectReport {
  type: "single";
  projectName: string;
  currentPhase: string;
  status: string;
  health: string;
  audits: { type: string; grade: string | null; date: string }[];
  openDebt: string[];
  resolvedDebt: string[];
  timeline: { event: string; summary: string; date: string }[];
  generatedAt: string;
}

export interface CrossProjectReport {
  type: "cross-project";
  projects: {
    name: string;
    status: string;
    health: string;
    phase: string;
  }[];
  totalLessons: number;
  lessonsByCategory: Record<string, number>;
  activeBlockers: { project: string; details: string }[];
  recentActivity: { project: string; event: string; summary: string; date: string }[];
  generatedAt: string;
}

/**
 * Generate a single-project report as structured data.
 * The PDF rendering is handled client-side or by a dedicated PDF library.
 */
export async function generateSingleReport(
  prisma: PrismaClient,
  slug: string
): Promise<SingleProjectReport | null> {
  const project = await prisma.project.findUnique({
    where: { slug },
    include: {
      auditSnapshots: {
        orderBy: { capturedAt: "desc" },
        take: 20,
      },
      activityEvents: {
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  });

  if (!project) return null;

  // Parse debt from healthDetails
  let openDebt: string[] = [];
  const resolvedDebt: string[] = [];
  try {
    const details = JSON.parse(project.healthDetails);
    openDebt = details.debtItems || [];
  } catch {
    // No debt data
  }

  return {
    type: "single",
    projectName: project.name,
    currentPhase: project.currentPhase,
    status: project.status,
    health: project.health,
    audits: project.auditSnapshots.map((a) => ({
      type: a.auditType,
      grade: a.grade,
      date: a.capturedAt.toISOString(),
    })),
    openDebt,
    resolvedDebt,
    timeline: project.activityEvents.map((e) => ({
      event: e.eventType,
      summary: e.summary,
      date: e.createdAt.toISOString(),
    })),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generate a cross-project summary report.
 */
export async function generateCrossProjectReport(
  prisma: PrismaClient
): Promise<CrossProjectReport> {
  const [projects, lessons, recentEvents] = await Promise.all([
    prisma.project.findMany({
      orderBy: { lastActivityAt: "desc" },
    }),
    prisma.knowledgeLesson.findMany({
      select: { category: true },
    }),
    prisma.activityEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        project: { select: { name: true } },
      },
    }),
  ]);

  // Lessons by category
  const lessonsByCategory: Record<string, number> = {};
  for (const lesson of lessons) {
    lessonsByCategory[lesson.category] =
      (lessonsByCategory[lesson.category] || 0) + 1;
  }

  // Active blockers
  const activeBlockers = projects
    .filter((p) => p.health === "blocked")
    .map((p) => {
      let details = "Unknown blocker";
      try {
        const hd = JSON.parse(p.healthDetails);
        details =
          hd.debtItems?.join(", ") || `Blocked (${p.currentPhase})`;
      } catch {
        // use default
      }
      return { project: p.name, details };
    });

  return {
    type: "cross-project",
    projects: projects.map((p) => ({
      name: p.name,
      status: p.status,
      health: p.health,
      phase: p.currentPhase,
    })),
    totalLessons: lessons.length,
    lessonsByCategory,
    activeBlockers,
    recentActivity: recentEvents.map((e) => ({
      project: e.project?.name || "System",
      event: e.eventType,
      summary: e.summary,
      date: e.createdAt.toISOString(),
    })),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Convert a report to markdown (for download or display).
 */
export function reportToMarkdown(
  report: SingleProjectReport | CrossProjectReport
): string {
  if (report.type === "single") {
    return singleReportToMarkdown(report);
  }
  return crossReportToMarkdown(report);
}

function singleReportToMarkdown(report: SingleProjectReport): string {
  const lines = [
    `# Project Report: ${report.projectName}`,
    `Generated: ${report.generatedAt.split("T")[0]}`,
    "",
    `## Status: ${report.status} | Health: ${report.health} | Phase: ${report.currentPhase}`,
    "",
    "## Audit History",
    ...report.audits.map(
      (a) => `- ${a.type}: ${a.grade || "N/A"} (${a.date.split("T")[0]})`
    ),
    "",
    "## Open Debt",
    ...(report.openDebt.length > 0
      ? report.openDebt.map((d) => `- ${d}`)
      : ["_No open debt_"]),
    "",
    "## Activity Timeline",
    ...report.timeline.slice(0, 20).map(
      (e) => `- [${e.event}] ${e.summary} (${e.date.split("T")[0]})`
    ),
  ];
  return lines.join("\n");
}

function crossReportToMarkdown(report: CrossProjectReport): string {
  const lines = [
    "# Cross-Project Summary Report",
    `Generated: ${report.generatedAt.split("T")[0]}`,
    "",
    "## Project Overview",
    "| Project | Status | Health | Phase |",
    "|---------|--------|--------|-------|",
    ...report.projects.map(
      (p) => `| ${p.name} | ${p.status} | ${p.health} | ${p.phase} |`
    ),
    "",
    `## Knowledge Base: ${report.totalLessons} lessons`,
    ...Object.entries(report.lessonsByCategory).map(
      ([cat, count]) => `- ${cat}: ${count}`
    ),
    "",
    "## Active Blockers",
    ...(report.activeBlockers.length > 0
      ? report.activeBlockers.map((b) => `- **${b.project}**: ${b.details}`)
      : ["_No active blockers_"]),
    "",
    "## Recent Activity",
    ...report.recentActivity.slice(0, 20).map(
      (e) =>
        `- [${e.event}] ${e.project}: ${e.summary} (${e.date.split("T")[0]})`
    ),
  ];
  return lines.join("\n");
}
