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
  it("returns an empty session state for a fresh date", async () => {
    const res = await GET(makeRequest("date=2026-04-29"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.sessionId).toBe("string");
    expect(body.activeFlow).toBeNull();
    expect(body.workingMemory).toEqual({});
    expect(body.closedAt).toBeNull();
  });

  it("returns activeFlow + workingMemory after they're set", async () => {
    // Seed a session and write to it via the helpers — then assert
    // the route reflects the same state.
    const session = await getOrCreateSession(prisma, "2026-04-29");
    await setActiveFlow(prisma, session.id, "inventory_walk");
    await mergeWorkingMemory(prisma, session.id, {
      covered: { medipal: { progress: 40 } },
    });

    const res = await GET(makeRequest("date=2026-04-29"));
    const body = await res.json();

    expect(body.sessionId).toBe(session.id);
    expect(body.activeFlow).toBe("inventory_walk");
    expect(body.workingMemory).toEqual({
      covered: { medipal: { progress: 40 } },
    });
  });

  it("scopes by date — different dates return different sessions", async () => {
    const today = await GET(makeRequest("date=2026-04-29"));
    const tomorrow = await GET(makeRequest("date=2026-04-30"));
    const a = await today.json();
    const b = await tomorrow.json();
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it("defaults to today's date when no query param is provided", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBeDefined();
  });

  it("surfaces propose_dispatch output (Phase 13.5 use case)", async () => {
    const session = await getOrCreateSession(prisma, "2026-04-29");
    // Simulate what proposeDispatchTool produces
    await mergeWorkingMemory(prisma, session.id, {
      proposedDispatches: [
        { slug: "cascade", mode: "continue", proposedAtISO: "2026-04-29T12:00:00Z" },
        { slug: "medipal", mode: "audit", proposedAtISO: "2026-04-29T12:01:00Z" },
      ],
    });

    const res = await GET(makeRequest("date=2026-04-29"));
    const body = await res.json();
    expect(body.workingMemory.proposedDispatches).toHaveLength(2);
    expect(body.workingMemory.proposedDispatches[0].slug).toBe("cascade");
  });
});
