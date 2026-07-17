/**
 * Phase 45.1 — shared work visibility.
 *
 * The unified activity feed is the collision-plane primitive: it merges a
 * team's agent dispatches and human tasks into one normalized, owner-attributed
 * stream so every member can see who — person or agent — is doing what. Builds
 * on the 43.1 identity model; Prisma injected as elsewhere.
 *
 * Additive: assignment sets the nullable teamId/ownerUserId; unassigned work is
 * simply absent from every team feed (backward-compatible with single-user use).
 */
import type { PrismaClient, Team, User } from "@/app/generated/prisma/client";

export type ActivityKind = "dispatch" | "task";

export interface ActivityItem {
  kind: ActivityKind;
  id: string; // dispatch cuid or `task:<int>`
  title: string;
  status: string;
  projectSlug: string | null;
  owner: { id: number; name: string } | null;
  at: Date;
}

export async function assignDispatchToTeam(
  prisma: PrismaClient,
  args: { dispatchId: string; team: Team; owner?: User }
) {
  return prisma.dispatch.update({
    where: { id: args.dispatchId },
    data: { teamId: args.team.id, ownerUserId: args.owner?.id ?? null },
  });
}

export async function assignTaskToTeam(
  prisma: PrismaClient,
  args: { taskId: number; team: Team; owner?: User }
) {
  return prisma.humanTask.update({
    where: { id: args.taskId },
    data: { teamId: args.team.id, ownerUserId: args.owner?.id ?? null },
  });
}

function ownerOf(o: { id: number; name: string } | null): ActivityItem["owner"] {
  return o ? { id: o.id, name: o.name } : null;
}

/**
 * The team's unified activity feed — dispatches (agents) + human tasks (people),
 * normalized to one shape, newest first.
 */
export async function listTeamActivity(
  prisma: PrismaClient,
  team: Team
): Promise<ActivityItem[]> {
  const [dispatches, tasks] = await Promise.all([
    prisma.dispatch.findMany({
      where: { teamId: team.id },
      include: { owner: true },
    }),
    prisma.humanTask.findMany({
      where: { teamId: team.id },
      include: { owner: true },
    }),
  ]);

  const items: ActivityItem[] = [
    ...dispatches.map((d): ActivityItem => ({
      kind: "dispatch",
      id: d.id,
      title: `${d.projectSlug} · ${d.mode}`,
      status: d.status,
      projectSlug: d.projectSlug,
      owner: ownerOf(d.owner),
      at: d.startedAt ?? d.enqueuedAt,
    })),
    ...tasks.map((t): ActivityItem => ({
      kind: "task",
      id: `task:${t.id}`,
      title: t.title,
      status: t.status,
      projectSlug: t.projectSlug,
      owner: ownerOf(t.owner),
      at: t.createdAt,
    })),
  ];

  return items.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** The team feed filtered to one member's owned work. */
export async function listMemberWork(
  prisma: PrismaClient,
  args: { team: Team; user: User }
): Promise<ActivityItem[]> {
  const feed = await listTeamActivity(prisma, args.team);
  return feed.filter((i) => i.owner?.id === args.user.id);
}
