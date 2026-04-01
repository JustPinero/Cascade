import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  generatePrompt,
  dispatchClaude,
  type DispatchMode,
} from "@/lib/claude-dispatcher";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limiter";

const VALID_MODES = new Set(["continue", "audit", "investigate", "custom"]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const limited = checkRateLimit(getRateLimitKey(request, "dispatch"), 10, 60_000);
  if (limited) return limited;

  try {
    const { slug } = await params;
    const { mode, prompt: customPrompt } = await request.json();

    if (!mode || !VALID_MODES.has(mode)) {
      return NextResponse.json(
        { error: "Invalid mode. Use: continue, audit, investigate, custom" },
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

    const generatedPrompt = await generatePrompt(
      project.path,
      mode as DispatchMode,
      customPrompt
    );

    const result = dispatchClaude(project.path, generatedPrompt);

    if (result.success) {
      await prisma.activityEvent.create({
        data: {
          projectId: project.id,
          eventType: "session-launched",
          summary: `Dispatched: ${mode} mode`,
          details: JSON.stringify({ mode }),
        },
      });

      await prisma.project.update({
        where: { slug },
        data: { currentRequest: `${mode} — dispatched` },
      });
    }

    return NextResponse.json({
      success: result.success,
      mode,
      error: result.error,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
