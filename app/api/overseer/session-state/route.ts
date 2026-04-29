/**
 * Overseer ChatSession state endpoint. NOT to be confused with the
 * webhook at /api/webhook/session-complete, which records terminal
 * Claude Code session completions for managed projects — that's a
 * different "session" concept entirely (Phase 16).
 *
 * GET /api/overseer/session-state
 *   Query params: sessionDate (YYYY-MM-DD, defaults to today UTC)
 *   Returns the day's ChatSession state — id, activeFlow, parsed
 *   workingMemory — for dashboard consumers that want structured
 *   outputs (e.g. workingMemory.proposedDispatches) instead of
 *   parsing chat text.
 *
 *   Read-only by contract (Phase 16). If no session exists yet for
 *   the date, returns {exists: false, sessionDate}. Use the POST
 *   chat endpoint to create a session implicitly via a chat turn.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  getSession,
  isValidSessionDate,
  readWorkingMemory,
} from "@/lib/chat-session";

export async function GET(request: NextRequest) {
  try {
    const raw =
      request.nextUrl.searchParams.get("sessionDate") ||
      new Date().toISOString().split("T")[0];

    if (!isValidSessionDate(raw)) {
      return NextResponse.json(
        { error: `Invalid sessionDate "${raw}"; expected YYYY-MM-DD.` },
        { status: 400 }
      );
    }

    const session = await getSession(prisma, raw);
    if (!session) {
      return NextResponse.json(
        { exists: false, sessionDate: raw },
        {
          headers: {
            // Even an "empty" response shouldn't be cached — the
            // session can spring into existence on the next chat turn.
            "Cache-Control": "no-store",
          },
        }
      );
    }

    const workingMemory = await readWorkingMemory(prisma, session.id);
    return NextResponse.json(
      {
        exists: true,
        sessionId: session.id,
        sessionDate: raw,
        startedAt: session.startedAt.toISOString(),
        closedAt: session.closedAt?.toISOString() ?? null,
        activeFlow: session.activeFlow,
        workingMemory,
      },
      {
        headers: {
          // workingMemory changes on every chat turn — never cache.
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
