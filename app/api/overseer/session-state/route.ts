import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOrCreateSession, readWorkingMemory } from "@/lib/chat-session";

/**
 * GET /api/overseer/session-state
 *
 * Returns the day's ChatSession state — id, activeFlow, and parsed
 * workingMemory. Phase 13.5: introduced so the dashboard can read
 * structured outputs (e.g. workingMemory.proposedDispatches) instead
 * of just parsing [DISPATCH] tags from chat text.
 *
 * Query params: date (YYYY-MM-DD, defaults to today UTC)
 *
 * Response shape:
 *   { sessionId, startedAt, activeFlow, workingMemory, closedAt }
 */
export async function GET(request: NextRequest) {
  try {
    const date =
      request.nextUrl.searchParams.get("date") ||
      new Date().toISOString().split("T")[0];

    const session = await getOrCreateSession(prisma, date);
    const workingMemory = await readWorkingMemory(prisma, session.id);

    return NextResponse.json({
      sessionId: session.id,
      startedAt: session.startedAt.toISOString(),
      closedAt: session.closedAt?.toISOString() ?? null,
      activeFlow: session.activeFlow,
      workingMemory,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
