import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionLogs } from "@/lib/session-reader";

/**
 * POST /api/briefing
 *
 * Generates a morning briefing by collecting project states,
 * recent activity, and session summaries, then calling Claude
 * to produce a concise summary.
 */
export async function POST() {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || !apiKey.startsWith("sk-")) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not configured" },
        { status: 500 }
      );
    }

    // Gather project states
    const projects = await prisma.project.findMany({
      orderBy: { lastActivityAt: "desc" },
    });

    // Gather recent activity (last 24h)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentEvents = await prisma.activityEvent.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { project: { select: { name: true, slug: true } } },
    });

    // Gather latest session summaries
    const sessionSummaries: string[] = [];
    for (const p of projects) {
      try {
        const logs = await getSessionLogs(p.path, 1);
        if (logs.length > 0 && logs[0].timestamp > since.toISOString()) {
          const summary = logs[0].summary
            .replace(/^#.*\n/gm, "")
            .trim()
            .slice(0, 200);
          if (summary) {
            sessionSummaries.push(`${p.name}: "${summary}"`);
          }
        }
      } catch {
        // Skip
      }
    }

    // Build the briefing prompt
    const projectList = projects
      .map(
        (p) =>
          `- ${p.name}: status=${p.status}, health=${p.health}, phase=${p.currentPhase}, progress=${p.progressScore}%`
      )
      .join("\n");

    const eventList = recentEvents
      .slice(0, 15)
      .map(
        (e) =>
          `- [${e.eventType}] ${e.project?.name || "System"}: ${e.summary}`
      )
      .join("\n");

    const sessionList =
      sessionSummaries.length > 0
        ? sessionSummaries.join("\n")
        : "No recent sessions.";

    // Gather pending human tasks
    const pendingTasks = await prisma.humanTask.findMany({
      where: { status: "pending" },
      include: { project: { select: { name: true } } },
    });
    const taskList =
      pendingTasks.length > 0
        ? pendingTasks
            .map(
              (t) =>
                `- ${t.title}${t.project ? ` (${t.project.name})` : ""}${t.priority === "high" ? " [HIGH]" : ""}`
            )
            .join("\n")
        : "No pending tasks.";

    const systemPrompt = `You are Delamain generating a morning briefing for the developer. Be concise, direct, and actionable. Use this format:

## Good morning

**Quick stats:** X projects active, Y blocked, Z sessions in last 24h.

**Needs your attention:**
- [List any blocked projects, [NEEDS ATTENTION] flags, or high-priority human tasks]

**Completed since last briefing:**
- [List completed work from session summaries and activity events]

**Recommended priorities:**
1. [Most important thing to do first and why]
2. [Second priority]
3. [Third priority]

Keep it under 200 words. Be matter-of-fact like a vehicle dispatcher. If nothing is blocked, say so — don't invent problems.`;

    const userMessage = `Generate today's morning briefing.

## Current Projects
${projectList}

## Activity (Last 24h)
${eventList || "No activity in the last 24 hours."}

## Recent Session Summaries
${sessionList}

## Pending Human Tasks
${taskList}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return NextResponse.json(
        { error: `API error: ${response.status} ${err}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const briefing =
      data.content?.[0]?.text || "Unable to generate briefing.";

    return NextResponse.json({
      briefing,
      generatedAt: new Date().toISOString(),
      projectCount: projects.length,
      blockedCount: projects.filter((p) => p.health === "blocked").length,
      recentEventCount: recentEvents.length,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
