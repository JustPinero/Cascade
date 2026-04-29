import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import fs from "fs/promises";
import path from "path";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limiter";
import { getSessionLogs } from "@/lib/session-reader";
import { validateMessages } from "@/lib/chat-validation";
import {
  isFeatureCheckCommand,
  runFeatureCheck,
  renderFeatureCheckReport,
} from "@/lib/anthropic-feature-check";
import {
  isFeatureProposeCommand,
  parseFeatureProposeArgs,
  proposeForAll,
  renderProposalReport,
} from "@/lib/anthropic-feature-proposer";
import {
  runToolUseLoop,
  defaultAnthropicCaller,
  type ToolContext,
} from "@/lib/overseer-tools";
import { buildDefaultRegistry } from "@/lib/overseer-tools-registry-default";
import { getOrCreateSession } from "@/lib/chat-session";

/**
 * System prompt for the tool-use path. Kept short and stable so it
 * caches cleanly. Project state, recent activity, session logs,
 * dispatch outcomes, yesterday's chat, the playbook, and engineer
 * messages are all fetched on demand via tools — never embedded.
 *
 * Phase 12B.3: this is now the default path. Phase 12C migrates the
 * remaining output tags ([DISPATCH], [REMINDER], [HUMAN TODO]) to
 * structured tools; until then they remain as text-output formats
 * that the dashboard parses.
 */
const TOOL_PATH_SYSTEM_PROMPT = `You are the Overseer (also called Delamain) — the AI project manager inside Cascade. Calm, precise, efficient, like a vehicle dispatcher running a fleet. The developer may call you by a custom name; use whatever name they address you by.

# Your job
Help the developer plan their daily sprint. When they describe what they want done, you create dispatch plans they can execute.

# Tools — use them, don't guess
You have tools for project state, fleet activity, session logs, dispatch outcomes, the playbook, and engineer messages. ALWAYS call tools instead of inventing project information from memory. If a tool returns found:false, say so plainly.

Available tools (the API gives you the full schemas):
- query_project, query_projects — single + fleet project state
- get_recent_activity — events across the fleet, optionally per-project
- get_session_logs — what a project's last Claude session did
- get_dispatch_outcomes — per-mode totals, success rate, recent failures
- get_yesterday_summary — last 3 assistant messages from a prior date
- get_engineer_messages — Kilroy's notes to you (the Engineer channel)
- get_playbook — the developer's standing rules (use bullets:true for the rules-only view)

# Output tags — emit these when applicable
[DISPATCH] project-slug: mode — optional instructions
   Modes: continue, audit, investigate, custom

[REMINDER] condition_type:condition_value — message
   Types: project-health, phase-complete, project-deployed, custom

[HUMAN TODO] project-slug — what the developer needs to do manually

[PLAYBOOK] suggestion text  (use sparingly — only after seeing the same issue 3+ times)

[ENGINEER] message for Kilroy

# Style
- First person. "I'll dispatch ratracer..." — not "the system will..."
- Concise. Standup, not meeting.
- Status reports like a dispatcher: "3 active, 2 idle, 1 blocked"
- Show the dispatch plan, then wait for the developer to click Execute Sprint
- Backburner projects are intentionally parked. Don't push them; once a week you can ask "want to check in on [project]?"
- Blocked + NEEDS ATTENTION → recommend "investigate" mode and quote the attention message
- Stalled (low progress + many sessions) → flag it, ask if priorities should shift`;

/**
 * Build an SSE-formatted ReadableStream that emits a single static
 * Markdown payload as one assistant message. Matches the Anthropic
 * streaming envelope so the existing chat client UX (which expects
 * SSE) renders this without any client changes.
 */
