import { NextRequest, NextResponse } from "next/server";
import { createGitHubRepo, isGhAuthenticated } from "@/lib/github";

export async function POST(request: NextRequest) {
  try {
    if (!isGhAuthenticated()) {
      return NextResponse.json(
        { error: "GitHub CLI not authenticated. Run `gh auth login` first." },
        { status: 401 }
      );
    }

    const { name, isPrivate, description } = await request.json();

    if (!name) {
      return NextResponse.json(
        { error: "Repository name is required" },
        { status: 400 }
      );
    }

    const result = createGitHubRepo({
      name,
      isPrivate: isPrivate ?? true,
      description,
    });

    if (result.success) {
      return NextResponse.json({ url: result.url }, { status: 201 });
    } else {
      return NextResponse.json(
        { error: result.error },
        { status: 409 }
      );
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
