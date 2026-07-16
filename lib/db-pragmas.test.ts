import { describe, it, expect, afterEach } from "vitest";
import path from "path";
import fs from "fs";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { applySqlitePragmas } from "./db-pragmas";

const PRISMA_DIR = path.resolve(__dirname, "..", "prisma");

const scratchFiles: string[] = [];
const clients: PrismaClient[] = [];

function makeScratchClient(): PrismaClient {
  const dbPath = path.join(
    PRISMA_DIR,
    `test-rig-${process.pid}-pragmas-${Date.now()}-${scratchFiles.length}.db`
  );
  scratchFiles.push(dbPath);
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  const client = new PrismaClient({ adapter });
  clients.push(client);
  return client;
}

afterEach(async () => {
  for (const c of clients.splice(0)) {
    try {
      await c.$disconnect();
    } catch {
      // ignore
    }
  }
  for (const f of scratchFiles.splice(0)) {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      try {
        fs.unlinkSync(`${f}${suffix}`);
      } catch {
        // ignore
      }
    }
  }
});

describe("applySqlitePragmas", () => {
  it("enables WAL and NORMAL synchronous", async () => {
    const client = makeScratchClient();
    await applySqlitePragmas(client);

    const journal = await client.$queryRawUnsafe<{ journal_mode: string }[]>(
      "PRAGMA journal_mode;"
    );
    expect(journal[0]?.journal_mode?.toLowerCase()).toBe("wal");

    const sync = await client.$queryRawUnsafe<{ synchronous: unknown }[]>(
      "PRAGMA synchronous;"
    );
    // NORMAL = 1 (adapter may surface number or bigint)
    expect(Number(sync[0]?.synchronous)).toBe(1);
  });

  it("swallows pragma failures", async () => {
    const failing = {
      $queryRawUnsafe: async () => {
        throw new Error("boom");
      },
    };
    await expect(applySqlitePragmas(failing)).resolves.toBeUndefined();
  });
});
