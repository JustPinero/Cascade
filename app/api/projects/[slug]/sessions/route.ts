import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isValidSlug } from "@/lib/validators";
import { getSessionLogs } from "@/lib/session-reader";

/**
 * GET /api/projects/[slug]/sessions
 *
 * Returns session log history for a project.
 * Query params: limit (default 10)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    if (!isValidSlug(slug)) {
      return NextResponse.json({ error: "Invalid slug" }, { status: 400 });
    }

    const project = await prisma.project.findUnique({
      where: { slug },
    });

    if (!project) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    const limitParam = request.nextUrl.searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 10;

    const sessions = await getSessionLogs(project.path, limit);

    return NextResponse.json(sessions);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
