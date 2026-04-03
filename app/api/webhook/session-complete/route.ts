import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { importSingleProject } from "@/lib/project-import";
import { toSlug } from "@/lib/scanner";
import { getSessionLogs } from "@/lib/session-reader";
import { detectEscalations } from "@/lib/escalation-detector";
import path from "path";

/**
 * POST /api/webhook/session-complete
 *
 * Receives a ping from a Claude Code Stop hook when a session ends.
 * Triggers a targeted scan of just that project and logs a session-complete event.
 *
 * Body: { projectPath: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectPath } = body;

    if (!projectPath || typeof projectPath !== "string") {
      return NextResponse.json(
        { error: "projectPath is required" },
        { status: 400 }
      );
    }

    // Resolve the project slug from the path
    const projectName = path.basename(projectPath);
    const slug = toSlug(projectName);

    // Run a targeted scan of just this project
    const result = await importSingleProject(prisma, projectPath);

    // Find the project to get its ID for the activity event
    const project = await prisma.project.findUnique({
      where: { slug },
    });

    // Log session-complete activity event
    if (project) {
      await prisma.activityEvent.create({
        data: {
          projectId: project.id,
          eventType: "session-complete",
          summary: `Claude session ended on ${result.name}`,
          details: JSON.stringify({
            action: result.action,
            scannedAt: new Date().toISOString(),
          }),
        },
      });

      // Detect escalation signals from the latest session log
      const logs = await getSessionLogs(projectPath, 1);
      if (logs.length > 0) {
        const signals = detectEscalations(logs[0].content);
        for (const signal of signals) {
          const eventTypeMap: Record<string, string> = {
            "needs-attention": "blocker-detected",
            lesson: "lesson-harvested",
            "test-failure": "blocker-detected",
            "phase-complete": "phase-complete",
          };
          await prisma.activityEvent.create({
            data: {
              projectId: project.id,
              eventType: eventTypeMap[signal.type] || signal.type,
              summary: `[${signal.type}] ${signal.message}`,
            },
          });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      slug: result.slug,
      name: result.name,
      action: result.action,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
