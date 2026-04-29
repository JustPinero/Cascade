/**
 * Phase 13.1 — concurrency tests for the helpers that previously
 * had read-modify-write races. Fires N simultaneous calls and asserts
 * the post-conditions hold (one session per day, no lost list items).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { pushTestSchema } from "@/lib/__test-utils__/prisma-push";
import path from "path";
import fs from "fs";
import {
  getOrCreateSession,
  appendToWorkingMemoryList,
} from "@/lib/chat-session";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-chat-session-concurrency.db");
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

describe("getOrCreateSession — concurrent callers", () => {
  it("20 simultaneous calls for the same date produce ONE session", async () => {
    const calls = Array.from({ length: 20 }, () =>
      getOrCreateSession(prisma, "2026-04-29")
    );
    const sessions = await Promise.all(calls);
    const ids = new Set(sessions.map((s) => s.id));

    expect(ids.size).toBe(1);

    const all = await prisma.chatSession.findMany();
    expect(all.length).toBe(1);
  });

  it("scopes per day even under concurrent load across two dates", async () => {
    const calls = [
      ...Array.from({ length: 10 }, () => getOrCreateSession(prisma, "2026-04-29")),
      ...Array.from({ length: 10 }, () => getOrCreateSession(prisma, "2026-04-30")),
    ];
    const sessions = await Promise.all(calls);
    const ids = new Set(sessions.map((s) => s.id));
    expect(ids.size).toBe(2);
  });
});

describe("appendToWorkingMemoryList — concurrent appends", () => {
  it("retains every item across 20 simultaneous appends", async () => {
    const session = await prisma.chatSession.create({ data: {} });

    const items = Array.from({ length: 20 }, (_, i) => ({ idx: i }));
    await Promise.all(
      items.map((item) =>
        appendToWorkingMemoryList(prisma, session.id, "things", item)
      )
    );

    const reloaded = await prisma.chatSession.findUnique({
      where: { id: session.id },
    });
    const wm = JSON.parse(reloaded!.workingMemory);
    expect(Array.isArray(wm.things)).toBe(true);
    expect(wm.things.length).toBe(20);
    const seen = new Set((wm.things as { idx: number }[]).map((t) => t.idx));
    expect(seen.size).toBe(20); // every idx 0..19 present, none lost
  });

  it("initializes the list when the key has a non-array value", async () => {
    const session = await prisma.chatSession.create({
      data: { workingMemory: JSON.stringify({ things: "not-an-array" }) },
    });
    const result = await appendToWorkingMemoryList(
      prisma,
      session.id,
      "things",
      { x: 1 }
    );
    expect(result.list).toEqual([{ x: 1 }]);
    expect(result.total).toBe(1);
  });

  it("throws when the session is closed", async () => {
    const session = await prisma.chatSession.create({
      data: { closedAt: new Date() },
    });
    await expect(
      appendToWorkingMemoryList(prisma, session.id, "things", { x: 1 })
    ).rejects.toThrow(/closed/i);
  });

  it("rejects appends that would exceed the workingMemory size cap (Phase 17)", async () => {
    const session = await prisma.chatSession.create({ data: {} });
    // 300KB single item — blows the 256KB cap on serialize.
    const huge = { payload: "x".repeat(300 * 1024) };
    await expect(
      appendToWorkingMemoryList(prisma, session.id, "things", huge)
    ).rejects.toThrow(/workingMemory size cap exceeded/);

    // The session was never updated.
    const reloaded = await prisma.chatSession.findUnique({
      where: { id: session.id },
    });
    expect(reloaded?.workingMemory).toBe("{}");
  });
});
