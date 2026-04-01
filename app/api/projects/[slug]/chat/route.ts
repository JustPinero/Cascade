import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildProjectSystemPrompt } from "@/lib/project-chat";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limiter";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const limited = checkRateLimit(
    getRateLimitKey(request, "project-chat"),
    20,
    60_000
  );
  if (limited) return limited;

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey === "your-api-key-here") {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not configured" },
        { status: 500 }
      );
    }

    const { slug } = await params;
    const { messages } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "messages array is required" },
        { status: 400 }
      );
    }

    const project = await prisma.project.findUnique({ where: { slug } });
    if (!project) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    const systemPrompt = await buildProjectSystemPrompt(
      prisma,
      project.path,
      project.name
    );

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return NextResponse.json(
        { error: `Anthropic API error: ${response.status} ${err}` },
        { status: response.status }
      );
    }

    return new Response(response.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
