import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUsageSummary } from "@/lib/observability/usage-summary";

/**
 * Phase 39 [P8] — today's Anthropic spend for the dashboard cost
 * widget. "Today" is local midnight — Cascade is a local-first,
 * single-user app, so the box's timezone is the user's timezone.
 */
export async function GET() {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);

  const summary = await getUsageSummary(prisma, { since: midnight });
  return NextResponse.json(summary, {
    headers: { "Cache-Control": "no-store" },
  });
}
