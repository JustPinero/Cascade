import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkReminders } from "@/lib/reminders";

export async function GET() {
  try {
    // Check conditions and trigger any that are met
    await checkReminders(prisma);

    // Return all non-dismissed reminders
    const reminders = await prisma.reminder.findMany({
      where: { status: { not: "dismissed" } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });

    return NextResponse.json(reminders);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { message, conditionType, conditionValue, projectSlug, createdBy } =
      await request.json();

    if (!message || !conditionType || !conditionValue) {
      return NextResponse.json(
        { error: "message, conditionType, and conditionValue are required" },
        { status: 400 }
      );
    }

    const reminder = await prisma.reminder.create({
      data: {
        message,
        conditionType,
        conditionValue,
        projectSlug: projectSlug || null,
        createdBy: createdBy || "user",
      },
    });

    return NextResponse.json(reminder, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { id, status } = await request.json();

    if (!id || !status) {
      return NextResponse.json(
        { error: "id and status are required" },
        { status: 400 }
      );
    }

    const reminder = await prisma.reminder.update({
      where: { id },
      data: {
        status,
        triggeredAt: status === "triggered" ? new Date() : undefined,
      },
    });

    return NextResponse.json(reminder);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
