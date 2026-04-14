import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET /api/attention
 *
 * Returns consolidated count of things needing the developer's attention:
 * pending human tasks, blocked projects, CI failures (future), deploy-down (future).
 */
export async function GET() {
  try {
    const [pendingTasks, blockedProjects] = await Promise.all([
      prisma.humanTask.count({ where: { status: "pending" } }),
      prisma.project.count({ where: { health: "blocked" } }),
    ]);

    const total = pendingTasks + blockedProjects;

    return NextResponse.json({
      total,
      breakdown: {
        pendingTasks,
        blockedProjects,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
