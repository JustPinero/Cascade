import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { pushTestSchema } from "@/lib/__test-utils__/prisma-push";
import path from "path";
import fs from "fs";
import {
  compressMessagesForSession,
  type MessageSummarizer,
} from "@/lib/chat-history-compressor";
import type { AnthropicMessage } from "@/lib/overseer-tools";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-history-compressor.db");
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

function makeMessages(n: number): AnthropicMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `message ${i}`,
  })) as AnthropicMessage[];
}

describe("compressMessagesForSession", () => {
  it("returns input unchanged when message count is at or below threshold", async () => {
    const session = await prisma.chatSession.create({ data: {} });
    const summarizer = vi.fn();
    const messages = makeMessages(10);
    const out = await compressMessagesForSession(prisma, session.id, messages, {
      threshold: 25,
      keepRecent: 10,
      summarizer: summarizer as unknown as MessageSummarizer,
    });
    expect(out).toBe(messages);
    expect(summarizer).not.toHaveBeenCalled();
  });

  it("compresses when message count exceeds threshold", async () => {
    const session = await prisma.chatSession.create({ data: {} });
    const summarizer: MessageSummarizer = vi
      .fn()
      .mockResolvedValueOnce("the user covered projects A, B, C; we deferred D");

    const messages = makeMessages(30);
    const out = await compressMessagesForSession(prisma, session.id, messages, {
      threshold: 25,
      keepRecent: 10,
      summarizer,
    });

    // 1 synthetic summary message + last 10 messages = 11 total
    expect(out.length).toBe(11);
    expect(out[0].role).toBe("user");
    expect(typeof out[0].content === "string" && out[0].content).toContain(
      "Earlier conversation summary"
    );
    expect(typeof out[0].content === "string" && out[0].content).toContain(
      "covered projects A"
    );
    // last verbatim message preserved
    expect(out[10]).toEqual(messages[29]);
  });

  it("persists the summary on the session for reuse", async () => {
    const session = await prisma.chatSession.create({ data: {} });
    const summarizer: MessageSummarizer = vi.fn().mockResolvedValueOnce("first summary");

    await compressMessagesForSession(prisma, session.id, makeMessages(30), {
      threshold: 25,
      keepRecent: 10,
      summarizer,
    });

    const reloaded = await prisma.chatSession.findUnique({ where: { id: session.id } });
    expect(reloaded?.compressedHistory).toBeDefined();
    const cached = JSON.parse(reloaded!.compressedHistory!);
    expect(cached.summarizedThroughMessageCount).toBe(20); // 30 - 10 recent
    expect(cached.summary).toBe("first summary");
  });

  it("reuses the cached summary on a subsequent call with the same older portion", async () => {
    const session = await prisma.chatSession.create({ data: {} });
    const summarizer: MessageSummarizer = vi.fn().mockResolvedValueOnce("cached one");

    await compressMessagesForSession(prisma, session.id, makeMessages(30), {
      threshold: 25,
      keepRecent: 10,
      summarizer,
    });
    expect(summarizer).toHaveBeenCalledTimes(1);

    // same older portion (still 30 messages → cutoff = 20 older), summarizer should NOT fire again
    const out = await compressMessagesForSession(prisma, session.id, makeMessages(30), {
      threshold: 25,
      keepRecent: 10,
      summarizer,
    });
    expect(summarizer).toHaveBeenCalledTimes(1);
    expect(typeof out[0].content === "string" && out[0].content).toContain("cached one");
  });

  it("re-summarizes when the older portion has grown beyond the cached count", async () => {
    const session = await prisma.chatSession.create({ data: {} });
    const summarizer: MessageSummarizer = vi
      .fn()
      .mockResolvedValueOnce("after 30")
      .mockResolvedValueOnce("after 40");

    await compressMessagesForSession(prisma, session.id, makeMessages(30), {
      threshold: 25,
      keepRecent: 10,
      summarizer,
    });

    // Now grow the conversation to 40 messages — older portion is 30, which
    // exceeds the cached 20, so we resummarize
    const out = await compressMessagesForSession(prisma, session.id, makeMessages(40), {
      threshold: 25,
      keepRecent: 10,
      summarizer,
    });

    expect(summarizer).toHaveBeenCalledTimes(2);
    expect(typeof out[0].content === "string" && out[0].content).toContain("after 40");
  });

  it("falls back to raw truncation when the summarizer throws (Phase 14.2)", async () => {
    const session = await prisma.chatSession.create({ data: {} });
    const summarizer: MessageSummarizer = vi
      .fn()
      .mockRejectedValueOnce(new Error("Summarizer API error: 503"));

    const out = await compressMessagesForSession(
      prisma,
      session.id,
      makeMessages(30),
      { threshold: 25, keepRecent: 10, summarizer }
    );

    // Same shape as a successful compression: 1 notice + 10 recent.
    expect(out.length).toBe(11);
    expect(out[0].role).toBe("user");
    expect(typeof out[0].content === "string" && out[0].content).toContain(
      "Earlier conversation truncated"
    );
    expect(typeof out[0].content === "string" && out[0].content).toContain(
      "summarizer was unavailable"
    );

    // Recent messages preserved verbatim.
    expect(out[10]).toEqual(makeMessages(30)[29]);

    // No cache write happened (we don't cache fallback truncations).
    const reloaded = await prisma.chatSession.findUnique({
      where: { id: session.id },
    });
    expect(reloaded?.compressedHistory).toBeNull();
  });

  it("records an ActivityEvent on summarizer fallback (Phase 15)", async () => {
    await prisma.activityEvent.deleteMany({});
    const session = await prisma.chatSession.create({ data: {} });
    const summarizer: MessageSummarizer = vi
      .fn()
      .mockRejectedValueOnce(new Error("Summarizer API error: 503"));

    await compressMessagesForSession(
      prisma,
      session.id,
      makeMessages(30),
      { threshold: 25, keepRecent: 10, summarizer }
    );

    const events = await prisma.activityEvent.findMany({
      where: { eventType: "compressor-fallback" },
    });
    expect(events.length).toBe(1);
    const details = JSON.parse(events[0].details ?? "{}");
    expect(details.sessionId).toBe(session.id);
    expect(details.droppedCount).toBe(20); // 30 - 10 recent
    expect(details.error).toMatch(/503/);
  });

  it("ignores malformed compressedHistory JSON and recomputes", async () => {
    const session = await prisma.chatSession.create({
      data: { compressedHistory: "{not valid" },
    });
    const summarizer: MessageSummarizer = vi
      .fn()
      .mockResolvedValueOnce("recomputed");

    await compressMessagesForSession(prisma, session.id, makeMessages(30), {
      threshold: 25,
      keepRecent: 10,
      summarizer,
    });
    expect(summarizer).toHaveBeenCalledTimes(1);
  });
});
