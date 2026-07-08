/**
 * Phase 23.1 — Dispatch Rig.
 *
 * Shared test harness for the dispatch service. Owns scratch SQLite,
 * fake timers, fetch interception, and runtime introspection of the
 * test file's vi.mock'd child_process.
 *
 * Tests using the rig MUST `vi.mock("child_process", ...)` at the top
 * of their file. The rig reads the mocked spawn at runtime to expose
 * `rig.spawnRecords`.
 *
 * fireWebhook integration is intentionally absent in 23.1; it lands in
 * 23.2 alongside the Dispatch table migration (which provides a clean
 * way to thread the rig's prisma into the webhook route handler).
 *
 * Reference: references/dispatch-rig.md.
 */
import path from "path";
import fs from "fs";
import { vi } from "vitest";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import {
  __resetDispatchQueueForTests,
  getDispatchQueue,
} from "@/lib/dispatch-queue";

const CASCADE_ROOT = path.resolve(__dirname, "..", "..");

/**
 * Phase 23.7 — copy the schema-applied template DB instead of running
 * `prisma db push` per-rig.
 *
 * Vitest's globalSetup pushes the schema to test-rig-template.db
 * once per test run. Per-rig DBs are file copies of that template,
 * which avoids:
 *   - Concurrent `prisma db push` invocations from parallel workers
 *     racing on Prisma client regen output (the original flake source)
 *   - Per-rig CLI invocation latency (~1s saved per rig)
 *
 * If the template doesn't exist (rig used outside vitest, e.g. by an
 * eval executor running under tsx), fall back to an inline push using
 * vi.importActual to bypass any test-file child_process mock.
 */
import type {
  DispatchRig,
  DispatchRigOptions,
  SpawnRecord,
  AnthropicMockHandler,
} from "./dispatch-rig.types";

const FIXTURE_PROJECT_PATH = path.resolve(
  __dirname,
  "fixtures",
  "project-skeletons",
  "cascade-test-project"
);

// Match the existing test pattern (lib/__test-utils__/prisma-push.ts):
// scratch DBs live inside the project's prisma/ directory, not /tmp.
// File: URLs with absolute paths under /tmp don't reach the prisma CLI's
// schema-push the same way relative-to-cwd paths do.
const PRISMA_DIR = path.resolve(__dirname, "..", "..", "prisma");

const TEMPLATE_DB_PATH = path.join(PRISMA_DIR, "test-rig-template.db");

/**
 * Phase 41.1 — stale scratch DB sweep.
 *
 * dispose() removes each rig's own scratch DB, but crashed or
 * interrupted runs never reach dispose, so `test-rig-*.db` files
 * accumulate in prisma/ over time. Every rig startup sweeps scratch
 * files whose mtime predates this process by more than a grace
 * window. The window exists so parallel vitest workers (separate
 * processes, started within seconds of each other) never delete a
 * sibling's live scratch DB; anything left from a previous run is
 * minutes-to-hours old and gets removed. The shared template
 * (test-rig-template.db, owned by globalSetup) is never swept.
 */
const RIG_PROCESS_START_MS = Date.now();
const STALE_SWEEP_GRACE_MS = 60_000;

function isRigScratchFile(name: string): boolean {
  if (!name.startsWith("test-rig-")) return false;
  if (name.startsWith("test-rig-template.db")) return false;
  return /\.db(?:-journal|-wal|-shm)?$/.test(name);
}

async function sweepStaleRigDbs(): Promise<void> {
  // Real fs binding — test files often vi.mock("fs").
  const realFs = await vi.importActual<typeof import("fs")>("fs");
  let entries: string[];
  try {
    entries = realFs.readdirSync(PRISMA_DIR);
  } catch {
    return; // best-effort hygiene, never fail the rig over it
  }
  const cutoffMs = RIG_PROCESS_START_MS - STALE_SWEEP_GRACE_MS;
  for (const name of entries) {
    if (!isRigScratchFile(name)) continue;
    const filePath = path.join(PRISMA_DIR, name);
    try {
      if (realFs.statSync(filePath).mtimeMs < cutoffMs) {
        realFs.unlinkSync(filePath);
      }
    } catch {
      // raced with another worker or locked — best-effort
    }
  }
}

async function preparePerRigDb(dbPath: string): Promise<void> {
  // Test files often vi.mock("fs", ...) for the dispatcher's spawn
  // path, which breaks `fs.copyFileSync` here. Use vi.importActual
  // to get the real fs binding for template copy + existsSync.
  const realFs = (await vi.importActual<typeof import("fs")>("fs")) as
    typeof import("fs");
  if (realFs.existsSync(TEMPLATE_DB_PATH)) {
    realFs.copyFileSync(TEMPLATE_DB_PATH, dbPath);
    return;
  }
  const cp = await vi.importActual<typeof import("child_process")>(
    "child_process"
  );
  cp.execSync("pnpm exec prisma db push", {
    cwd: CASCADE_ROOT,
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: `file:${dbPath}` },
  });
}

