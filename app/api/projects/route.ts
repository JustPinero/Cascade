import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAllUnreadCounts } from "@/lib/unread";

export async function GET() {
  try {
    const [projects, unreadCounts] = await Promise.all([
      prisma.project.findMany({
        orderBy: { lastActivityAt: "desc" },
      }),
      getAllUnreadCounts(prisma),
    ]);

    const projectsWithUnread = projects.map((p) => ({
      ...p,
      unreadAuditCount: unreadCounts.get(p.id) || 0,
    }));

    return NextResponse.json(projectsWithUnread);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
