import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * GET /api/overseer/history
 *
 * Returns chat messages for a given date (defaults to today).
 * Query params: date (YYYY-MM-DD)
 */
export async function GET(request: NextRequest) {
  try {
    const date =
      request.nextUrl.searchParams.get("date") ||
      new Date().toISOString().split("T")[0];

    const messages = await prisma.chatMessage.findMany({
      where: { sessionDate: date },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(messages);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/overseer/history
 *
 * Save a chat message.
 * Body: { role, content, sessionDate? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { role, content, sessionDate } = body;

    if (!role || !content) {
      return NextResponse.json(
        { error: "role and content are required" },
        { status: 400 }
      );
    }

    const date =
      sessionDate || new Date().toISOString().split("T")[0];

    const msg = await prisma.chatMessage.create({
      data: { role, content, sessionDate: date },
    });

    return NextResponse.json(msg, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/overseer/history
 *
 * Clear chat history for a date.
 * Query params: date (YYYY-MM-DD), defaults to today
 */
export async function DELETE(request: NextRequest) {
  try {
    const date =
      request.nextUrl.searchParams.get("date") ||
      new Date().toISOString().split("T")[0];

    await prisma.chatMessage.deleteMany({
      where: { sessionDate: date },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
