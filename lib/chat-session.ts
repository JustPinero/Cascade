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
 *
 * Wrapped in $transaction (Phase 13.1) to close a TOCTOU race where
 * two simultaneous requests for the same day with no existing session
 * would both pass the findFirst check and both create rows. SQLite
 * acquires a write lock for the duration of the transaction, so only
 * one writer can run the create branch at a time.
 */
export async function getOrCreateSession(
  prisma: PrismaClient,
  date: string
): Promise<ChatSession> {
  const { start, end } = dayBounds(date);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.chatSession.findFirst({
      where: {
        startedAt: { gte: start, lt: end },
        closedAt: null,
      },
      orderBy: { startedAt: "desc" },
    });
    if (existing) return existing;

    return tx.chatSession.create({
      data: { startedAt: start },
    });
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
 * Atomically append `item` to a list at `key` inside the session's
 * workingMemory. Read-modify-write is wrapped in $transaction so two
 * concurrent appends don't race and lose one of the items.
 *
 * If the existing value at `key` is not an array (or is missing), it
 * is initialized to [item]. Throws if the session is closed.
 *
 * Phase 13.1 — replaces the inline read-modify-write in
 * `propose_dispatch` and any other tool that needs append semantics.
 */
export async function appendToWorkingMemoryList(
  prisma: PrismaClient,
  sessionId: string,
  key: string,
  item: unknown
): Promise<{ list: unknown[]; total: number }> {
  return prisma.$transaction(async (tx) => {
    const session = await tx.chatSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      throw new Error(`ChatSession ${sessionId} not found`);
    }
    if (session.closedAt !== null) {
      throw new Error(`ChatSession ${sessionId} is closed; refusing to write`);
    }

    let wm: Json = {};
    try {
      const parsed = JSON.parse(session.workingMemory);
      if (isPlainObject(parsed)) wm = parsed;
    } catch {
      // malformed → reset to empty
    }

    const existingValue = wm[key];
    const list = Array.isArray(existingValue) ? [...existingValue, item] : [item];
    const next = { ...wm, [key]: list };

    await tx.chatSession.update({
      where: { id: sessionId },
      data: { workingMemory: JSON.stringify(next) },
    });

    return { list, total: list.length };
  });
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
