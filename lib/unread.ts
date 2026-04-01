import { PrismaClient } from "@/app/generated/prisma/client";

/**
 * Get unread audit count for a project.
 */
export async function getUnreadCount(
  prisma: PrismaClient,
  projectId: number
): Promise<number> {
  return prisma.auditSnapshot.count({
    where: { projectId, isRead: false },
  });
}

/**
 * Get unread counts for all projects.
 * Returns a map of projectId → unread count.
 */
export async function getAllUnreadCounts(
  prisma: PrismaClient
): Promise<Map<number, number>> {
  const results = await prisma.auditSnapshot.groupBy({
    by: ["projectId"],
    where: { isRead: false },
    _count: { id: true },
  });

  const map = new Map<number, number>();
  for (const r of results) {
    map.set(r.projectId, r._count.id);
  }
  return map;
}

/**
 * Mark all audits for a project as read.
 */
export async function markAuditsRead(
  prisma: PrismaClient,
  projectId: number
): Promise<number> {
  const result = await prisma.auditSnapshot.updateMany({
    where: { projectId, isRead: false },
    data: { isRead: true },
  });
  return result.count;
}
