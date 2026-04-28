import type { PrismaClient, ChatSession } from "@/app/generated/prisma/client";

type Json = Record<string, unknown>;

function isPlainObject(value: unknown): value is Json {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Deep merge `source` into `target` without mutating either argument.
 * - Plain objects are merged recursively.
 * - Arrays and primitives in `source` overwrite the corresponding key.
 * - Explicit `null` in `source` overwrites (treated as an unset signal).
 */
export function deepMerge<T extends Json, U extends Json>(target: T, source: U): T & U {
  const result: Json = { ...target };
  for (const key of Object.keys(source)) {
    const s = (source as Json)[key];
    const t = (target as Json)[key];
    if (s === null) {
      result[key] = null;
    } else if (isPlainObject(s) && isPlainObject(t)) {
      result[key] = deepMerge(t, s);
    } else {
      result[key] = s;
    }
  }
  return result as T & U;
}

function dayBounds(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * Find the latest open ChatSession whose startedAt falls on the given
 * UTC date (YYYY-MM-DD). Create one with startedAt at that day's UTC
 * midnight if none exists.
 */
export async function getOrCreateSession(
  prisma: PrismaClient,
  date: string
): Promise<ChatSession> {
  const { start, end } = dayBounds(date);

  const existing = await prisma.chatSession.findFirst({
    where: {
      startedAt: { gte: start, lt: end },
      closedAt: null,
    },
    orderBy: { startedAt: "desc" },
  });
  if (existing) return existing;

  return prisma.chatSession.create({
    data: { startedAt: start },
  });
}

/**
 * Read and JSON-parse the session's workingMemory. Returns `{}` if the
 * session is missing or the stored payload fails to parse.
 */
export async function readWorkingMemory(
  prisma: PrismaClient,
  sessionId: string
): Promise<Json> {
  const session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
  if (!session) return {};
  try {
    const parsed = JSON.parse(session.workingMemory);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function assertOpen(prisma: PrismaClient, sessionId: string): Promise<ChatSession> {
  const session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error(`ChatSession ${sessionId} not found`);
  if (session.closedAt !== null) {
    throw new Error(`ChatSession ${sessionId} is closed; refusing to write`);
  }
  return session;
}

/**
 * Deep-merge `patch` into the session's workingMemory and persist.
 * Returns the new state. Throws if the session is closed.
 */
export async function mergeWorkingMemory(
  prisma: PrismaClient,
  sessionId: string,
  patch: Json
): Promise<Json> {
  await assertOpen(prisma, sessionId);
  const current = await readWorkingMemory(prisma, sessionId);
  const next = deepMerge(current, patch);
  await prisma.chatSession.update({
    where: { id: sessionId },
    data: { workingMemory: JSON.stringify(next) },
  });
  return next;
}

/**
 * Set or clear the activeFlow column. Throws if the session is closed.
 */
export async function setActiveFlow(
  prisma: PrismaClient,
  sessionId: string,
  flow: string | null
): Promise<void> {
  await assertOpen(prisma, sessionId);
  await prisma.chatSession.update({
    where: { id: sessionId },
    data: { activeFlow: flow },
  });
}

/**
 * Set closedAt if not already set. Idempotent — a second call leaves
 * the original closedAt timestamp intact.
 */
export async function closeSession(
  prisma: PrismaClient,
  sessionId: string
): Promise<void> {
  const session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new Error(`ChatSession ${sessionId} not found`);
  if (session.closedAt !== null) return;
  await prisma.chatSession.update({
    where: { id: sessionId },
    data: { closedAt: new Date() },
  });
}