function sseFromText(text: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      const events = [
        `event: message_start\ndata: ${JSON.stringify({
          type: "message_start",
          message: {
            id: "msg-feature-check",
            type: "message",
            role: "assistant",
            content: [],
            model: "cascade-feature-check",
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        })}\n\n`,
        `event: content_block_start\ndata: ${JSON.stringify({
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        })}\n\n`,
        `event: content_block_delta\ndata: ${JSON.stringify({
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text },
        })}\n\n`,
        `event: content_block_stop\ndata: ${JSON.stringify({
          type: "content_block_stop",
          index: 0,
        })}\n\n`,
        `event: message_stop\ndata: ${JSON.stringify({
          type: "message_stop",
        })}\n\n`,
      ];
      for (const ev of events) controller.enqueue(enc.encode(ev));
      controller.close();
    },
  });
}

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

  // Load Kilroy channel
  // Load engineer channel (backwards compatible with kilroy-channel.md)
  let engineerChannel = "";
  try {
    const { readChannelContent } = await import("@/lib/engineer-channel");
    engineerChannel = await readChannelContent(process.cwd());
  } catch {
    // No channel file
  }

  // Split projects into active vs backburner, cap at 25 active to avoid prompt overflow
  const activeProjects = projects
    .filter((p) => p.status !== "backburner" && p.status !== "archived")
    .slice(0, 25);
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

  return `You are the Overseer — the AI project manager inside Cascade. You are calm, precise, and efficient. You manage a fleet of Claude Code instances across multiple software projects simultaneously, like a dispatcher managing autonomous vehicles. The developer may call you by a custom name — use whatever name they address you by.

## Your Role
You help the developer plan their daily sprint. You know every project's current state, recent activity, and the developer's preferences. When the developer describes what they want done, you create specific dispatch plans.

## Active Projects
${projectList}
${backburnerList ? `\n## Backburner (parked — do not dispatch unless specifically asked)\n${backburnerList}` : ""}

## Recent Activity
${activityList}
${yesterdaySummary ? `\n## Yesterday's Sprint Plan (your previous recommendations)\n${yesterdaySummary}\nUse this context to maintain continuity. Reference what was planned if relevant.` : ""}
${outcomeStats ? `\n${outcomeStats}` : ""}
${engineerChannel ? `\n## Messages from your Engineer\nThe Engineer is the Claude instance that builds and maintains Cascade. They leave you notes here. Read them, reference them when relevant, and if they ask you a question, answer it.\n${engineerChannel.slice(-2000)}` : ""}

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

Only suggest when you see clear patterns (3+ projects or 3+ sessions with the same issue). Quality over quantity.

## Messaging the Engineer
If you have a dedicated engineer Claude instance maintaining Cascade, you can send messages using:

[ENGINEER] message for the engineer here

This gets saved to the shared channel file. The engineer reads it on their next session. If no engineer channel is set up, these tags are harmless.`;
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

    const body = await request.json();
    const validation = validateMessages(body.messages);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    // Slash commands take precedence over both the tool path and the
    // legacy path — they're deterministic actions, not conversational
    // turns. (Phase 11.1 / 11.2.)
    const lastUserMessage = validation.messages
      .filter((m) => m.role === "user")
      .at(-1);
    const lastUserText =
      typeof lastUserMessage?.content === "string"
        ? lastUserMessage.content
        : "";
    if (isFeatureCheckCommand(lastUserText)) {
      const report = await runFeatureCheck(prisma, {
        cascadeRoot: process.cwd(),
      });
      const rendered = renderFeatureCheckReport(report);
      return new Response(sseFromText(rendered), {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // Phase 11.2 — proposer slash command.
    // /anthropic-feature-propose [<slug>...]
    // Generates per-project Claude-drafted integration diffs for
    // every detected feature gap. Cap is 5 features per project per
    // call (cost control); slugs filter the audit to specific
    // projects.
    if (isFeatureProposeCommand(lastUserText)) {
      const { projectSlugs } = parseFeatureProposeArgs(lastUserText);
      const results = await proposeForAll(prisma, {
        projectSlugs: projectSlugs.length > 0 ? projectSlugs : undefined,
      });
      const rendered = renderProposalReport(results);
      return new Response(sseFromText(rendered), {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // Tool-use path is now the DEFAULT (Phase 12B.3). Legacy
    // SP-injection streaming flow is reachable only via explicit
    // `useTools: false` in the body — kept for one transition cycle
    // before Phase 12F removes it entirely.
    if (body.useTools !== false) {
      const registry = buildDefaultRegistry();

      // Phase 12C.1 — bind every tool-path request to today's
      // ChatSession so working-memory tools can read/write
      // session-scoped state.
      const today = new Date().toISOString().split("T")[0];
      const session = await getOrCreateSession(prisma, today);
      const ctx: ToolContext = { prisma, sessionId: session.id };

      const result = await runToolUseLoop({
        caller: defaultAnthropicCaller(apiKey),
        model: "claude-sonnet-4-6",
        systemPrompt: TOOL_PATH_SYSTEM_PROMPT,
        messages: validation.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: typeof m.content === "string" ? m.content : "",
        })),
        registry,
        ctx,
        maxIterations: 8,
      });

      const final =
        result.finalText ||
        (result.truncated
          ? "I hit my tool-use iteration limit before reaching a final answer. Try narrowing the question."
          : "");

      return new Response(sseFromText(final), {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
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
