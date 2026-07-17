/**
 * Phase 43.1 — Identity & teams domain service.
 *
 * First increment of the Cascade Teams overhaul
 * (docs/cascade-2.0-team-direction.md). Pure domain logic over the new
 * User/Team/Membership/Invite models. Prisma is injected (webhook-ingest
 * pattern) so callers thread their own client and tests use a scratch DB.
 *
 * Deliberately architecture-independent: no auth, no sessions, no
 * Postgres assumptions. A `User` is identity only; how a user proves that
 * identity is a later, gated phase. `now`/`ttlMs` are injectable so time
 * logic is deterministic under test.
 */
import { randomBytes } from "node:crypto";
import type { PrismaClient, User, Team, Membership } from "@/app/generated/prisma/client";

const DEFAULT_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type Role = "owner" | "admin" | "member" | "viewer";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics (Coquí → coqui)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function uniqueTeamSlug(prisma: PrismaClient, name: string): Promise<string> {
  const base = slugify(name) || "team";
  let candidate = base;
  let n = 1;
  // Small serial loop; the @unique on slug is the real guard.
  while (await prisma.team.findUnique({ where: { slug: candidate } })) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  return candidate;
}

function newToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Create a team and make `owner` its owner. */
export async function createTeam(
  prisma: PrismaClient,
  args: { name: string; owner: User }
): Promise<Team> {
  const slug = await uniqueTeamSlug(prisma, args.name);
  return prisma.team.create({
    data: {
      name: args.name,
      slug,
      createdById: args.owner.id,
      memberships: { create: { userId: args.owner.id, role: "owner" } },
    },
  });
}

/** Add a user to a team directly (idempotent on the unique membership). */
export async function addMember(
  prisma: PrismaClient,
  args: { team: Team; user: User; role?: Role }
): Promise<Membership> {
  const role = args.role ?? "member";
  return prisma.membership.upsert({
    where: { userId_teamId: { userId: args.user.id, teamId: args.team.id } },
    update: { role },
    create: { userId: args.user.id, teamId: args.team.id, role },
  });
}

/**
 * Invite an email to a team. Re-inviting a still-pending email refreshes
 * that invite (new token, updated role, extended expiry) rather than
 * creating a duplicate — enforced by the @@unique([teamId, email]).
 */
export async function inviteMember(
  prisma: PrismaClient,
  args: {
    team: Team;
    email: string;
    role?: Role;
    invitedBy: User;
    now?: Date;
    ttlMs?: number;
  }
) {
  const now = args.now ?? new Date();
  const role = args.role ?? "member";
  const expiresAt = new Date(now.getTime() + (args.ttlMs ?? DEFAULT_INVITE_TTL_MS));
  const token = newToken();
  return prisma.invite.upsert({
    where: { teamId_email: { teamId: args.team.id, email: args.email } },
    update: { role, token, invitedById: args.invitedBy.id, status: "pending", expiresAt },
    create: {
      teamId: args.team.id,
      email: args.email,
      role,
      token,
      invitedById: args.invitedBy.id,
      status: "pending",
      expiresAt,
    },
  });
}

/**
 * Accept an invite by token. Adds the membership and burns the token
 * (status → accepted). Rejects tokens that are unknown, already accepted,
 * revoked, or past expiry.
 */
export async function acceptInvite(
  prisma: PrismaClient,
  args: { token: string; user: User; now?: Date }
): Promise<Membership> {
  const now = args.now ?? new Date();
  const invite = await prisma.invite.findUnique({ where: { token: args.token } });
  if (!invite) throw new Error("Invalid invite token");
  if (invite.status === "accepted") throw new Error("Invite already accepted");
  if (invite.status === "revoked") throw new Error("Invite was revoked");
  if (invite.status === "expired" || invite.expiresAt.getTime() < now.getTime()) {
    if (invite.status !== "expired") {
      await prisma.invite.update({ where: { id: invite.id }, data: { status: "expired" } });
    }
    throw new Error("Invite has expired");
  }
  const [membership] = await prisma.$transaction([
    prisma.membership.upsert({
      where: { userId_teamId: { userId: args.user.id, teamId: invite.teamId } },
      update: { role: invite.role },
      create: { userId: args.user.id, teamId: invite.teamId, role: invite.role },
    }),
    prisma.invite.update({ where: { id: invite.id }, data: { status: "accepted" } }),
  ]);
  return membership;
}

export async function roleOf(
  prisma: PrismaClient,
  user: User,
  team: Team
): Promise<Role | null> {
  const m = await prisma.membership.findUnique({
    where: { userId_teamId: { userId: user.id, teamId: team.id } },
  });
  return (m?.role as Role) ?? null;
}

export async function isMember(
  prisma: PrismaClient,
  user: User,
  team: Team
): Promise<boolean> {
  return (await roleOf(prisma, user, team)) !== null;
}

export async function listMembers(prisma: PrismaClient, team: Team) {
  return prisma.membership.findMany({
    where: { teamId: team.id },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function listTeams(prisma: PrismaClient, user: User): Promise<Team[]> {
  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    include: { team: true },
    orderBy: { team: { slug: "asc" } },
  });
  return memberships.map((m) => m.team);
}
