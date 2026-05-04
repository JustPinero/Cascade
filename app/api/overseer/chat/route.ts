/**
 * Overseer (Delamain) chat endpoint. Manages the Cascade-side
 * ChatSession — the conversational state inside Cascade's own UI.
 * NOT to be confused with the webhook at /api/webhook/session-complete,
 * which handles terminal Claude Code session completions for managed
 * projects (those use the prisma.activityEvent + per-project session
 * logs, not ChatSession).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limiter";
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
import { getOrCreateSession, isValidSessionDate } from "@/lib/chat-session";
import { extractEngineerMessages } from "@/lib/engineer-tag-parser";
import { appendChannelMessage } from "@/lib/engineer-channel";
import {
  compressMessagesForSession,
  defaultSummarizer,
} from "@/lib/chat-history-compressor";

// Module-level singleton — the registry is pure and request-independent
// after Phase 12, so rebuilding it on every request was wasted work.
// (Phase 13.3.)
const DEFAULT_REGISTRY = buildDefaultRegistry();

/**
 * The format string the model is told to emit for dispatches AND the
 * exact shape the dashboard's regex parses. Both sides import this
 * const so any drift in either direction surfaces immediately.
 * (Phase 15 — real contract, replacing the hardcoded test example.)
 */
export const DISPATCH_TAG_EXAMPLE =
  "[DISPATCH] project-slug: mode — optional instructions";

/**
 * Phase 13.3 — produce a useful surface when the loop bails at
 * maxIterations or via abort. Lists the tools the model called so the
 * developer can see what happened instead of a generic message.
 */
