import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { pushTestSchema } from "@/lib/__test-utils__/prisma-push";
import path from "path";
import fs from "fs";
import { sessionStateTool } from "@/lib/overseer-tools-session-state";
import { ToolRegistry, type ToolContext } from "@/lib/overseer-tools";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-session-state.db");
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

describe("sessionStateTool", () => {
  it("returns sessionId, activeFlow, and parsed workingMemory", async () => {
    const session = await prisma.chatSession.create({
      data: {
        activeFlow: "inventory_walk",
        workingMemory: JSON.stringify({ covered: { medipal: { progress: 40 } } }),
      },
    });
    const ctx: ToolContext = { prisma, sessionId: session.id };
    const out = await sessionStateTool.handler({}, ctx);

    expect(out.sessionId).toBe(session.id);
    expect(out.activeFlow).toBe("inventory_walk");
    expect(out.workingMemory).toEqual({ covered: { medipal: { progress: 40 } } });
  });

  it("returns workingMemory as {} for an empty session", async () => {
    const session = await prisma.chatSession.create({ data: {} });
    const out = await sessionStateTool.handler(
      {},
      { prisma, sessionId: session.id }
    );
    expect(out.workingMemory).toEqual({});
    expect(out.activeFlow).toBeNull();
  });

  it("succeeds on a closed session — read-only, archeology is a legitimate use case (Phase 15)", async () => {
    const session = await prisma.chatSession.create({
      data: {
        closedAt: new Date(),
        activeFlow: "inventory_walk",
        workingMemory: JSON.stringify({ covered: { x: 1 } }),
      },
    });
    const out = await sessionStateTool.handler(
      {},
      { prisma, sessionId: session.id }
    );
    expect(out.sessionId).toBe(session.id);
    expect(out.activeFlow).toBe("inventory_walk");
    expect(out.workingMemory).toEqual({ covered: { x: 1 } });
  });

  it("returns tool error when ctx.sessionId is missing", async () => {
    const reg = new ToolRegistry();
    reg.register(sessionStateTool);
    const result = await reg.execute("get_session_state", {}, { prisma });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/sessionId/);
  });
});
