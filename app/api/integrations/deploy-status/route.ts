import { NextRequest, NextResponse } from "next/server";
import { getDeploymentStatus } from "@/lib/deploy-monitor";

export async function GET(request: NextRequest) {
  try {
    const platform = request.nextUrl.searchParams.get("platform") as
      | "vercel"
      | "railway"
      | null;
    const projectId = request.nextUrl.searchParams.get("projectId");

    if (!platform || !projectId) {
      return NextResponse.json(
        { error: "platform and projectId params required" },
        { status: 400 }
      );
    }

    if (platform !== "vercel" && platform !== "railway") {
      return NextResponse.json(
        { error: "platform must be 'vercel' or 'railway'" },
        { status: 400 }
      );
    }

    const status = await getDeploymentStatus(platform, projectId);
    return NextResponse.json(status);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
