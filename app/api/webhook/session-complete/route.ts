/**
 * Webhook for terminal Claude Code session completions in MANAGED
 * projects (the .claude/settings.json Stop hook in each dispatched
 * project POSTs here when a session ends). NOT to be confused with
 * the Overseer ChatSession which is the conversational state inside
 * Cascade's own /api/overseer/chat endpoint — that's a different
 * "session" concept handled in app/api/overseer/. (Phase 16 sign-
 * posting after the two concepts both grew the word "session".)
 *
 * Phase 23.2 — handler correlates Stop hooks to Dispatch rows by
 * `idempotencyKey` (passed via env to the spawned session and round-
 * tripped through the hook payload). This is the canonical path; the
 * legacy "find latest session-launched activity event" lookup remains
 * as a transition-window fallback for managed projects whose hooks
 * haven't been refreshed yet.
 *
 * Phase 41.5 — the ingestion body lives in `lib/webhook-ingest.ts`
 * (`ingestSessionComplete`) so the spool drain (lib/webhook-spool.ts)
 * replays failed pings through the EXACT same path. This route is now a
 * thin HTTP wrapper: validate the external payload, delegate, map the
 * result to a response.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ingestSessionComplete } from "@/lib/webhook-ingest";

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
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) {
      return NextResponse.json(
        { error: "body must be a JSON object" },
        { status: 400 }
      );
    }
    const { projectPath, idempotencyKey } = body as {
      projectPath?: unknown;
      idempotencyKey?: unknown;
    };

    if (!projectPath || typeof projectPath !== "string") {
      return NextResponse.json(
        { error: "projectPath is required" },
        { status: 400 }
      );
    }
    // Phase 42 (P0.1) — a non-string key previously flowed into
    // prisma.findUnique and produced a 500; malformed input is a 400.
    if (idempotencyKey !== undefined && typeof idempotencyKey !== "string") {
      return NextResponse.json(
        { error: "idempotencyKey must be a string" },
        { status: 400 }
      );
    }

    const result = await ingestSessionComplete(prisma, {
      projectPath,
      idempotencyKey,
    });

    // Containment-guard refusal is a client error, not a 200.
    if (result.rejected) {
      return NextResponse.json(
        { error: "projectPath is outside the managed projects root" },
        { status: 400 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
