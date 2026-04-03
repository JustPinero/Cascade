import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { importSingleProject } from "@/lib/project-import";
import { toSlug } from "@/lib/scanner";
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
