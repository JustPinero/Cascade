/**
 * Phase 41.5 — shared session-complete ingestion.
 *
 * The Stop-hook webhook (app/api/webhook/session-complete/route.ts) and
 * the spool drain (lib/webhook-spool.ts) both need to turn a
 * `{ projectPath, idempotencyKey? }` payload into the full set of DB
 * side effects: complete the Dispatch row, release its queue slot,
 * re-import the project, record a DispatchOutcome (with the Phase 41.2
 * goal state), detect escalations, refresh the feature-usage ledger.
 *
 * Extracting it here means a spooled entry replayed later goes through
 * the EXACT same path as a live POST — no drift between the two. The
 * route is now a thin HTTP wrapper around `ingestSessionComplete`.
 *
 * Prisma is passed in (not imported) so callers thread their own client
 * — the route passes the @/lib/db singleton (proxied in tests), the
 * drain passes whatever client it was handed.
 */
import { PrismaClient } from "@/app/generated/prisma/client";
import { importSingleProject } from "@/lib/project-import";
import { toSlug } from "@/lib/scanner";
import { getSessionLogs } from "@/lib/session-reader";
import { detectEscalations } from "@/lib/escalation-detector";
import { extractGoalCondition, parseGoalOutcome } from "@/lib/dispatch-goals";
import { getDispatchQueue } from "@/lib/dispatch-queue";
import { auditProjectFeatureUsage } from "@/lib/anthropic-feature-check";
import { isInsideProjectsDir } from "@/lib/validators";
import path from "path";

export interface IngestInput {
  projectPath: string;
  idempotencyKey?: string;
}

export interface IngestResult {
  ok: boolean;
  deduped?: boolean;
  /** Phase 42 (P0.1) — payload refused by the containment guard. */
  rejected?: boolean;
  slug: string;
  name?: string | null;
  action?: string | null;
  idempotencyKey?: string;
  importError?: string;
}

/**
 * Map escalation signal types to a DispatchOutcome.outcome value.
 * Shared by the Dispatch-row path and the legacy fallback so the two
 * can never drift.
 */
function deriveOutcome(signalTypes: string[]): string {
  if (signalTypes.includes("needs-attention")) return "attention-needed";
  if (signalTypes.includes("test-failure")) return "test-failure";
  if (signalTypes.includes("human-todo")) return "blocker";
  return "success";
}

/**
 * Ingest a session-complete payload. Assumes `projectPath` is already
 * validated as a non-empty string (the route validates before calling).
 *
 * Returns the response body the webhook echoes to the Stop hook. All
 * downstream work is best-effort: an importSingleProject / outcome /
 * feature-audit failure is logged but never thrown, so the Dispatch
 * lifecycle always closes and the queue slot always frees.
 */
