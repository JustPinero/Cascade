import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";

vi.mock("@/lib/session-reader", () => ({
  getSessionLogs: vi.fn(),
}));

import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { pushTestSchema } from "@/lib/__test-utils__/prisma-push";
import path from "path";
import fs from "fs";
import { sessionLogsTool } from "@/lib/overseer-tools-session-logs";
import type { ToolContext } from "@/lib/overseer-tools";
import { getSessionLogs } from "@/lib/session-reader";

const TEST_DB_PATH = path.resolve(__dirname, "../prisma/test-session-logs.db");
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
  await prisma.project.deleteMany({});
  vi.clearAllMocks();
});

describe("sessionLogsTool", () => {
  it("returns {found:false, logs:[]} for unknown slug", async () => {
    const out = await sessionLogsTool.handler({ slug: "nope" }, ctx());
    expect(out).toEqual({ found: false, slug: "nope", logs: [] });
    expect(getSessionLogs).not.toHaveBeenCalled();
  });

  it("returns logs from session-reader for known slug", async () => {
    await prisma.project.create({
      data: { name: "X", slug: "x", path: "/tmp/x" },
    });
    vi.mocked(getSessionLogs).mockResolvedValueOnce([
      {
        filename: "2026-04-27T09-15-00.md",
        timestamp: "2026-04-27T09:15:00",
        content: "...full content...",
        summary: "phase 11 done",
      },
    ]);

    const out = await sessionLogsTool.handler({ slug: "x" }, ctx());
    expect(out.found).toBe(true);
    expect(out.logs.length).toBe(1);
    expect(out.logs[0].filename).toBe("2026-04-27T09-15-00.md");
    expect(out.logs[0].summary).toBe("phase 11 done");
    expect(getSessionLogs).toHaveBeenCalledWith("/tmp/x", 1);
  });

  it("respects limit", async () => {
    await prisma.project.create({
      data: { name: "X", slug: "x", path: "/tmp/x" },
    });
    vi.mocked(getSessionLogs).mockResolvedValueOnce([]);
    await sessionLogsTool.handler({ slug: "x", limit: 5 }, ctx());
    expect(getSessionLogs).toHaveBeenCalledWith("/tmp/x", 5);
  });

  it("treats reader errors as empty result (not a tool failure)", async () => {
    await prisma.project.create({
      data: { name: "X", slug: "x", path: "/tmp/x" },
    });
    vi.mocked(getSessionLogs).mockRejectedValueOnce(new Error("ENOENT"));
    const out = await sessionLogsTool.handler({ slug: "x" }, ctx());
    expect(out).toEqual({ found: true, slug: "x", logs: [] });
  });
});
