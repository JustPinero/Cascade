import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { pushTestSchema } from "@/lib/__test-utils__/prisma-push";
import path from "path";
import fs from "fs";
import { yesterdaySummaryTool } from "@/lib/overseer-tools-yesterday-summary";
import type { ToolContext } from "@/lib/overseer-tools";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-yesterday-summary.db");
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

let prisma: PrismaClient;
function ctx(): ToolContext {
  return { prisma };
}

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
});

function dateNDaysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
}

describe("yesterdaySummaryTool", () => {
  it("returns found:false with empty messages when no rows for that date", async () => {
    const out = await yesterdaySummaryTool.handler({}, ctx());
    expect(out.found).toBe(false);
    expect(out.messages).toEqual([]);
  });

  it("returns the latest 3 assistant messages from yesterday in chronological order", async () => {
    const yesterday = dateNDaysAgo(1);
    for (let i = 1; i <= 5; i++) {
      await prisma.chatMessage.create({
        data: {
          role: "assistant",
          content: `assistant message ${i}`,
          sessionDate: yesterday,
        },
      });
    }
    // user messages on the same day should be ignored
    await prisma.chatMessage.create({
      data: { role: "user", content: "user msg", sessionDate: yesterday },
    });

    const out = await yesterdaySummaryTool.handler({}, ctx());
    expect(out.found).toBe(true);
    expect(out.messages.length).toBe(3);
    // chronological — oldest of the latest 3 first
    expect(out.messages[0].content).toBe("assistant message 3");
    expect(out.messages[2].content).toBe("assistant message 5");
  });

  it("respects daysAgo (e.g. daysAgo=2 looks at the day before yesterday)", async () => {
    const dayBefore = dateNDaysAgo(2);
    await prisma.chatMessage.create({
      data: { role: "assistant", content: "older", sessionDate: dayBefore },
    });

    const out = await yesterdaySummaryTool.handler({ daysAgo: 2 }, ctx());
    expect(out.found).toBe(true);
    expect(out.messages[0].content).toBe("older");
  });

  it("truncates each message at perMessageMaxChars", async () => {
    const yesterday = dateNDaysAgo(1);
    await prisma.chatMessage.create({
      data: { role: "assistant", content: "x".repeat(1000), sessionDate: yesterday },
    });

    const out = await yesterdaySummaryTool.handler(
      { perMessageMaxChars: 50 },
      ctx()
    );
    expect(out.messages[0].content.length).toBe(50);
  });
});
