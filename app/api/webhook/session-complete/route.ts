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

    const result = await ingestSessionComplete(prisma, {
      projectPath,
      idempotencyKey,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
