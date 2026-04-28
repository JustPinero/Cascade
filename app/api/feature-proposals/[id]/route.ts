import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const TERMINAL_STATUSES = new Set(["accepted", "rejected", "applied"]);
const VALID_TRANSITIONS = new Set([
  "proposed",
  "accepted",
  "rejected",
  "applied",
]);

/**
 * GET /api/feature-proposals/[id]
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const proposal = await prisma.featureProposal.findUnique({
    where: { id },
    include: {
      feature: {
        select: { id: true, name: true, category: true, description: true },
      },
      project: { select: { id: true, name: true, slug: true } },
    },
  });
  if (!proposal) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ proposal });
}

/**
 * PATCH /api/feature-proposals/[id]
 *
 * Body: { status: "accepted" | "rejected" | "applied", notes?: string,
 *         resolvedBy?: "user" | "claude" | "system" }
 *
 * Records the resolution + a timestamp. Status can transition between
 * any of the four valid values; the UI is the authority on workflow.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const { status, notes, resolvedBy } = body as Record<string, unknown>;

  if (typeof status !== "string" || !VALID_TRANSITIONS.has(status)) {
    return NextResponse.json(
      {
        error: `status must be one of: ${Array.from(VALID_TRANSITIONS).join(", ")}`,
      },
      { status: 400 },
    );
  }
  if (notes !== undefined && typeof notes !== "string") {
    return NextResponse.json({ error: "notes must be a string" }, { status: 400 });
  }
  if (resolvedBy !== undefined && typeof resolvedBy !== "string") {
    return NextResponse.json(
      { error: "resolvedBy must be a string" },
      { status: 400 },
    );
  }

  const existing = await prisma.featureProposal.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isTerminal = TERMINAL_STATUSES.has(status);
  const updated = await prisma.featureProposal.update({
    where: { id },
    data: {
      status,
      notes: typeof notes === "string" ? notes : existing.notes,
      resolvedBy: typeof resolvedBy === "string"
        ? resolvedBy
        : (isTerminal ? existing.resolvedBy ?? "user" : null),
      resolvedAt: isTerminal ? new Date() : null,
    },
  });

  return NextResponse.json({ proposal: updated });
}
