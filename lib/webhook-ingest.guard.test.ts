/**
 * Phase 42 (P0.1) — containment guard on the session-complete ingest path.
 *
 * The webhook is the one surface external processes can hit. Before this
 * guard, a caller-supplied projectPath was handed straight to git/fs/DB
 * work (`git status` inside a hostile dir is a code-exec vector via
 * .git/config core.fsmonitor). The guard must fire BEFORE any prisma,
 * queue, or filesystem access — these tests pass boobytrapped
 * collaborators that throw on first touch to prove ordering.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ingestSessionComplete } from "./webhook-ingest";
import type { PrismaClient } from "@/app/generated/prisma/client";

const ORIGINAL_PROJECTS_DIR = process.env.PROJECTS_DIR;

beforeAll(() => {
  process.env.PROJECTS_DIR = "/p";
});

afterAll(() => {
  if (ORIGINAL_PROJECTS_DIR === undefined) delete process.env.PROJECTS_DIR;
  else process.env.PROJECTS_DIR = ORIGINAL_PROJECTS_DIR;
});

/** Prisma stand-in that explodes on ANY property access. */
function boobytrappedPrisma(): PrismaClient {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        throw new Error(
          `guard leaked: prisma.${String(prop)} touched for rejected path`
        );
      },
    }
  ) as PrismaClient;
}

describe("ingestSessionComplete containment guard", () => {
  it("rejects out-of-tree projectPath before any prisma access", async () => {
    const result = await ingestSessionComplete(boobytrappedPrisma(), {
      projectPath: "/etc",
    });
    expect(result.ok).toBe(false);
    expect(result.rejected).toBe(true);
  });

  it("rejects traversal-style paths that resolve outside the root", async () => {
    const result = await ingestSessionComplete(boobytrappedPrisma(), {
      projectPath: "/p/legit/../../etc",
    });
    expect(result.ok).toBe(false);
    expect(result.rejected).toBe(true);
  });

  it("accepts an in-tree path (reaches normal processing)", async () => {
    // A path inside /p passes the guard and proceeds to the dispatch
    // lookup — our trap fires there, proving the guard let it through.
    await expect(
      ingestSessionComplete(boobytrappedPrisma(), {
        projectPath: "/p/alpha",
        idempotencyKey: "k1",
      })
    ).rejects.toThrow(/guard leaked: prisma\.dispatch/);
  });
});
