import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { markAuditsRead } from "@/lib/unread";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const project = await prisma.project.findUnique({
      where: { slug },
      include: {
        auditSnapshots: {
          orderBy: { capturedAt: "desc" },
          take: 10,
        },
        activityEvents: {
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
    });

    if (!project) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    // Mark audits as read when viewing project
    await markAuditsRead(prisma, project.id);

    return NextResponse.json(project);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = await request.json();

    const project = await prisma.project.update({
      where: { slug },
      data: body,
    });

    return NextResponse.json(project);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
