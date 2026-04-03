import { NextRequest, NextResponse } from "next/server";
import {
  checkAllAuthStatuses,
  launchLogin,
  type CLIService,
} from "@/lib/cli-auth";

const VALID_SERVICES = new Set(["vercel", "github", "railway", "1password"]);

/**
 * GET /api/integrations/auth
 *
 * Returns auth status for all CLI services.
 */
export async function GET() {
  try {
    const statuses = checkAllAuthStatuses();
    return NextResponse.json(statuses);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/integrations/auth
 *
 * Launches a Terminal window with the login command for a service.
 * Body: { service: "vercel" | "github" | "railway" | "1password" }
 */
export async function POST(request: NextRequest) {
  try {
    const { service } = await request.json();

    if (!service || !VALID_SERVICES.has(service)) {
      return NextResponse.json(
        { error: "Invalid service. Must be: vercel, github, railway, 1password" },
        { status: 400 }
      );
    }

    const result = launchLogin(service as CLIService);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, service });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
