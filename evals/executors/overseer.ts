/**
 * Phase 23.7 — overseer-tool-sequence kind executor.
 *
 * Runs the real `runToolUseLoop` against a scratch SQLite seeded with
 * the scenario's preconditions, with the Anthropic caller swapped for
 * a recorder. The recorder either replays a committed response (CI)
 * or hits the live API when `--record` is set (manual refresh).
 *
 * No fixtures ship in 23.7 — Overseer fixtures need a live-API record
 * pass to seed recordings, deferred to a follow-up slice. The
 * executor is registered now so the future fixture author has nothing
 * to wire up.
 */
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import {
  runToolUseLoop,
  type ToolContext,
} from "@/lib/overseer-tools";
import { buildDefaultRegistry } from "@/lib/overseer-tools-registry-default";
import { TOOL_PATH_SYSTEM_PROMPT } from "@/app/api/overseer/chat/route";
import { createRecorder } from "../recorder";
import { assertToolSequence, extractToolCalls } from "../asserters";
import type { KindExecutor } from "../runner";
import type {
  OverseerScenarioInput,
  OverseerToolSequenceExpectation,
} from "../types";
import { getOrCreateSession } from "@/lib/chat-session";

const PRISMA_DIR = path.resolve(__dirname, "..", "..", "prisma");
const CASCADE_ROOT = path.resolve(__dirname, "..", "..");

let scratchCounter = 0;

function buildScratchPrisma(): {
  prisma: PrismaClient;
  cleanup: () => void;
} {
  const dbId = `${process.pid}-${++scratchCounter}-${Date.now()}`;
  const dbPath = path.join(PRISMA_DIR, `eval-overseer-${dbId}.db`);
  const dbUrl = `file:${dbPath}`;
  execSync("pnpm exec prisma db push", {
    cwd: CASCADE_ROOT,
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: dbUrl },
  });
  const adapter = new PrismaBetterSqlite3({ url: dbUrl });
  const prisma = new PrismaClient({ adapter });
  return {
    prisma,
    cleanup: async () => {
      try {
        await prisma.$disconnect();
      } catch {
        /* ignore */
      }
      try {
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        for (const suffix of ["-journal", "-wal", "-shm"]) {
          const sidecar = `${dbPath}${suffix}`;
          if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
        }
      } catch {
        /* ignore */
      }
    },
  } as { prisma: PrismaClient; cleanup: () => void };
}

async function seedPreconditions(
  prisma: PrismaClient,
  pre: OverseerScenarioInput["preconditions"]
): Promise<void> {
  if (!pre) return;
  const slugToId = new Map<string, number>();

  if (pre.projects) {
    for (const p of pre.projects) {
      const created = await prisma.project.create({
        data: {
          slug: p.slug,
          name: p.name ?? p.slug,
          path: p.path ?? `/eval-fixture/${p.slug}`,
          status: p.status ?? "building",
          health: p.health ?? "idle",
          currentPhase: p.phase ?? "phase-1-foundation",
          progressScore: p.progressScore ?? 0,
        },
      });
      slugToId.set(p.slug, created.id);
    }
  }

  if (pre.activityEvents) {
    for (const e of pre.activityEvents) {
      const projectId = slugToId.get(e.projectSlug);
      if (!projectId) continue;
      await prisma.activityEvent.create({
        data: {
          projectId,
          eventType: e.eventType,
          summary: e.summary,
          details: e.details,
        },
      });
    }
  }

  if (pre.dispatchOutcomes) {
    for (const o of pre.dispatchOutcomes) {
      const projectId = slugToId.get(o.projectSlug);
      if (!projectId) continue;
      await prisma.dispatchOutcome.create({
        data: {
          projectId,
          projectSlug: o.projectSlug,
          mode: o.mode,
          healthAtDispatch: "healthy",
          outcome: o.outcome,
          signals: JSON.stringify(o.signals ?? []),
          dispatchedAt: o.dispatchedAt ? new Date(o.dispatchedAt) : new Date(),
        },
      });
    }
  }

  if (pre.knowledgeLessons) {
    for (const l of pre.knowledgeLessons) {
      await prisma.knowledgeLesson.create({
        data: {
          title: l.title,
          content: l.content,
          category: l.category,
          severity: l.severity ?? "nice-to-know",
          tags: JSON.stringify(l.tags ?? []),
        },
      });
    }
  }
}

export const overseerExecutor: KindExecutor = async (scenario, opts) => {
  const input = scenario.input as OverseerScenarioInput;
  const expected = scenario.assert as OverseerToolSequenceExpectation;
  const scenarioDir = path.join(
    path.dirname(opts.scenarioPath),
    "..",
    "..",
    "recordings",
    "overseer-tool-sequence",
    scenario.name
  );

  const { prisma, cleanup } = buildScratchPrisma();
  try {
    await seedPreconditions(prisma, input.preconditions);
    const session = await getOrCreateSession(prisma, "2026-05-04");

    const recorder = createRecorder({
      mode: opts.mode,
      scenarioDir,
      // liveCaller is only required in record mode — the recorder
      // throws a clear error if record mode is set without one.
      // Future: thread defaultAnthropicCaller through here when the
      // refresh slice ships.
    });

    const registry = buildDefaultRegistry();
    const ctx: ToolContext = { prisma, sessionId: session.id };

    const messages = input.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const result = await runToolUseLoop({
      caller: recorder,
      model: "claude-sonnet-4-6",
      systemPrompt: TOOL_PATH_SYSTEM_PROMPT,
      messages,
      registry,
      ctx,
    });

    const toolCalls = extractToolCalls(result.messages);
    return assertToolSequence(
      { toolCalls, finalText: result.finalText },
      expected
    );
  } finally {
    await cleanup();
  }
};
