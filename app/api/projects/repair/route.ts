import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { scanForOrphans, applyRepair, type RepairAction } from "@/lib/migration-repair";
import { resolveProjectsDir } from "@/lib/validators";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limiter";

const VALID_ACTIONS: RepairAction[] = ["clone", "archive", "delete", "skip"];

export async function POST(request: NextRequest) {
  const limited = checkRateLimit(getRateLimitKey(request, "repair"), 5, 60_000);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Request body is required" }, { status: 400 });
  }

  const { action } = body as Record<string, unknown>;

  if (!action) {
    return NextResponse.json({ error: "action is required" }, { status: 400 });
  }

  const projectsDir = resolveProjectsDir();

  if (action === "scan") {
    try {
      const orphans = await scanForOrphans(prisma, { projectsDir });
      return NextResponse.json({ orphans });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Scan failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  if (action === "apply") {
    const { id, repair } = body as Record<string, unknown>;

    if (typeof id !== "number") {
      return NextResponse.json({ error: "id (number) is required for apply" }, { status: 400 });
    }

    if (!repair || !VALID_ACTIONS.includes(repair as RepairAction)) {
      return NextResponse.json(
        { error: `repair must be one of: ${VALID_ACTIONS.join(", ")}` },
        { status: 400 }
      );
    }

    try {
      const result = await applyRepair(prisma, id, repair as RepairAction, { projectsDir });
      return NextResponse.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Repair failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  return NextResponse.json(
    { error: `Unknown action "${String(action)}". Use "scan" or "apply".` },
    { status: 400 }
  );
}
