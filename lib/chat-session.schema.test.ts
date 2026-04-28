import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { pushTestSchema } from "@/lib/__test-utils__/prisma-push";
import path from "path";
import fs from "fs";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-chat-session-schema.db");
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

describe("ChatSession model (phase 12A.1)", () => {
  it("creates a session with cuid id and expected defaults", async () => {
    const session = await prisma.chatSession.create({
      data: {},
    });

    expect(session.id).toBeDefined();
    expect(typeof session.id).toBe("string");
    expect(session.id.length).toBeGreaterThan(0);
    expect(session.startedAt).toBeInstanceOf(Date);
    expect(session.closedAt).toBeNull();
    expect(session.activeFlow).toBeNull();
    expect(session.workingMemory).toBe("{}");
  });

  it("accepts an explicit activeFlow", async () => {
    const session = await prisma.chatSession.create({
      data: { activeFlow: "inventory_walk" },
    });
    expect(session.activeFlow).toBe("inventory_walk");
  });

  it("accepts arbitrary JSON-shaped workingMemory", async () => {
    const session = await prisma.chatSession.create({
      data: {
        workingMemory: JSON.stringify({
          covered: { medipal: { progress: 40 } },
          remaining: ["cascade", "drydock"],
        }),
      },
    });
    const parsed = JSON.parse(session.workingMemory);
    expect(parsed.covered.medipal.progress).toBe(40);
    expect(parsed.remaining).toContain("drydock");
  });

  it("can be closed by setting closedAt", async () => {
    const session = await prisma.chatSession.create({ data: {} });
    const closed = await prisma.chatSession.update({
      where: { id: session.id },
      data: { closedAt: new Date() },
    });
    expect(closed.closedAt).toBeInstanceOf(Date);
  });
});

describe("ChatMessage model (phase 12A.1 extensions)", () => {
  it("creates a message with optional sessionId null (backwards compatible)", async () => {
    const message = await prisma.chatMessage.create({
      data: {
        role: "user",
        content: "hello",
        sessionDate: "2026-04-28",
      },
    });
    expect(message.id).toBeDefined();
    expect(message.sessionId).toBeNull();
    expect(message.toolCalls).toBeNull();
  });

  it("creates a message linked to a ChatSession", async () => {
    const session = await prisma.chatSession.create({ data: {} });
    const message = await prisma.chatMessage.create({
      data: {
        role: "assistant",
        content: "response",
        sessionDate: "2026-04-28",
        sessionId: session.id,
      },
    });
    expect(message.sessionId).toBe(session.id);
  });

  it("loads messages back through the session relation", async () => {
    const session = await prisma.chatSession.create({ data: {} });
    await prisma.chatMessage.createMany({
      data: [
        { role: "user", content: "q1", sessionDate: "2026-04-28", sessionId: session.id },
        { role: "assistant", content: "a1", sessionDate: "2026-04-28", sessionId: session.id },
      ],
    });
    const found = await prisma.chatSession.findUnique({
      where: { id: session.id },
      include: { messages: true },
    });
    expect(found?.messages.length).toBe(2);
  });

  it("accepts toolCalls JSON payload", async () => {
    const payload = JSON.stringify([
      { name: "query_project", input: { slug: "cascade" }, output: { health: "healthy" } },
    ]);
    const message = await prisma.chatMessage.create({
      data: {
        role: "assistant",
        content: "checked cascade",
        sessionDate: "2026-04-28",
        toolCalls: payload,
      },
    });
    expect(message.toolCalls).toBe(payload);
  });
});
