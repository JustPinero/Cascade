import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAllUnreadCounts } from "@/lib/unread";
import { getAdvisoryStatuses } from "@/lib/advisory-tracker";

export async function GET() {
  try {
    const [projects, unreadCounts, advisoryStatuses] = await Promise.all([
      prisma.project.findMany({
        orderBy: { lastActivityAt: "desc" },
      }),
      getAllUnreadCounts(prisma),
      getAdvisoryStatuses(prisma),
    ]);

    const advisoryMap = new Map(
      advisoryStatuses.map((s) => [s.projectSlug, s])
    );

    const projectsWithExtras = projects.map((p) => {
      const advisory = advisoryMap.get(p.slug);
      return {
        ...p,
        unreadAuditCount: unreadCounts.get(p.id) || 0,
        hasAdvisory: advisory?.hasAdvisory || false,
        advisoryRead: advisory?.isRead || false,
      };
    });

    return NextResponse.json(projectsWithExtras);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
