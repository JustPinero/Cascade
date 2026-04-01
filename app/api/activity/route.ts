import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const eventType = searchParams.get("type");
    const limit = Math.min(
      parseInt(searchParams.get("limit") || "20"),
      100
    );

    const where = eventType ? { eventType } : {};

    const events = await prisma.activityEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        project: {
          select: { name: true, slug: true },
        },
      },
    });

    return NextResponse.json(events);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
