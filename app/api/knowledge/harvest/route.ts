import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { harvestKnowledge } from "@/lib/knowledge-harvester";

export async function POST() {
  try {
    const result = await harvestKnowledge(prisma);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error during harvest";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
