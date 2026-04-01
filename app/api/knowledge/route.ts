import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const lessons = await prisma.knowledgeLesson.findMany({
      orderBy: { discoveredAt: "desc" },
      include: {
        sourceProject: { select: { name: true, slug: true } },
      },
    });

    return NextResponse.json(lessons);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
