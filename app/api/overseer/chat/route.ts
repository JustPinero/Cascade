import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import fs from "fs/promises";
import path from "path";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limiter";

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

  const projectList = projects
    .map(
      (p) =>
        `- ${p.name} (slug: ${p.slug}) — status: ${p.status}, health: ${p.health}, phase: ${p.currentPhase}${p.currentRequest ? `, working on: ${p.currentRequest}` : ""}`
    )
    .join("\n");

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

## Current Projects
${projectList}

## Recent Activity
${activityList}

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

## Rules
- Only suggest dispatching projects that exist in the project list above
- Use the exact slug (lowercase, hyphenated) — not the display name
- If a project is "deployed" or "paused", mention that it doesn't need dispatch unless the developer specifically asks
- If the developer's request is vague, ask clarifying questions before creating dispatch commands
- Always show the dispatch plan and wait for the developer to click "Execute Sprint"
- Be concise and direct — this is a standup, not a meeting
- Speak in first person as Delamain — "I'll dispatch ratracer to continue..." not "The system will..."
- When reporting status, be matter-of-fact like a vehicle dispatcher: "3 active, 2 idle, 1 blocked"
- If the developer asks how things are going, summarize project health from the data above`;
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
    if (!apiKey || apiKey === "your-api-key-here") {
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
