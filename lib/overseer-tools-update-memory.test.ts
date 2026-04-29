import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { pushTestSchema } from "@/lib/__test-utils__/prisma-push";
import path from "path";
import fs from "fs";
import { updateSessionMemoryTool } from "@/lib/overseer-tools-update-memory";
import { ToolRegistry, type ToolContext } from "@/lib/overseer-tools";
import { closeSession } from "@/lib/chat-session";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-update-memory.db");
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
  await prisma.chatSession.deleteMany({});
});

describe("updateSessionMemoryTool", () => {
  it("deep-merges patch into the session's working memory and persists", async () => {
    const session = await prisma.chatSession.create({
      data: { workingMemory: JSON.stringify({ covered: { medipal: { progress: 30 } } }) },
    });
    const ctx: ToolContext = { prisma, sessionId: session.id };

    const out = await updateSessionMemoryTool.handler(
      { patch: { covered: { ratracer: { blocker: "playwright flake" } } } },
      ctx
    );

    expect(out.newState.covered).toMatchObject({
      medipal: { progress: 30 },
      ratracer: { blocker: "playwright flake" },
    });

    const reloaded = await prisma.chatSession.findUnique({ where: { id: session.id } });
    expect(JSON.parse(reloaded!.workingMemory)).toEqual(out.newState);
  });

  it("via the registry returns {ok:false, error} when ctx.sessionId is missing", async () => {
    const reg = new ToolRegistry();
    reg.register(updateSessionMemoryTool);
    const result = await reg.execute(
      "update_session_memory",
      { patch: { foo: "bar" } },
      { prisma } // no sessionId
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/sessionId/);
  });

  it("via the registry returns {ok:false, error} when the session is closed", async () => {
    const session = await prisma.chatSession.create({ data: {} });
    await closeSession(prisma, session.id);

    const reg = new ToolRegistry();
    reg.register(updateSessionMemoryTool);
    const result = await reg.execute(
      "update_session_memory",
      { patch: { foo: "bar" } },
      { prisma, sessionId: session.id }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/closed/i);
  });
});
