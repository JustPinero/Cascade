import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { pushTestSchema } from "@/lib/__test-utils__/prisma-push";
import path from "path";
import fs from "fs";

const TEST_DB_PATH = path.resolve(
  __dirname,
  "../../../../prisma/test-session-state-route.db"
);
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

// Mock @/lib/db so the route reads from our test DB. The mock returns
// a thin proxy that lazy-creates the PrismaClient on first property
// access — this avoids vi.mock's "no top-level vars in the factory"
// constraint while still routing all reads/writes to the same DB the
// helpers below use.
vi.mock("@/lib/db", () => {
  let lazy: PrismaClient | null = null;
  const getClient = () => {
    if (!lazy) {
      const adapter = new PrismaBetterSqlite3({
        url: `file:${path.resolve(
          __dirname,
          "../../../../prisma/test-session-state-route.db"
        )}`,
      });
      lazy = new PrismaClient({ adapter });
    }
    return lazy;
  };
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      const client = getClient() as unknown as Record<string | symbol, unknown>;
      return client[prop];
    },
  };
  return { prisma: new Proxy({}, handler) };
});

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

import { NextRequest } from "next/server";
import { GET } from "@/app/api/overseer/session-state/route";
import {
  getOrCreateSession,
  mergeWorkingMemory,
  setActiveFlow,
} from "@/lib/chat-session";

function makeRequest(query: string = ""): NextRequest {
  const url = `http://localhost:3000/api/overseer/session-state${query ? "?" + query : ""}`;
  return new NextRequest(url, { method: "GET" });
}

describe("GET /api/overseer/session-state", () => {
  it("returns {exists:false} for a fresh date and does NOT create a row (Phase 16)", async () => {
    const before = await prisma.chatSession.count();
    const res = await GET(makeRequest("sessionDate=2026-04-29"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exists).toBe(false);
    expect(body.sessionDate).toBe("2026-04-29");
    expect(body.sessionId).toBeUndefined();

    // No row was created by this read.
    const after = await prisma.chatSession.count();
    expect(after).toBe(before);

    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns activeFlow + workingMemory after they're set", async () => {
    const session = await getOrCreateSession(prisma, "2026-04-29");
    await setActiveFlow(prisma, session.id, "inventory_walk");
    await mergeWorkingMemory(prisma, session.id, {
      covered: { medipal: { progress: 40 } },
    });

    const res = await GET(makeRequest("sessionDate=2026-04-29"));
    const body = await res.json();

    expect(body.exists).toBe(true);
    expect(body.sessionId).toBe(session.id);
    expect(body.activeFlow).toBe("inventory_walk");
    expect(body.workingMemory).toEqual({
      covered: { medipal: { progress: 40 } },
    });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("scopes by date — different dates return different sessions", async () => {
    await getOrCreateSession(prisma, "2026-04-29");
    await getOrCreateSession(prisma, "2026-04-30");

    const today = await GET(makeRequest("sessionDate=2026-04-29"));
    const tomorrow = await GET(makeRequest("sessionDate=2026-04-30"));
    const a = await today.json();
    const b = await tomorrow.json();
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it("defaults to today's date when no query param is provided", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    // exists:false because no session was created for today; the
    // default-date path still returned a structured payload.
    expect(body.exists).toBe(false);
    expect(body.sessionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("rejects malformed sessionDate with 400 (Phase 16)", async () => {
    const res = await GET(makeRequest("sessionDate=not-a-date"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid sessionDate/);
  });

  it("rejects format-matching but invalid dates like 2026-13-99 (Phase 16)", async () => {
    const res = await GET(makeRequest("sessionDate=2026-13-99"));
    expect(res.status).toBe(400);
  });

  it("surfaces propose_dispatch output (Phase 13.5 use case)", async () => {
    const session = await getOrCreateSession(prisma, "2026-04-29");
    await mergeWorkingMemory(prisma, session.id, {
      proposedDispatches: [
        { slug: "cascade", mode: "continue", proposedAtISO: "2026-04-29T12:00:00Z" },
        { slug: "medipal", mode: "audit", proposedAtISO: "2026-04-29T12:01:00Z" },
      ],
    });

    const res = await GET(makeRequest("sessionDate=2026-04-29"));
    const body = await res.json();
    expect(body.workingMemory.proposedDispatches).toHaveLength(2);
    expect(body.workingMemory.proposedDispatches[0].slug).toBe("cascade");
  });
});
