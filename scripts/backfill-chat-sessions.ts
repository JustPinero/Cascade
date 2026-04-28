/**
 * Phase 12A.1 — backfill existing ChatMessage rows into ChatSession
 * aggregates. Groups messages by sessionDate, creates one ChatSession
 * per unique date with startedAt at that day's UTC midnight and
 * closedAt 24 hours later, and assigns sessionId to every previously
 * unassigned message.
 *
 * Idempotent: re-running after a complete pass is a no-op. If a prior
 * run created some sessions but not all (partial failure), the next
 * run picks up only the messages still missing sessionId.
 *
 * Usage:
 *   pnpm exec tsx scripts/backfill-chat-sessions.ts          # writes
 *   pnpm exec tsx scripts/backfill-chat-sessions.ts --dry-run
 */
import type { PrismaClient } from "@/app/generated/prisma/client";

export interface BackfillResult {
  sessionsCreated: number;
  messagesUpdated: number;
}

export async function backfillChatSessions(
  prisma: PrismaClient,
  options: { dryRun?: boolean } = {}
): Promise<BackfillResult> {
  const dryRun = options.dryRun ?? false;

  // Only consider messages still missing a sessionId. Messages already
  // attached to a session are left alone (preserves any pre-assignment).
  const orphans = await prisma.chatMessage.findMany({
    where: { sessionId: null },
    select: { id: true, sessionDate: true },
  });

  if (orphans.length === 0) {
    return { sessionsCreated: 0, messagesUpdated: 0 };
  }

  // Group orphan messages by their sessionDate string.
  const byDate = new Map<string, number[]>();
  for (const m of orphans) {
    const list = byDate.get(m.sessionDate) ?? [];
    list.push(m.id);
    byDate.set(m.sessionDate, list);
  }

  let sessionsCreated = 0;
  let messagesUpdated = 0;

  for (const [date, ids] of byDate) {
    const startedAt = new Date(`${date}T00:00:00.000Z`);
    const closedAt = new Date(startedAt.getTime() + 24 * 60 * 60 * 1000);

    if (dryRun) {
      sessionsCreated += 1;
      messagesUpdated += ids.length;
      continue;
    }

    const session = await prisma.chatSession.create({
      data: { startedAt, closedAt },
    });
    sessionsCreated += 1;

    const updated = await prisma.chatMessage.updateMany({
      where: { id: { in: ids } },
      data: { sessionId: session.id },
    });
    messagesUpdated += updated.count;
  }

  return { sessionsCreated, messagesUpdated };
}

// CLI entrypoint
if (require.main === module) {
  // Dynamic import so the test file can import this module without
  // executing the CLI side-effect. dotenv is loaded BEFORE @/lib/db
  // so the runtime PrismaClient picks up DATABASE_URL from
  // .env.local (canonical ./dev.db) instead of the db.ts fallback
  // (./prisma/dev.db, which is a leftover stale copy).
  (async () => {
    const dotenv = await import("dotenv");
    dotenv.config({ path: ".env.local" });
    dotenv.config(); // fallback to .env
    const { prisma } = await import("@/lib/db");
    const dryRun = process.argv.includes("--dry-run");
    const result = await backfillChatSessions(prisma, { dryRun });
    console.log(
      `[backfill-chat-sessions] ${dryRun ? "(dry run) " : ""}sessions created: ${result.sessionsCreated}, messages updated: ${result.messagesUpdated}`
    );
    await prisma.$disconnect();
  })().catch((err) => {
    console.error("[backfill-chat-sessions] error:", err);
    process.exit(1);
  });
}
