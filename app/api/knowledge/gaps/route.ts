import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { detectKnowledgeGaps } from "@/lib/knowledge-gaps";

export async function GET() {
  try {
    const gaps = await detectKnowledgeGaps(prisma);
    return NextResponse.json(gaps);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
