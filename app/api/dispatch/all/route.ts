import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { dispatchAll, type DispatchMode } from "@/lib/claude-dispatcher";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limiter";

export async function POST(request: NextRequest) {
  const limited = checkRateLimit(getRateLimitKey(request, "dispatch-all"), 3, 60_000);
  if (limited) return limited;

  try {
    const { mode = "continue" } = await request.json();

    if (mode !== "continue" && mode !== "audit") {
      return NextResponse.json(
        { error: "Dispatch all only supports: continue, audit" },
        { status: 400 }
      );
    }

    const result = await dispatchAll(prisma, mode as DispatchMode);

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
