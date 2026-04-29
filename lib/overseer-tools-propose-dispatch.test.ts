import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { pushTestSchema } from "@/lib/__test-utils__/prisma-push";
import path from "path";
import fs from "fs";
import { proposeDispatchTool } from "@/lib/overseer-tools-propose-dispatch";
import { ToolRegistry, type ToolContext } from "@/lib/overseer-tools";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-propose-dispatch.db");
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

describe("proposeDispatchTool", () => {
  it("appends to workingMemory.proposedDispatches and persists", async () => {
    const session = await prisma.chatSession.create({ data: {} });
    const ctx: ToolContext = { prisma, sessionId: session.id };

    const out = await proposeDispatchTool.handler(
      { slug: "cascade", mode: "continue", instructions: "finish phase-12" },
      ctx
    );
    expect(out.proposal.slug).toBe("cascade");
    expect(out.proposal.mode).toBe("continue");
    expect(out.proposal.instructions).toBe("finish phase-12");
    expect(out.totalProposed).toBe(1);

    const reloaded = await prisma.chatSession.findUnique({ where: { id: session.id } });
    const wm = JSON.parse(reloaded!.workingMemory);
    expect(wm.proposedDispatches).toHaveLength(1);
    expect(wm.proposedDispatches[0].slug).toBe("cascade");
  });

  it("accumulates multiple proposals across calls", async () => {
    const session = await prisma.chatSession.create({ data: {} });
    const ctx: ToolContext = { prisma, sessionId: session.id };

    await proposeDispatchTool.handler({ slug: "a", mode: "continue" }, ctx);
    await proposeDispatchTool.handler({ slug: "b", mode: "audit" }, ctx);
    const out = await proposeDispatchTool.handler({ slug: "c", mode: "investigate" }, ctx);

    expect(out.totalProposed).toBe(3);
    const reloaded = await prisma.chatSession.findUnique({ where: { id: session.id } });
    const wm = JSON.parse(reloaded!.workingMemory);
    expect(wm.proposedDispatches.map((p: { slug: string }) => p.slug)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("rejects unknown modes via the registry", async () => {
    const session = await prisma.chatSession.create({ data: {} });
    const reg = new ToolRegistry();
    reg.register(proposeDispatchTool);
    const result = await reg.execute(
      "propose_dispatch",
      { slug: "x", mode: "yolo" },
      { prisma, sessionId: session.id }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Unknown mode/);
  });

  it("returns tool error when ctx.sessionId is missing", async () => {
    const reg = new ToolRegistry();
    reg.register(proposeDispatchTool);
    const result = await reg.execute(
      "propose_dispatch",
      { slug: "x", mode: "continue" },
      { prisma }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/sessionId/);
  });
});
