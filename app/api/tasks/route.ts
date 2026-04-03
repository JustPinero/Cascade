import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const VALID_CATEGORIES = new Set([
  "asset",
  "credential",
  "testing",
  "deploy",
  "review",
  "external",
  "other",
]);
const VALID_PRIORITIES = new Set(["high", "normal", "low"]);
const VALID_STATUSES = new Set(["pending", "done"]);

/**
 * GET /api/tasks
 *
 * Returns all human tasks, optionally filtered.
 * Query params: status, projectSlug, category
 */
export async function GET(request: NextRequest) {
  try {
    const status = request.nextUrl.searchParams.get("status");
    const projectSlug = request.nextUrl.searchParams.get("projectSlug");
    const category = request.nextUrl.searchParams.get("category");

    const where: Record<string, unknown> = {};
    if (status && VALID_STATUSES.has(status)) where.status = status;
    if (projectSlug) where.projectSlug = projectSlug;
    if (category && VALID_CATEGORIES.has(category)) where.category = category;

    const tasks = await prisma.humanTask.findMany({
      where,
      orderBy: [
        { status: "asc" }, // pending first
        { priority: "asc" }, // high first (alphabetical: high < low < normal)
        { createdAt: "desc" },
      ],
      include: {
        project: { select: { name: true, slug: true } },
      },
    });

    return NextResponse.json(tasks);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/tasks
 *
 * Create a new human task.
 * Body: { title, category?, priority?, projectSlug?, createdBy? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, category, priority, projectSlug, createdBy } = body;

    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json(
        { error: "title is required" },
        { status: 400 }
      );
    }

    // Resolve project ID from slug if provided
    let projectId: number | null = null;
    if (projectSlug) {
      const project = await prisma.project.findUnique({
        where: { slug: projectSlug },
      });
      if (project) projectId = project.id;
    }

    const task = await prisma.humanTask.create({
      data: {
        title: title.trim(),
        category:
          category && VALID_CATEGORIES.has(category) ? category : "other",
        priority:
          priority && VALID_PRIORITIES.has(priority) ? priority : "normal",
        projectId,
        projectSlug: projectSlug || null,
        createdBy: createdBy || "user",
      },
    });

    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/tasks
 *
 * Update a task (toggle status, change priority, etc).
 * Body: { id, status?, priority?, category? }
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, status, priority, category } = body;

    if (!id || typeof id !== "number") {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 }
      );
    }

    const data: Record<string, unknown> = {};
    if (status && VALID_STATUSES.has(status)) {
      data.status = status;
      data.completedAt = status === "done" ? new Date() : null;
    }
    if (priority && VALID_PRIORITIES.has(priority)) data.priority = priority;
    if (category && VALID_CATEGORIES.has(category)) data.category = category;

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    const task = await prisma.humanTask.update({
      where: { id },
      data,
    });

    return NextResponse.json(task);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/tasks
 *
 * Delete a task.
 * Body: { id }
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { id } = body;

    if (!id || typeof id !== "number") {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 }
      );
    }

    await prisma.humanTask.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
