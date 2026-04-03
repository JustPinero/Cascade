import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionLogs } from "@/lib/session-reader";
import { analyzeSessionPatterns } from "@/lib/playbook-learner";

/**
 * GET /api/playbook/suggestions
 *
 * Analyzes recent session logs across all projects for recurring patterns.
 * Returns playbook addition suggestions when patterns emerge.
 */
export async function GET() {
  try {
    const projects = await prisma.project.findMany({
      where: { status: { in: ["building", "complete"] } },
    });

    // Collect recent session logs from all projects
    const allSessions: Array<{ projectName: string; content: string }> = [];

    for (const project of projects) {
      const logs = await getSessionLogs(project.path, 5);
      for (const log of logs) {
        allSessions.push({
          projectName: project.name,
          content: log.content,
        });
      }
    }

    const suggestions = analyzeSessionPatterns(allSessions);

    return NextResponse.json({
      totalSessionsAnalyzed: allSessions.length,
      projectsAnalyzed: projects.length,
      suggestions,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
