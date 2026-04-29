import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { pushTestSchema } from "@/lib/__test-utils__/prisma-push";
import path from "path";
import fs from "fs";
import { setActiveFlowTool } from "@/lib/overseer-tools-set-flow";
import { ToolRegistry, type ToolContext } from "@/lib/overseer-tools";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-set-flow.db");
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

describe("setActiveFlowTool", () => {
  it("accepts whitelisted flow values and persists them", async () => {
    const session = await prisma.chatSession.create({ data: {} });
    const ctx: ToolContext = { prisma, sessionId: session.id };

    for (const flow of ["inventory_walk", "dispatch_planning", "incident_triage"] as const) {
      const out = await setActiveFlowTool.handler({ flow }, ctx);
      expect(out.flow).toBe(flow);
      const reloaded = await prisma.chatSession.findUnique({
        where: { id: session.id },
      });
      expect(reloaded?.activeFlow).toBe(flow);
    }
  });

  it("clears the flow with null", async () => {
    const session = await prisma.chatSession.create({
      data: { activeFlow: "inventory_walk" },
    });
    const ctx: ToolContext = { prisma, sessionId: session.id };
    await setActiveFlowTool.handler({ flow: null }, ctx);
    const reloaded = await prisma.chatSession.findUnique({
      where: { id: session.id },
    });
    expect(reloaded?.activeFlow).toBeNull();
  });

  it("rejects unknown flow strings via the registry", async () => {
    const session = await prisma.chatSession.create({ data: {} });
    const reg = new ToolRegistry();
    reg.register(setActiveFlowTool);
    const result = await reg.execute(
      "set_active_flow",
      { flow: "nonsense" },
      { prisma, sessionId: session.id }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Unknown flow/);
  });

  it("returns tool error when ctx.sessionId is missing", async () => {
    const reg = new ToolRegistry();
    reg.register(setActiveFlowTool);
    const result = await reg.execute(
      "set_active_flow",
      { flow: "inventory_walk" },
      { prisma }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/sessionId/);
  });
});
