import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { pushTestSchema } from "@/lib/__test-utils__/prisma-push";
import path from "path";
import fs from "fs";
import { backfillChatSessions } from "./backfill-chat-sessions";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-backfill-sessions.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

let prisma: PrismaClient;

beforeAll(async () => {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const adapter = new PrismaBetterSqlite3({ url: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
  pushTestSchema(TEST_DB_URL);
});

afterAll(async () => {
  await prisma.$disconnect();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});

beforeEach(async () => {
  await prisma.chatMessage.deleteMany({});
  await prisma.chatSession.deleteMany({});
});

describe("backfillChatSessions", () => {
  it("creates one ChatSession per unique sessionDate", async () => {
    await prisma.chatMessage.createMany({
      data: [
        { role: "user", content: "q1", sessionDate: "2026-04-26" },
        { role: "assistant", content: "a1", sessionDate: "2026-04-26" },
        { role: "user", content: "q2", sessionDate: "2026-04-27" },
      ],
    });

    const result = await backfillChatSessions(prisma);

    const sessions = await prisma.chatSession.findMany({
      orderBy: { startedAt: "asc" },
    });
    expect(sessions.length).toBe(2);
    expect(result.sessionsCreated).toBe(2);
    expect(result.messagesUpdated).toBe(3);
  });

  it("assigns sessionId on every backfilled message", async () => {
    await prisma.chatMessage.createMany({
      data: [
        { role: "user", content: "q1", sessionDate: "2026-04-26" },
        { role: "assistant", content: "a1", sessionDate: "2026-04-26" },
      ],
    });

    await backfillChatSessions(prisma);

    const messages = await prisma.chatMessage.findMany();
    expect(messages.every((m) => m.sessionId !== null)).toBe(true);
    const ids = new Set(messages.map((m) => m.sessionId));
    expect(ids.size).toBe(1);
  });

  it("is idempotent — second run is a no-op", async () => {
    await prisma.chatMessage.createMany({
      data: [
        { role: "user", content: "q1", sessionDate: "2026-04-26" },
        { role: "user", content: "q2", sessionDate: "2026-04-27" },
      ],
    });

    const first = await backfillChatSessions(prisma);
    expect(first.sessionsCreated).toBe(2);
    expect(first.messagesUpdated).toBe(2);

    const second = await backfillChatSessions(prisma);
    expect(second.sessionsCreated).toBe(0);
    expect(second.messagesUpdated).toBe(0);

    const sessions = await prisma.chatSession.findMany();
    expect(sessions.length).toBe(2);
  });

  it("does not touch messages that already have a sessionId", async () => {
    const existing = await prisma.chatSession.create({ data: {} });
    await prisma.chatMessage.create({
      data: {
        role: "user",
        content: "preassigned",
        sessionDate: "2026-04-26",
        sessionId: existing.id,
      },
    });
    await prisma.chatMessage.create({
      data: { role: "user", content: "needs-backfill", sessionDate: "2026-04-26" },
    });

    const result = await backfillChatSessions(prisma);

    // preassigned message keeps its session; only the unassigned one gets backfilled
    expect(result.messagesUpdated).toBe(1);

    const messages = await prisma.chatMessage.findMany({ orderBy: { id: "asc" } });
    expect(messages[0].sessionId).toBe(existing.id);
    expect(messages[1].sessionId).not.toBeNull();
    expect(messages[1].sessionId).not.toBe(existing.id);
  });

  it("preserves sessionDate on every message", async () => {
    await prisma.chatMessage.createMany({
      data: [
        { role: "user", content: "q1", sessionDate: "2026-04-26" },
        { role: "user", content: "q2", sessionDate: "2026-04-27" },
      ],
    });

    await backfillChatSessions(prisma);

    const messages = await prisma.chatMessage.findMany({ orderBy: { id: "asc" } });
    expect(messages[0].sessionDate).toBe("2026-04-26");
    expect(messages[1].sessionDate).toBe("2026-04-27");
  });

  it("backfilled session.startedAt aligns with the session date (UTC midnight)", async () => {
    await prisma.chatMessage.create({
      data: { role: "user", content: "q1", sessionDate: "2026-04-26" },
    });

    await backfillChatSessions(prisma);

    const session = await prisma.chatSession.findFirst();
    expect(session?.startedAt.toISOString().startsWith("2026-04-26")).toBe(true);
    expect(session?.closedAt).toBeInstanceOf(Date);
  });

  it("dryRun=true does not write to the database", async () => {
    await prisma.chatMessage.createMany({
      data: [
        { role: "user", content: "q1", sessionDate: "2026-04-26" },
      ],
    });

    const result = await backfillChatSessions(prisma, { dryRun: true });
    expect(result.sessionsCreated).toBe(1);
    expect(result.messagesUpdated).toBe(1);

    const sessions = await prisma.chatSession.findMany();
    expect(sessions.length).toBe(0);
    const messages = await prisma.chatMessage.findMany();
    expect(messages[0].sessionId).toBeNull();
  });
});
