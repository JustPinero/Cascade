import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  dispatchTeam,
  type BatchDispatchItem,
} from "@/lib/claude-dispatcher";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limiter";

const VALID_MODES = new Set(["continue", "audit", "investigate", "custom"]);

/**
 * POST /api/dispatch/team
 *
 * Dispatch a lead Claude with agent teams that coordinates
 * teammates working on multiple projects simultaneously.
 * Body: { items: [{ slug, mode, prompt? }] }
 */
export async function POST(request: NextRequest) {
  const limited = checkRateLimit(
    getRateLimitKey(request, "dispatch-team"),
    3,
    60_000
  );
  if (limited) return limited;

  try {
    const { items } = await request.json();

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "items array is required" },
        { status: 400 }
      );
    }

    const validated: BatchDispatchItem[] = [];
    for (const item of items) {
      if (!item.slug || !item.mode || !VALID_MODES.has(item.mode)) continue;
      validated.push({
        slug: item.slug,
        mode: item.mode,
        prompt: item.prompt || undefined,
      });
    }

    if (validated.length === 0) {
      return NextResponse.json(
        { error: "No valid dispatch items" },
        { status: 400 }
      );
    }

    const result = await dispatchTeam(prisma, validated);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
