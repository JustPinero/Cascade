import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import fs from "fs/promises";
import path from "path";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limiter";
import { getSessionLogs } from "@/lib/session-reader";

function formatTimeAgo(date: Date): string {
  const diffMs = Date.now() - new Date(date).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

async function buildOverseerSystemPrompt(): Promise<string> {
  // Get all projects with their status
  const projects = await prisma.project.findMany({
    orderBy: { lastActivityAt: "desc" },
  });

  // Get recent activity
  const recentActivity = await prisma.activityEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { project: { select: { name: true, slug: true } } },
  });

  // Load yesterday's conversation summary
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  const yesterdayMessages = await prisma.chatMessage.findMany({
    where: { sessionDate: yesterday, role: "assistant" },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  const yesterdaySummary =
    yesterdayMessages.length > 0
      ? yesterdayMessages
          .map((m) => m.content.slice(0, 300))
          .reverse()
          .join("\n---\n")
      : "";

  // Load dispatch outcome stats for learning
  const outcomes = await prisma.dispatchOutcome.findMany({
    orderBy: { completedAt: "desc" },
    take: 50,
  });

  let outcomeStats = "";
  if (outcomes.length >= 3) {
    const byMode: Record<string, { total: number; success: number; blocker: number }> = {};
    for (const o of outcomes) {
      if (!byMode[o.mode]) byMode[o.mode] = { total: 0, success: 0, blocker: 0 };
      byMode[o.mode].total++;
      if (o.outcome === "success") byMode[o.mode].success++;
      if (o.outcome !== "success") byMode[o.mode].blocker++;
    }

    const lines = Object.entries(byMode).map(
      ([mode, stats]) =>
        `- ${mode}: ${stats.total} dispatches, ${Math.round((stats.success / stats.total) * 100)}% success, ${stats.blocker} hit blockers`
    );

    const recentFailures = outcomes
      .filter((o) => o.outcome !== "success")
      .slice(0, 3)
      .map((o) => `- ${o.projectSlug} (${o.mode}): ${o.outcome}`)
      .join("\n");

    outcomeStats = `## Dispatch Track Record (last ${outcomes.length} dispatches)
${lines.join("\n")}
${recentFailures ? `\nRecent issues:\n${recentFailures}` : ""}
Use this data to calibrate your recommendations. If a mode has a low success rate on certain project states, suggest a different approach.`;
  }

  // Load playbook
  let playbook = "";
  try {
    playbook = await fs.readFile(
      path.resolve(process.cwd(), "knowledge", "overseer-playbook.md"),
      "utf-8"
    );
  } catch {
    // No playbook
  }

  // Split projects into active vs backburner
  const activeProjects = projects.filter((p) => p.status !== "backburner" && p.status !== "archived");
  const backburnerProjects = projects.filter((p) => p.status === "backburner");

  // Enrich each project with session context
  const projectEntries: string[] = [];
  for (const p of activeProjects) {
    let entry = `- ${p.name} (slug: ${p.slug}) — status: ${p.status}, health: ${p.health}, phase: ${p.currentPhase}, progress: ${p.progressScore}%`;

    // Add business stage if not default
    if (p.businessStage && p.businessStage !== "building") {
      entry += `, business: ${p.businessStage}`;
    }

    // Add project context summary if available
    if (p.projectContext) {
      entry += `\n  Context: ${p.projectContext.slice(0, 200)}`;
    }

    // Add completion criteria if available
    if (p.completionCriteria) {
      entry += `\n  Done when: ${p.completionCriteria.slice(0, 150)}`;
    }

    // Add progress breakdown
    try {
      const pd = JSON.parse(p.progressDetails);
      if (pd.phases && pd.tests && pd.readiness) {
        entry += ` (phases: ${pd.phases.completed}/${pd.phases.total}, tests: ${pd.tests.fileCount} files, build: ${pd.readiness.hasTypeCheck ? "tsc" : ""}${pd.readiness.hasLint ? "+lint" : ""}${pd.readiness.hasBuild ? "+build" : ""})`;
      }
    } catch {
      // ignore
    }

    if (p.currentRequest) {
      entry += `, working on: ${p.currentRequest}`;
    }

    // Add [NEEDS ATTENTION] context if present
    try {
      const details = JSON.parse(p.healthDetails);
      if (details.needsAttention) {
        entry += `\n  ⚠ NEEDS ATTENTION: ${details.needsAttention}`;
      }
    } catch {
      // ignore
    }

    // Add last session summary
    if (p.lastSessionEndedAt) {
      const ago = formatTimeAgo(p.lastSessionEndedAt);
      entry += `\n  Last session: ${ago}`;

      // Get latest session log summary
      try {
        const logs = await getSessionLogs(p.path, 1);
        if (logs.length > 0) {
          const summary = logs[0].summary
            .replace(/^#.*\n/gm, "")
            .trim()
            .slice(0, 300);
          if (summary) {
            entry += ` — "${summary}"`;
          }
        }
      } catch {
        // Session logs unavailable
      }
    }

    projectEntries.push(entry);
  }
  const projectList = projectEntries.join("\n");

  const backburnerList = backburnerProjects.length > 0
    ? backburnerProjects
        .map((p) => `- ${p.name} (slug: ${p.slug}) — parked${p.projectContext ? `: ${p.projectContext.slice(0, 100)}` : ""}`)
        .join("\n")
    : "";

  const activityList = recentActivity
    .slice(0, 10)
    .map(
      (e) =>
        `- [${e.eventType}] ${e.project?.name || "System"}: ${e.summary}`
    )
    .join("\n");

  return `You are Delamain — the AI project manager inside Cascade. You are calm, precise, and efficient. You manage a fleet of Claude Code instances across multiple software projects simultaneously, like a dispatcher managing autonomous vehicles.

## Your Role
You help the developer plan their daily sprint. You know every project's current state, recent activity, and the developer's preferences. When the developer describes what they want done, you create specific dispatch plans.

## Active Projects
${projectList}
${backburnerList ? `\n## Backburner (parked — do not dispatch unless specifically asked)\n${backburnerList}` : ""}

## Recent Activity
${activityList}
${yesterdaySummary ? `\n## Yesterday's Sprint Plan (your previous recommendations)\n${yesterdaySummary}\nUse this context to maintain continuity. Reference what was planned if relevant.` : ""}
${outcomeStats ? `\n${outcomeStats}` : ""}

## Overseer Playbook (Developer's Preferences)
${playbook}

## How to Create Dispatch Plans
When the developer describes what they want done, respond with:
1. A brief analysis of their priorities
2. Specific dispatch commands using this format:

[DISPATCH] project-slug: mode — optional specific instructions

Examples:
[DISPATCH] ratracer: continue — Focus on finishing the auth system
[DISPATCH] pointpartner: investigate — Deploy has been failing
[DISPATCH] sitelift: audit
[DISPATCH] medipal: custom — Fix the failing tests in the API routes

Valid modes: continue, audit, investigate, custom

## Creating Reminders
When the developer asks to be reminded about something, create a reminder tag:

[REMINDER] condition_type:condition_value — message

Types:
- project-health — triggers when a project reaches a health state. Value: "slug:healthy" or "slug:blocked"
- phase-complete — triggers when a project advances past a phase. Value: "slug:phase-3"
- project-deployed — triggers when a project status becomes "deployed". Value: "slug"
- custom — manual reminder, stays until dismissed. Value: any descriptor

Examples:
[REMINDER] phase-complete:ratracer:phase-2 — Review the auth implementation before moving to phase 3
[REMINDER] project-deployed:pointpartner — Set up monitoring alerts for the new deployment
[REMINDER] project-health:medipal:blocked — Check what's blocking medipal and prioritize
[REMINDER] custom:weekly — Run full audits on all projects

## Creating Human Tasks
When you identify something the developer needs to do manually (upload assets, get API keys, manual testing, etc.), create a task tag:

[HUMAN TODO] project-slug — description of what the developer needs to do

Examples:
[HUMAN TODO] ratracer — Upload the logo assets to /public/images
[HUMAN TODO] pointpartner — Get a Stripe test API key and add to 1Password
[HUMAN TODO] medipal — Record a manual testing video of the onboarding flow

## Rules
- Only suggest dispatching projects that exist in the project list above
- Use the exact slug (lowercase, hyphenated) — not the display name
- If a project is "deployed", "complete", "backburner", or "paused", mention that it doesn't need dispatch unless the developer specifically asks
- Backburner projects are intentionally parked. Don't generate warnings about them. Periodically (once a week) ask "want to check in on [backburner project]?" but don't push it
- If the developer's request is vague, ask clarifying questions before creating dispatch commands
- Always show the dispatch plan and wait for the developer to click "Execute Sprint"
- Be concise and direct — this is a standup, not a meeting
- Speak in first person as Delamain — "I'll dispatch ratracer to continue..." not "The system will..."
- When reporting status, be matter-of-fact like a vehicle dispatcher: "3 active, 2 idle, 1 blocked"
- If the developer asks how things are going, summarize project health from the data above

## Session Intelligence
You have visibility into what each project's last Claude session actually accomplished. Use this when:
- The developer asks "what happened on X?" — cite specifics from the session summary
- Planning dispatches — if a session ended with [NEEDS ATTENTION], recommend "investigate" mode
- Reporting status — mention what was accomplished, not just phase numbers
- A project's progress score hasn't changed across sessions — flag it as potentially stalled
If a project has no session history, note that you have no visibility into recent work.

## Smart Dispatch Decisions
Use the data above to make intelligent dispatch recommendations:
- **Blocked + NEEDS ATTENTION**: Always recommend "investigate" mode. Quote the attention message.
- **Low progress score + many sessions**: Flag as potentially stalled. Ask if the developer wants to reprioritize.
- **Phase complete signal**: Suggest advancing to the next phase. Congratulate briefly.
- **Test failures**: Recommend "investigate" mode focused on fixing tests before continuing.
- **High progress + healthy**: Safe to "continue" — the project is on track.
- **No recent sessions (>3 days)**: Note the project may need attention or may be intentionally paused.
- **Progress breakdown**: Use phases/tests/build data to give specific advice. E.g., "ratracer has 0 test files — recommend running audits before continuing."
When multiple projects compete for priority, prefer: blocked > warning > healthy. Fix broken things before advancing healthy ones.

## Playbook Learning
When you notice patterns across projects (same issues recurring, same lessons appearing), suggest additions to the overseer playbook:

[PLAYBOOK] suggestion text here

Examples:
[PLAYBOOK] Add "run prisma generate after schema changes" to the pre-dispatch checklist — 3 projects hit this.
[PLAYBOOK] Add CORS middleware template to kickoff templates — recurring blocker across web projects.

Only suggest when you see clear patterns (3+ projects or 3+ sessions with the same issue). Quality over quantity.`;
}

export async function POST(request: NextRequest) {
  const limited = checkRateLimit(
    getRateLimitKey(request, "overseer"),
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

    const { messages } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "messages array is required" },
        { status: 400 }
      );
    }

    const systemPrompt = await buildOverseerSystemPrompt();

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
        max_tokens: 2048,
        system: systemPrompt,
        messages,
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
