/**
 * Webhook for terminal Claude Code session completions in MANAGED
 * projects (the .claude/settings.json Stop hook in each dispatched
 * project POSTs here when a session ends). NOT to be confused with
 * the Overseer ChatSession which is the conversational state inside
 * Cascade's own /api/overseer/chat endpoint — that's a different
 * "session" concept handled in app/api/overseer/. (Phase 16 sign-
 * posting after the two concepts both grew the word "session".)
 *
 * Phase 23.2 — handler now correlates Stop hooks to Dispatch rows by
 * `idempotencyKey` (passed via env to the spawned session and round-
 * tripped through the hook payload). This is the canonical path; the
 * legacy "find latest session-launched activity event" lookup remains
 * as a transition-window fallback for managed projects whose hooks
 * haven't been refreshed yet.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { importSingleProject } from "@/lib/project-import";
import { toSlug } from "@/lib/scanner";
import { getSessionLogs } from "@/lib/session-reader";
import { detectEscalations } from "@/lib/escalation-detector";
import { getDispatchQueue } from "@/lib/dispatch-queue";
import { auditProjectFeatureUsage } from "@/lib/anthropic-feature-check";
import path from "path";

/**
 * POST /api/webhook/session-complete
 *
 * Receives a ping from a Claude Code Stop hook when a session ends.
 * Triggers a targeted scan of just that project, completes the
 * matching Dispatch row, records a DispatchOutcome.
 *
 * Body: { projectPath: string, idempotencyKey?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectPath, idempotencyKey } = body as {
      projectPath?: string;
      idempotencyKey?: string;
    };

    if (!projectPath || typeof projectPath !== "string") {
      return NextResponse.json(
        { error: "projectPath is required" },
        { status: 400 }
      );
    }

    // Find the originating Dispatch row, if any. Idempotency-key path
    // is the canonical correlation mechanism; legacy lookup runs as
    // fallback only when the key is absent or unknown.
    const dispatch = idempotencyKey
      ? await prisma.dispatch.findUnique({ where: { idempotencyKey } })
      : null;

    // Idempotency: a duplicate Stop hook for an already-completed
    // dispatch returns a deduped response without re-creating outcome
    // or human-task rows.
    if (dispatch && dispatch.status === "completed") {
      return NextResponse.json({
        ok: true,
        deduped: true,
        slug: dispatch.projectSlug,
      });
    }

    // Release the queue slot keyed by projectPath. Best-effort: if no
    // matching slot exists this is a no-op.
    getDispatchQueue().release(projectPath);

    // Resolve the project slug from the path
    const projectName = path.basename(projectPath);
    const slug = toSlug(projectName);

    // Run a targeted scan of just this project. Independent of the
    // Dispatch transition — even if this throws we still complete the
    // dispatch row so the queue isn't left dangling.
    let importResult: Awaited<ReturnType<typeof importSingleProject>> | null = null;
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
          let outcome = "success";
          if (signalTypes.includes("needs-attention")) outcome = "attention-needed";
          else if (signalTypes.includes("test-failure")) outcome = "test-failure";
          else if (signalTypes.includes("human-todo")) outcome = "blocker";

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
          let outcome = "success";
          if (signalTypes.includes("needs-attention")) outcome = "attention-needed";
          else if (signalTypes.includes("test-failure")) outcome = "test-failure";
          else if (signalTypes.includes("human-todo")) outcome = "blocker";

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

    return NextResponse.json({
      ok: true,
      slug: importResult?.slug ?? slug,
      name: importResult?.name ?? null,
      action: importResult?.action ?? null,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      ...(importError ? { importError } : {}),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
