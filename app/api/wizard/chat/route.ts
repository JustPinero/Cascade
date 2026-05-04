import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildWizardSystemPrompt } from "@/lib/wizard-prompt";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limiter";
import { validateMessages } from "@/lib/chat-validation";

export async function POST(request: NextRequest) {
  const limited = checkRateLimit(
    getRateLimitKey(request, "wizard"),
    20,
    60_000
  );
  if (limited) return limited;

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || !apiKey.startsWith("sk-")) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not configured" },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { templateContent } = body;
    const validation = validateMessages(body.messages);

    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    if (!templateContent) {
      return NextResponse.json(
        { error: "templateContent is required" },
        { status: 400 }
      );
    }

    const systemPrompt = await buildWizardSystemPrompt(
      prisma,
      templateContent
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);

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
        messages: validation.messages,
        stream: true,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.text();
      return NextResponse.json(
        { error: `Anthropic API error: ${response.status} ${err}` },
        { status: response.status }
      );
    }

    if (!response.body) {
      return NextResponse.json(
        { error: "Anthropic streaming response had no body" },
        { status: 500 }
      );
    }

    // Phase 25.2 — split the stream for usage telemetry. Closes
    // audits/debt.md 23.D3 for this route.
    const tapStart = performance.now();
    const [forClient, forTap] = response.body.tee();
    const { pipeSseEvents } = await import("@/lib/overseer-tools-streaming");
    const { logUsage } = await import("@/lib/anthropic-usage-log");
    void pipeSseEvents(forTap, (event) => {
      if (event.type === "message_delta" && event.usage) {
        logUsage(prisma, {
          callSite: "wizard",
          model: "claude-sonnet-4-6",
          usage: event.usage as Parameters<typeof logUsage>[1]["usage"],
          durationMs: Math.round(performance.now() - tapStart),
        });
      }
    }).catch(() => {
      // tap failures must not break the client stream
    });

    return new Response(forClient, {
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
