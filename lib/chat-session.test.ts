import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { pushTestSchema } from "@/lib/__test-utils__/prisma-push";
import path from "path";
import fs from "fs";
import {
  getOrCreateSession,
  readWorkingMemory,
  mergeWorkingMemory,
  setActiveFlow,
  closeSession,
  closeStaleSessions,
  deepMerge,
} from "@/lib/chat-session";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-chat-session.db");
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
  // Fresh state per test — sessions only; messages are not used here
  await prisma.chatMessage.deleteMany({});
  await prisma.chatSession.deleteMany({});
});

describe("deepMerge", () => {
  it("merges flat objects", () => {
    expect(deepMerge({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it("overwrites primitive values", () => {
    expect(deepMerge({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
  });

  it("recursively merges nested objects", () => {
    expect(
      deepMerge(
        { covered: { medipal: { progress: 30 } } },
        { covered: { ratracer: { progress: 80 } } }
      )
    ).toEqual({
      covered: {
        medipal: { progress: 30 },
        ratracer: { progress: 80 },
      },
    });
  });

  it("replaces arrays rather than concatenating", () => {
    expect(deepMerge({ remaining: ["a", "b"] }, { remaining: ["c"] })).toEqual({
      remaining: ["c"],
    });
  });

  it("treats null in source as an explicit unset of nested objects", () => {
    expect(deepMerge({ a: { b: 1 } }, { a: null })).toEqual({ a: null });
  });

  it("is non-mutating on the target", () => {
    const target = { a: { b: 1 } };
    const source = { a: { c: 2 } };
    const result = deepMerge(target, source);
    expect(target).toEqual({ a: { b: 1 } });
    expect(result).toEqual({ a: { b: 1, c: 2 } });
  });
});

describe("getOrCreateSession", () => {
  it("creates a session when none exists for the date", async () => {
    const session = await getOrCreateSession(prisma, "2026-04-28");
    expect(session.id).toBeDefined();
    expect(session.closedAt).toBeNull();
    expect(session.workingMemory).toBe("{}");
  });

  it("returns the existing open session for the same date on subsequent calls", async () => {
    const a = await getOrCreateSession(prisma, "2026-04-28");
    const b = await getOrCreateSession(prisma, "2026-04-28");
    expect(b.id).toBe(a.id);
  });

  it("creates a new session if the prior one is closed", async () => {
    const a = await getOrCreateSession(prisma, "2026-04-28");
    await closeSession(prisma, a.id);
    const b = await getOrCreateSession(prisma, "2026-04-28");
    expect(b.id).not.toBe(a.id);
    expect(b.closedAt).toBeNull();
  });

  it("scopes sessions per day", async () => {
    const today = await getOrCreateSession(prisma, "2026-04-28");
    const tomorrow = await getOrCreateSession(prisma, "2026-04-29");
    expect(tomorrow.id).not.toBe(today.id);
  });
});

describe("readWorkingMemory", () => {
  it("returns the parsed JSON document", async () => {
    const session = await prisma.chatSession.create({
      data: { workingMemory: JSON.stringify({ covered: { x: 1 } }) },
    });
    const mem = await readWorkingMemory(prisma, session.id);
    expect(mem).toEqual({ covered: { x: 1 } });
  });

  it("returns {} when the session does not exist", async () => {
    const mem = await readWorkingMemory(prisma, "missing-id");
    expect(mem).toEqual({});
  });

  it("returns {} on malformed JSON without throwing", async () => {
    const session = await prisma.chatSession.create({
      data: { workingMemory: "{not valid json" },
    });
    const mem = await readWorkingMemory(prisma, session.id);
    expect(mem).toEqual({});
  });
});

describe("mergeWorkingMemory", () => {
  it("persists the merged state and returns it", async () => {
    const session = await getOrCreateSession(prisma, "2026-04-28");
    const result = await mergeWorkingMemory(prisma, session.id, {
      covered: { medipal: { progress: 40 } },
    });
    expect(result.covered).toMatchObject({ medipal: { progress: 40 } });

    const reloaded = await readWorkingMemory(prisma, session.id);
    expect(reloaded).toEqual(result);
  });

  it("merges incrementally across calls without overwriting prior keys", async () => {
    const session = await getOrCreateSession(prisma, "2026-04-28");
    await mergeWorkingMemory(prisma, session.id, {
      covered: { medipal: { progress: 40 } },
    });
    const after = await mergeWorkingMemory(prisma, session.id, {
      covered: { ratracer: { blocker: "playwright flake" } },
    });
    expect(after.covered).toMatchObject({
      medipal: { progress: 40 },
      ratracer: { blocker: "playwright flake" },
    });
  });

  it("throws when called against a closed session", async () => {
    const session = await getOrCreateSession(prisma, "2026-04-28");
    await closeSession(prisma, session.id);
    await expect(
      mergeWorkingMemory(prisma, session.id, { foo: "bar" })
    ).rejects.toThrow(/closed/i);
  });
});

describe("workingMemory size cap (Phase 16)", () => {
  it("mergeWorkingMemory throws when the resulting payload exceeds 256KB", async () => {
    const session = await getOrCreateSession(prisma, "2026-04-29");
    // 300KB string — single value blows the cap on serialize.
    const huge = "x".repeat(300 * 1024);
    await expect(
      mergeWorkingMemory(prisma, session.id, { huge })
    ).rejects.toThrow(/workingMemory size cap exceeded/);

    // The session's workingMemory was never written to.
    const reloaded = await prisma.chatSession.findUnique({
      where: { id: session.id },
    });
    expect(reloaded?.workingMemory).toBe("{}");
  });

  it("normal-sized writes pass through unaffected", async () => {
    const session = await getOrCreateSession(prisma, "2026-04-29");
    const out = await mergeWorkingMemory(prisma, session.id, {
      covered: { x: 1 },
    });
    expect(out).toEqual({ covered: { x: 1 } });
  });
});

describe("setActiveFlow", () => {
  it("sets and clears the activeFlow column", async () => {
    const session = await getOrCreateSession(prisma, "2026-04-28");
    await setActiveFlow(prisma, session.id, "inventory_walk");
    const reloaded = await prisma.chatSession.findUnique({
      where: { id: session.id },
    });
    expect(reloaded?.activeFlow).toBe("inventory_walk");

    await setActiveFlow(prisma, session.id, null);
    const cleared = await prisma.chatSession.findUnique({
      where: { id: session.id },
    });
    expect(cleared?.activeFlow).toBeNull();
  });

  it("throws against a closed session", async () => {
    const session = await getOrCreateSession(prisma, "2026-04-28");
    await closeSession(prisma, session.id);
    await expect(
      setActiveFlow(prisma, session.id, "incident_triage")
    ).rejects.toThrow(/closed/i);
  });
});

describe("closeStaleSessions (Phase 14.8)", () => {
  it("closes only sessions older than the cutoff", async () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();

    const stale = await prisma.chatSession.create({
      data: { startedAt: new Date(now - 10 * day) },
    });
    const fresh = await prisma.chatSession.create({
      data: { startedAt: new Date(now - 1 * day) },
    });

    const cutoff = new Date(now - 5 * day);
    const result = await closeStaleSessions(prisma, cutoff);
    expect(result.closed).toBe(1);

    const reloadedStale = await prisma.chatSession.findUnique({
      where: { id: stale.id },
    });
    expect(reloadedStale?.closedAt).toBeInstanceOf(Date);

    const reloadedFresh = await prisma.chatSession.findUnique({
      where: { id: fresh.id },
    });
    expect(reloadedFresh?.closedAt).toBeNull();
  });

  it("does not re-close already-closed sessions", async () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const closed = await prisma.chatSession.create({
      data: {
        startedAt: new Date(now - 10 * day),
        closedAt: new Date(now - 8 * day),
      },
    });

    const result = await closeStaleSessions(
      prisma,
      new Date(now - 5 * day)
    );
    expect(result.closed).toBe(0);

    const reloaded = await prisma.chatSession.findUnique({
      where: { id: closed.id },
    });
    expect(reloaded?.closedAt?.getTime()).toBe(now - 8 * day);
  });

  it("returns {closed: 0} when there are no stale sessions", async () => {
    const result = await closeStaleSessions(
      prisma,
      new Date(Date.now() - 100 * 24 * 60 * 60 * 1000)
    );
    expect(result.closed).toBe(0);
  });
});

describe("closeSession", () => {
  it("sets closedAt and is idempotent", async () => {
    const session = await getOrCreateSession(prisma, "2026-04-28");
    await closeSession(prisma, session.id);
    const closed = await prisma.chatSession.findUnique({
      where: { id: session.id },
    });
    expect(closed?.closedAt).toBeInstanceOf(Date);

    // second close keeps the original timestamp; should not throw
    const firstClose = closed?.closedAt as Date;
    await closeSession(prisma, session.id);
    const reloaded = await prisma.chatSession.findUnique({
      where: { id: session.id },
    });
    expect(reloaded?.closedAt?.getTime()).toBe(firstClose.getTime());
  });
});
