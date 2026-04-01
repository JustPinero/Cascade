import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { harvestKnowledge } from "@/lib/knowledge-harvester";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limiter";

export async function POST(request: NextRequest) {
  const limited = checkRateLimit(getRateLimitKey(request, "harvest"), 5, 60_000);
  if (limited) return limited;

  try {
    const result = await harvestKnowledge(prisma);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error during harvest";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
