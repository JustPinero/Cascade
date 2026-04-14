import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAllUnreadCounts } from "@/lib/unread";
import { getAdvisoryStatuses } from "@/lib/advisory-tracker";

export async function GET() {
  try {
    const [projects, unreadCounts, advisoryStatuses, humanTaskCounts] =
      await Promise.all([
        prisma.project.findMany({
          orderBy: { lastActivityAt: "desc" },
        }),
        getAllUnreadCounts(prisma),
        getAdvisoryStatuses(prisma),
        prisma.humanTask.groupBy({
          by: ["projectId"],
          where: { status: "pending" },
          _count: { id: true },
        }),
      ]);

    const advisoryMap = new Map(
      advisoryStatuses.map((s) => [s.projectSlug, s])
    );

    const taskCountMap = new Map(
      humanTaskCounts.map((t) => [t.projectId, t._count.id])
    );

    const projectsWithExtras = projects.map((p) => {
      const advisory = advisoryMap.get(p.slug);
      return {
        ...p,
        unreadAuditCount: unreadCounts.get(p.id) || 0,
        hasAdvisory: advisory?.hasAdvisory || false,
        advisoryRead: advisory?.isRead || false,
        pendingHumanTasks: taskCountMap.get(p.id) || 0,
      };
    });

    return NextResponse.json(projectsWithExtras);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