let rigCounter = 0;

export async function createDispatchRig(
  opts: DispatchRigOptions = {}
): Promise<DispatchRig> {
  const concurrency = opts.concurrency ?? 1;
  const useFakeTimers = opts.fakeTimers !== false;

  // 0. Hygiene — sweep scratch DBs leaked by interrupted prior runs
  //    (Phase 41.1). Runs before fake timers are installed.
  await sweepStaleRigDbs();

  // 1. Scratch SQLite. Copy from the schema-applied template (Phase
  //    23.7); fall back to inline push if the template is missing.
  const dbId = `${process.pid}-${++rigCounter}-${Date.now()}`;
  const dbPath = path.join(PRISMA_DIR, `test-rig-${dbId}.db`);
  const dbUrl = `file:${dbPath}`;
  await preparePerRigDb(dbPath);
  const adapter = new PrismaBetterSqlite3({ url: dbUrl });
  const prisma = new PrismaClient({ adapter });

  // 2. Queue reset + bind rig.queue to the production singleton so
  //    spies and dispatcher calls share the same instance. Concurrency
  //    is driven by CASCADE_MAX_CONCURRENT_SUBAGENTS env (set here for
  //    determinism, restored on dispose).
  __resetDispatchQueueForTests();
  const previousConcurrencyEnv = process.env.CASCADE_MAX_CONCURRENT_SUBAGENTS;
  process.env.CASCADE_MAX_CONCURRENT_SUBAGENTS = String(concurrency);
  const queue = getDispatchQueue();

  // 3. Fake timers
  if (useFakeTimers) {
    vi.useFakeTimers();
  }

  // 4. Anthropic fetch interceptor
  let anthropicHandler: AnthropicMockHandler | null = null;
  const originalFetch = globalThis.fetch;
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
          ? input.toString()
          : (input as Request).url;
      if (url.includes("api.anthropic.com")) {
        if (!anthropicHandler) {
          throw new Error(
            `Anthropic API called without mock — call rig.mockAnthropicResponse(...) before triggering code that hits ${url}`
          );
        }
        let body: unknown = {};
        const rawBody = init?.body;
        if (typeof rawBody === "string") {
          try {
            body = JSON.parse(rawBody);
          } catch {
            body = rawBody;
          }
        }
        const result = anthropicHandler(body);
        const json = result instanceof Promise ? await result : result;
        return new Response(JSON.stringify(json), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // Non-Anthropic URLs pass through. Use originalFetch reference
      // to bypass our own spy.
      return originalFetch(input, init);
    });

  // 5. Spawn-record introspection. The test file's vi.mock'd spawn
  //    is captured here at construction time. We don't replace it;
  //    we just expose its accumulating mock state via spawnRecords.
  const childProcess = await import("child_process");
  const spawnFn = childProcess.spawn as unknown as { mock?: { calls: unknown[][] } };
  const execSyncFn = childProcess.execSync as unknown as { mock?: { calls: unknown[][] } };
  const spawnBaselineCalls = spawnFn?.mock?.calls.length ?? 0;
  void execSyncFn; // touched for symmetry; consumers introspect directly if they need execRecords

  let disposed = false;

  const rig: DispatchRig = {
    prisma,
    queue,
    get spawnRecords(): SpawnRecord[] {
      const calls = spawnFn?.mock?.calls;
      if (!calls) return [];
      return calls.slice(spawnBaselineCalls).map((call) => ({
        command: String(call[0] ?? ""),
        args: Array.isArray(call[1]) ? (call[1] as string[]) : [],
        opts:
          (call[2] as Record<string, unknown> | undefined) ?? {},
      }));
    },

    async createProject(input) {
      const projectPath = input.path ?? FIXTURE_PROJECT_PATH;
      const created = await prisma.project.create({
        data: {
          slug: input.slug,
          name: input.name ?? input.slug,
          path: projectPath,
          status: input.status ?? "building",
          health: input.health ?? "idle",
        },
      });
      return {
        id: created.id,
        slug: created.slug,
        name: created.name,
        path: created.path,
      };
    },

    async advanceTime(ms) {
      if (!useFakeTimers) return;
      await vi.advanceTimersByTimeAsync(ms);
    },

    async getDispatchOutcomes(slug) {
      const where = slug ? { projectSlug: slug } : {};
      const rows = await prisma.dispatchOutcome.findMany({
        where,
        orderBy: { id: "asc" },
      });
      return rows.map((r) => ({
        id: r.id,
        projectSlug: r.projectSlug,
        mode: r.mode,
        outcome: r.outcome,
        dispatchId: r.dispatchId,
      }));
    },

    async getDispatches(slug) {
      const where = slug ? { projectSlug: slug } : {};
      const rows = await prisma.dispatch.findMany({
        where,
        orderBy: { enqueuedAt: "asc" },
      });
      return rows.map((r) => ({
        id: r.id,
        idempotencyKey: r.idempotencyKey,
        projectSlug: r.projectSlug,
        mode: r.mode,
        status: r.status,
        errorMessage: r.errorMessage,
      }));
    },

    /**
     * Invoke the real webhook route handler against rig.prisma.
     *
     * Test files using this method MUST add the following block above
     * any other imports from @/lib/db so the route handler picks up
     * the rig's scratch prisma:
     *
     *   vi.mock("@/lib/db", () => {
     *     const proxy = new Proxy({} as Record<string, unknown>, {
     *       get(_target, prop) {
     *         const inj = (globalThis as Record<string, unknown>).__rigPrisma;
     *         if (!inj) throw new Error("rig prisma not injected — fireWebhook setup failed");
     *         return (inj as Record<string, unknown>)[prop as string];
     *       },
     *     });
     *     return { prisma: proxy };
     *   });
     *
     * The rig populates globalThis.__rigPrisma at call time and
     * clears it after.
     */
    async fireWebhook(opts) {
      const body: Record<string, unknown> = {
        projectPath: opts.projectPath,
      };
      if (opts.idempotencyKey !== undefined) {
        body.idempotencyKey = opts.idempotencyKey;
      }

      // Optional: write a session log fixture so escalation detection
      // has something to read. Resides next to the project path.
      let logFile: string | null = null;
      if (opts.logContent !== undefined) {
        const sessionsDir = path.join(opts.projectPath, ".claude", "sessions");
        try {
          fs.mkdirSync(sessionsDir, { recursive: true });
          logFile = path.join(sessionsDir, `rig-${Date.now()}.log`);
          fs.writeFileSync(logFile, opts.logContent, "utf-8");
        } catch {
          // best-effort; the webhook handler tolerates missing logs
        }
      }

      // Inject prisma for the route handler's @/lib/db import. The
      // boilerplate proxy in test files reads from globalThis so the
      // rig populates it just before invoking the handler.
      const globalKey = "__rigPrisma" as const;
      (globalThis as Record<string, unknown>)[globalKey] = prisma;
      try {
        const route = await import(
          "@/app/api/webhook/session-complete/route"
        );
        const req = new Request(
          "http://localhost/api/webhook/session-complete",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }
        );
        // The handler signature is NextRequest, but plain Request is
        // accepted at runtime — the webhook only uses .json().
        const response = await route.POST(req as unknown as never);
        const status = response.status;
        let json: unknown;
        try {
          json = await response.json();
        } catch {
          json = null;
        }
        return { status, body: json };
      } finally {
        (globalThis as Record<string, unknown>)[globalKey] = null;
        if (logFile) {
          try {
            fs.unlinkSync(logFile);
          } catch {
            // ignore
          }
        }
      }
    },

    async getActivityEvents(opts) {
      const where: Record<string, unknown> = {};
      if (opts?.slug) {
        const project = await prisma.project.findUnique({
          where: { slug: opts.slug },
        });
        if (!project) return [];
        where.projectId = project.id;
      }
      if (opts?.type) {
        where.eventType = opts.type;
      }
      const rows = await prisma.activityEvent.findMany({
        where,
        orderBy: { id: "asc" },
      });
      return rows.map((r) => ({
        id: r.id,
        projectId: r.projectId,
        eventType: r.eventType,
        summary: r.summary,
      }));
    },

    mockAnthropicResponse(handler) {
      anthropicHandler = handler;
    },

    async dispose() {
      // Idempotent — guard against repeated calls.
      if (disposed) return;
      disposed = true;
      fetchSpy.mockRestore();
      if (useFakeTimers && vi.isFakeTimers()) {
        vi.useRealTimers();
      }
      try {
        await prisma.$disconnect();
      } catch {
        // ignore
      }
      __resetDispatchQueueForTests();
      if (previousConcurrencyEnv === undefined) {
        delete process.env.CASCADE_MAX_CONCURRENT_SUBAGENTS;
      } else {
        process.env.CASCADE_MAX_CONCURRENT_SUBAGENTS = previousConcurrencyEnv;
      }
      try {
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        // better-sqlite3 may also create -journal/-wal sidecars
        for (const suffix of ["-journal", "-wal", "-shm"]) {
          const sidecar = `${dbPath}${suffix}`;
          if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
        }
      } catch {
        // ignore — temp dir cleanup is best-effort
      }
    },
  };

  return rig;
}