export async function ingestSessionComplete(
  prisma: PrismaClient,
  input: IngestInput
): Promise<IngestResult> {
  const { projectPath, idempotencyKey } = input;

  // Phase 42 (P0.1) — containment guard. The webhook is externally
  // reachable and this path flows into git/fs work (`git status` in a
  // hostile dir is a code-exec vector via .git/config). Refuse anything
  // outside PROJECTS_DIR BEFORE touching the DB, queue, or filesystem.
  // Runs here (not just the route) so spool replays get the same guard.
  // Returning (not throwing) means a spooled hostile entry is consumed
  // and dropped rather than retried forever.
  if (!isInsideProjectsDir(projectPath)) {
    console.error(
      `[webhook-ingest] rejected projectPath outside PROJECTS_DIR: ${projectPath}`
    );
    return { ok: false, rejected: true, slug: "" };
  }

  // Find the originating Dispatch row, if any. Idempotency-key path
  // is the canonical correlation mechanism; legacy lookup runs as
  // fallback only when the key is absent or unknown.
  const dispatch = idempotencyKey
    ? await prisma.dispatch.findUnique({ where: { idempotencyKey } })
    : null;

  // Idempotency: a duplicate Stop hook (or a re-drained spool entry)
  // for an already-completed dispatch returns a deduped response
  // without re-creating outcome or human-task rows.
  if (dispatch && dispatch.status === "completed") {
    return { ok: true, deduped: true, slug: dispatch.projectSlug };
  }

  // Resolve the project slug from the path
  const projectName = path.basename(projectPath);
  const slug = toSlug(projectName);

  // Phase 37 [36.A1] — queue slots are keyed by idempotencyKey.
  // Release the matched row's key; a key-less (legacy) hook falls
  // back to the newest in-flight row for the project, plus the
  // pre-37 projectPath key for transition safety. Best-effort: a
  // release with no matching slot is a no-op.
  const queue = getDispatchQueue();
  if (dispatch) {
    queue.release(dispatch.idempotencyKey);
  } else {
    queue.release(projectPath);
    const latestInFlight = await prisma.dispatch.findFirst({
      where: { projectSlug: slug, status: { in: ["queued", "started"] } },
      orderBy: { enqueuedAt: "desc" },
    });
    if (latestInFlight) {
      queue.release(latestInFlight.idempotencyKey);
    }
  }

  // Run a targeted scan of just this project. Independent of the
  // Dispatch transition — even if this throws we still complete the
  // dispatch row so the queue isn't left dangling.
  let importResult: Awaited<ReturnType<typeof importSingleProject>> | null =
    null;
  let importError: string | null = null;
  try {
    importResult = await importSingleProject(prisma, projectPath);
  } catch (err) {
    importError = err instanceof Error ? err.message : String(err);
  }

  // Find the project to get its ID for activity events / outcomes.
  const project = await prisma.project.findUnique({ where: { slug } });

  // Transition the Dispatch row to completed. Even if no project
  // exists, transition the row so the lifecycle is closed.
  if (dispatch && dispatch.status !== "completed") {
    await prisma.dispatch.update({
      where: { id: dispatch.id },
      data: { status: "completed", completedAt: new Date() },
    });
  }

  // Log session-complete activity event
  if (project && importResult) {
    await prisma.activityEvent.create({
      data: {
        projectId: project.id,
        eventType: "session-complete",
        summary: `Claude session ended on ${importResult.name}`,
        details: JSON.stringify({
          action: importResult.action,
          scannedAt: new Date().toISOString(),
          idempotencyKey: idempotencyKey ?? null,
        }),
      },
    });
  } else if (!project) {
    // Project missing: webhook arrived after deletion or rename.
    // Log an orphaned-webhook event so the operator can see drift.
    await prisma.activityEvent.create({
      data: {
        projectId: null,
        eventType: "orphaned-webhook",
        summary: `Stop hook for unknown project: ${slug}`,
        details: JSON.stringify({
          projectPath,
          idempotencyKey: idempotencyKey ?? null,
          importError,
        }),
      },
    });
  }

  if (project) {
    // Detect escalation signals from the latest session log
    const logs = await getSessionLogs(projectPath, 1);

    // Phase 41.2 — parse the goal evaluator's verdict from the same
    // log. Defensive by contract: parseGoalOutcome never throws, and
    // a log without a marker (or no log at all) leaves goalAchieved
    // null — unknown, not false.
    const goalOutcome =
      logs.length > 0 ? parseGoalOutcome(logs[0].content) : null;
    const goalAchieved = goalOutcome?.achieved ?? null;
    const goalReason = goalOutcome?.reason ?? null;

    const signalTypes: string[] = [];
    if (logs.length > 0) {
      const signals = detectEscalations(logs[0].content);
      for (const signal of signals) {
        signalTypes.push(signal.type);

        // Auto-create human tasks from [HUMAN TODO] signals.
        // Phase 23.2 — dedup on (projectSlug, title) when a Dispatch
        // is in scope; same-message duplicates from a re-fired hook
        // produce one task, not two.
        if (signal.type === "human-todo") {
          const existing = dispatch
            ? await prisma.humanTask.findFirst({
                where: {
                  projectSlug: slug,
                  title: signal.message,
                },
              })
            : null;
          if (!existing) {
            await prisma.humanTask.create({
              data: {
                title: signal.message,
                projectId: project.id,
                projectSlug: slug,
                createdBy: "claude",
              },
            });
          }
        }

        const eventTypeMap: Record<string, string> = {
          "needs-attention": "blocker-detected",
          lesson: "lesson-harvested",
          "test-failure": "blocker-detected",
          "phase-complete": "phase-complete",
          "human-todo": "blocker-detected",
        };
        await prisma.activityEvent.create({
          data: {
            projectId: project.id,
            eventType: eventTypeMap[signal.type] || signal.type,
            summary: `[${signal.type}] ${signal.message}`,
          },
        });
      }
    }

    // Record DispatchOutcome — keyed off the Dispatch row when we
    // found one; otherwise fall back to the legacy "find latest
    // session-launched activity event" lookup so pre-23.2 in-flight
    // dispatches still produce outcomes during the transition window.
    let outcomeWritten = false;
    if (dispatch) {
      try {
        const outcome = deriveOutcome(signalTypes);

        await prisma.dispatchOutcome.create({
          data: {
            projectId: project.id,
            projectSlug: slug,
            mode: dispatch.mode,
            healthAtDispatch: dispatch.healthAtDispatch ?? project.health,
            outcome,
            signals: JSON.stringify(signalTypes),
            dispatchedAt: dispatch.startedAt ?? dispatch.enqueuedAt,
            dispatchId: dispatch.id,
            // Phase 41.2 — goal state. The condition is recovered
            // from the dispatch's composed prompt snapshot; ad-hoc
            // dispatches carry no /goal line and stay null.
            goalCondition: extractGoalCondition(dispatch.prompt),
            goalAchieved,
            goalReason,
          },
        });
        outcomeWritten = true;
      } catch (err) {
        // DispatchOutcome write is independent — failure here must
        // not crash the webhook. Log and continue.
        console.error(
          JSON.stringify({
            event: "dispatch_outcome_write_failed",
            dispatchId: dispatch.id,
            error: err instanceof Error ? err.message : String(err),
          })
        );
      }
    }

    if (!outcomeWritten) {
      // Legacy fallback — find the most recent session-launched
      // activity event for this project.
      const lastDispatch = await prisma.activityEvent.findFirst({
        where: { projectId: project.id, eventType: "session-launched" },
        orderBy: { createdAt: "desc" },
      });
      if (lastDispatch) {
        let dispatchMode = "continue";
        try {
          const details = JSON.parse(lastDispatch.details || "{}");
          dispatchMode = details.mode || "continue";
        } catch {
          // ignore parse error
        }
        const outcome = deriveOutcome(signalTypes);

        try {
          await prisma.dispatchOutcome.create({
            data: {
              projectId: project.id,
              projectSlug: slug,
              mode: dispatchMode,
              healthAtDispatch: project.health,
              outcome,
              signals: JSON.stringify(signalTypes),
              dispatchedAt: lastDispatch.createdAt,
              // Phase 41.2 — no Dispatch row means no composed-prompt
              // snapshot to recover a condition from, but the log's
              // verdict is still worth recording.
              goalAchieved,
              goalReason,
            },
          });
        } catch (err) {
          console.error(
            JSON.stringify({
              event: "dispatch_outcome_legacy_write_failed",
              projectId: project.id,
              error: err instanceof Error ? err.message : String(err),
            })
          );
        }
      }
    }

    // Phase 11.1 — refresh per-project feature usage ledger.
    // Best-effort: a failure here MUST NOT fail the webhook.
    try {
      await auditProjectFeatureUsage(prisma, project.id);
    } catch (auditError) {
      console.error(
        JSON.stringify({
          event: "feature_audit_failed",
          projectId: project.id,
          error:
            auditError instanceof Error
              ? auditError.message
              : String(auditError),
        })
      );
    }
  }

  return {
    ok: true,
    slug: importResult?.slug ?? slug,
    name: importResult?.name ?? null,
    action: importResult?.action ?? null,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(importError ? { importError } : {}),
  };
}
