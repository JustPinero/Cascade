import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildWizardSystemPrompt } from "@/lib/wizard-prompt";

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey === "your-api-key-here") {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not configured" },
        { status: 500 }
      );
    }

    const { messages, templateContent } = await request.json();

    if (!messages || !templateContent) {
      return NextResponse.json(
        { error: "messages and templateContent are required" },
        { status: 400 }
      );
    }

    const systemPrompt = await buildWizardSystemPrompt(
      prisma,
      templateContent
    );

    // Stream from Anthropic API
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

    // Forward the stream
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
