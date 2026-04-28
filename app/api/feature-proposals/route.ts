import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const VALID_STATUSES = new Set([
  "proposed",
  "accepted",
  "rejected",
  "applied",
]);

const MAX_LIMIT = 200;

/**
 * GET /api/feature-proposals
 *
 * Query params (all optional):
 *   - status   filter by status (proposed | accepted | rejected | applied)
 *   - project  filter by project slug
 *   - limit    cap result count (1–200, default 50)
 *
 * Returns proposals newest-first with the related feature inlined so
 * the UI can render without a second query.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const projectSlug = url.searchParams.get("project");
  const limitParam = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(limitParam, 1), MAX_LIMIT)
    : 50;

  const where: Record<string, unknown> = {};
  if (status) {
    if (!VALID_STATUSES.has(status)) {
      return NextResponse.json(
        {
          error: `Invalid status. Valid: ${Array.from(VALID_STATUSES).join(", ")}`,
        },
        { status: 400 },
      );
    }
    where.status = status;
  }
  if (projectSlug) {
    const project = await prisma.project.findUnique({
      where: { slug: projectSlug },
      select: { id: true },
    });
    if (!project) {
      return NextResponse.json(
        { error: `Project not found: ${projectSlug}` },
        { status: 404 },
      );
    }
    where.projectId = project.id;
  }

  const proposals = await prisma.featureProposal.findMany({
    where,
    orderBy: { generatedAt: "desc" },
    take: limit,
    include: {
      feature: {
        select: { id: true, name: true, category: true, description: true },
      },
      project: { select: { id: true, name: true, slug: true } },
    },
  });

  return NextResponse.json({
    count: proposals.length,
    limit,
    proposals,
  });
}
