import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateAdvisories } from "@/lib/advisory-engine";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limiter";

export async function POST(request: NextRequest) {
  const limited = checkRateLimit(getRateLimitKey(request, "advisory"), 5, 60_000);
  if (limited) return limited;

  try {
    const result = await generateAdvisories(prisma);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