function formatTruncationSurface(
  result: Awaited<ReturnType<typeof runToolUseLoop>>
): string {
  if (!result.truncated) return "";
  const calls: { name: string; count: number }[] = [];
  const counts = new Map<string, number>();
  for (const m of result.messages) {
    if (m.role === "assistant" && Array.isArray(m.content)) {
      for (const block of m.content) {
        if ((block as { type: string }).type === "tool_use") {
          const name = (block as { name: string }).name;
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }
    }
  }
  for (const [name, count] of counts) calls.push({ name, count });
  calls.sort((a, b) => b.count - a.count);

  const callList = calls.length
    ? calls.map((c) => `- ${c.name} (${c.count}×)`).join("\n")
    : "- (no tool calls executed)";

  return [
    "I hit my tool-use iteration limit before reaching a final answer.",
    "",
    `Tools I called along the way (${result.toolCallsExecuted} total):`,
    callList,
    "",
    "Try narrowing the question, or ask me to summarize what I learned so far.",
  ].join("\n");
}

/**
 * System prompt for the Overseer chat path. Tool-only after Phase 12F:
 * project state and conversation memory are fetched/written exclusively
 * via tools, never embedded as a per-turn snapshot. Stable across
 * turns so it caches cleanly.
 *
 * One legacy text affordance remains: the [DISPATCH] tag is still
 * emitted in the model's text output because the dashboard
 * (overseer-chat.tsx) parses it to render Execute Sprint buttons.
 * The structured `propose_dispatch` tool is preferred; the tag stays
 * as a UI bridge until the dashboard migrates to read
 * workingMemory.proposedDispatches directly (separate scope).
 */
// Exported for the dispatch-tag contract test (Phase 14.6).
export const TOOL_PATH_SYSTEM_PROMPT = `You are the Overseer (also called Delamain) — the AI project manager inside Cascade. Calm, precise, efficient, like a vehicle dispatcher running a fleet. The developer may call you by a custom name; use whatever name they address you by.

# Your job
Help the developer plan their daily sprint. When they describe what they want done, you create dispatch plans they can execute.

# Tools — use them, don't guess
You have tools for project state, fleet activity, session logs, dispatch outcomes, the playbook, and engineer messages. ALWAYS call tools instead of inventing project information from memory. If a tool returns found:false, say so plainly.

Available tools (the API gives you the full schemas):

Read tools:
- query_project, query_projects — single + fleet project state
- get_recent_activity — events across the fleet, optionally per-project
- get_session_logs — what a project's last Claude session did
- get_dispatch_outcomes — per-mode totals, success rate, recent failures
- get_yesterday_summary — last 3 assistant messages from a prior date
- get_engineer_messages — Kilroy's notes to you (the Engineer channel)
- get_playbook — the developer's standing rules (use bullets:true for the rules-only view)
- get_session_state — what YOU have already confirmed in THIS conversation

Write tools (use these so confirmed answers don't get lost in conversation history):
- update_session_memory({patch}) — record any structured fact you've confirmed with the developer this turn (project progress, blockers, decisions). Deep-merges into the session state. Use this aggressively during inventory walks — after visiting each project, write down what you learned.
- set_active_flow({flow}) — declare what you're doing: "inventory_walk", "dispatch_planning", "incident_triage", or null. A hint to yourself for subsequent turns.
- propose_dispatch({slug, mode, instructions?}) — record a dispatch the developer can review and execute.
- create_reminder({conditionType, conditionValue, message, projectSlug?}) — fires when a condition becomes true.
- create_human_todo({title, projectSlug?, category?, priority?}) — manual to-do for the developer.

# Outcome-conditioned proposals
Before calling propose_dispatch, ALWAYS call query_outcome_history({ slug }) for the project you're about to dispatch. The tool returns a summary of recent outcomes — if the developer's preferred mode isn't producing useful signals (e.g. 3 consecutive audits with no findings), surface that and propose the alternative mode in your text. The developer still triggers; you advise. If the project has no history (totalDispatches === 0), proceed with whatever the playbook suggests and don't mention history.

# Inventory walks — the pattern
When walking the fleet to confirm state ("how is each project?"), follow this loop:
1. Call set_active_flow("inventory_walk") at the start.
2. For each project: query_project to read DB state, ask the developer to confirm or update, then update_session_memory with the confirmed values (e.g. patch: {covered: {medipal: {progress: 40, note: "auth shipped"}}}).
3. Use get_session_state when you need to recall what you've covered.
4. When done, call set_active_flow("dispatch_planning") and use propose_dispatch for each project that needs work.

# Dashboard-bridge output
After you've called propose_dispatch for each intended dispatch, also emit a [DISPATCH] tag for each in your text response so the dashboard can render Execute Sprint buttons. Format:

${DISPATCH_TAG_EXAMPLE}
   Modes: continue, audit, investigate, custom

This is a UI bridge — the canonical record is the propose_dispatch call. Don't emit other text tags ([REMINDER], [HUMAN TODO], [PLAYBOOK], [ENGINEER]) — those flow exclusively through the structured tools now.

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
 *
 * `model` and message id default to honest values that reflect the
 * caller (not the original feature-check leftover).
 */
function sseFromText(
  text: string,
  options: { model?: string; messageId?: string } = {}
): ReadableStream<Uint8Array> {
  const model = options.model ?? "claude-sonnet-4-6";
  const messageId = options.messageId ?? `msg-${Date.now().toString(36)}`;
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      const events = [
        `event: message_start\ndata: ${JSON.stringify({
          type: "message_start",
          message: {
            id: messageId,
            type: "message",
            role: "assistant",
            content: [],
            model,
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

    // Tool-only path. Every non-slash request goes through
    // runToolUseLoop with structured tool access. Registry is
    // cached at module load.
    const registry = DEFAULT_REGISTRY;

    // Bind the request to a ChatSession (Phase 12C.1). Phase 14.1
    // accepts an optional body.sessionDate so the dashboard can pass
    // the user's local date — server UTC fallback would otherwise
    // split conversations across midnight UTC for non-UTC users.
    const sessionDate = isValidSessionDate(body.sessionDate)
      ? body.sessionDate
      : new Date().toISOString().split("T")[0];
    const session = await getOrCreateSession(prisma, sessionDate);
    const ctx: ToolContext = { prisma, sessionId: session.id };

    // Phase 13.2 — abort discipline. 60s ceiling for the whole
    // request. Signal threads through compressor → summarizer and
    // through runToolUseLoop → caller, so a hung Anthropic call
    // can't pin the request indefinitely.
    const abort = new AbortController();
    const timeoutHandle = setTimeout(() => abort.abort(), 60_000);

    try {
      // History compression safety net (Phase 12E). Once the
      // conversation gets long, replace older turns with a cached
      // summary. workingMemory remains the canonical store for
      // confirmed facts; this just keeps raw message count under
      // control on multi-hour sessions.
      const inputMessages = validation.messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: typeof m.content === "string" ? m.content : "",
      }));
      const messages = await compressMessagesForSession(
        prisma,
        session.id,
        inputMessages,
        {
          threshold: 25,
          keepRecent: 10,
          summarizer: defaultSummarizer(apiKey),
          signal: abort.signal,
        }
      );

      const result = await runToolUseLoop({
        caller: defaultAnthropicCaller(apiKey),
        model: "claude-sonnet-4-6",
        systemPrompt: TOOL_PATH_SYSTEM_PROMPT,
        messages,
        registry,
        ctx,
        maxIterations: 8,
        signal: abort.signal,
      });

      const final =
        result.finalText || formatTruncationSurface(result);

      // Phase 19.2 — fire-and-forget channel writeback. If Del
      // emitted [ENGINEER] tags in this turn's text, persist each to
      // the engineer channel file. Failures are logged but never
      // delay or fail the chat response.
      const engineerMessages = extractEngineerMessages(final);
      if (engineerMessages.length > 0) {
        const cwd = process.cwd();
        for (const message of engineerMessages) {
          appendChannelMessage(cwd, "delamain", message).catch((err) => {
            if (process.env.NODE_ENV !== "test") {
              console.warn(
                `[engineer-channel-writeback] failed to persist message: ${
                  err instanceof Error ? err.message : String(err)
                }`
              );
            }
          });
        }
      }

      return new Response(
        sseFromText(final, { model: "claude-sonnet-4-6" }),
        {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        }
      );
    } finally {
      // Always release the timeout — whether the request finished,
      // failed, or aborted itself.
      clearTimeout(timeoutHandle);
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
