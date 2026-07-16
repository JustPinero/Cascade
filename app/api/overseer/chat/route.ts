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
  type ToolContext,
} from "@/lib/overseer-tools";
import { defaultStreamingAnthropicCaller } from "@/lib/overseer-tools-streaming";
import type { StreamEvent } from "@/lib/streaming-accumulator";
import { buildDefaultRegistry } from "@/lib/overseer-tools-registry-default";
import { getOrCreateSession, isValidSessionDate } from "@/lib/chat-session";
import { linkAbort } from "@/lib/request-abort";
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

# Knowledge with citations
When the developer asks a how-to / what-to-do question that the knowledge base might cover, call query_knowledge_with_citations({ query }). The tool returns top-N lessons each prefixed with [L-<id>]. When you fold a lesson's content into your answer, include the EXACT marker text (e.g. [L-42]) in your response — the chat UI renders those markers as clickable links. Don't paraphrase the marker. Don't invent IDs. If no lessons match, just answer from your own knowledge without citations.

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
    // Phase 42 (P0.4) — the client's own disconnect also aborts: a
    // closed tab must not keep burning tool-loop iterations against
    // the wall timer with the output discarded.
    const abort = new AbortController();
    const timeoutHandle = setTimeout(() => abort.abort(), 60_000);
    linkAbort(request.signal, abort);

    // Phase 25.D1 — streaming migration.
    //
    // The buffered path used to call the Anthropic API to completion,
    // assemble the final text, then replay it as fake SSE. The new
    // path streams text deltas to the client as they arrive from the
    // model, while the tool-use loop runs across iterations.
    //
    // Strategy: synthesize ONE coherent SSE envelope to the client —
    // one message_start, one text content block, one message_stop —
    // even though the underlying loop may run multiple Anthropic
    // calls. Per-call message_start/stop boundaries are filtered out
    // so the client sees a single contiguous response. tool_use
    // events are hidden but a synthetic `tool_call_start` event is
    // emitted for any UI progress indicator.
    const inputMessages = validation.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: typeof m.content === "string" ? m.content : "",
    }));

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    const aggregateModel = "claude-sonnet-4-6";

    function writeFrame(name: string, data: unknown): void {
      writer
        .write(enc.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`))
        .catch(() => {
          // Client disconnected mid-stream; loop will continue and
          // flush quietly. Aborts are handled separately by the
          // 60s timeout signal.
        });
    }

    let textBlockOpen = false;
    let aggregatedText = "";

    function ensureTextBlockOpen(): void {
      if (!textBlockOpen) {
        writeFrame("content_block_start", {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        });
        textBlockOpen = true;
      }
    }

    function closeTextBlock(): void {
      if (textBlockOpen) {
        writeFrame("content_block_stop", {
          type: "content_block_stop",
          index: 0,
        });
        textBlockOpen = false;
      }
    }

    function appendSyntheticText(text: string): void {
      if (!text) return;
      ensureTextBlockOpen();
      writeFrame("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      });
      aggregatedText += text;
    }

    // Open the SSE envelope synchronously so the client gets a
    // message_start before any awaitable work resolves.
    writeFrame("message_start", {
      type: "message_start",
      message: {
        id: `msg-${Date.now().toString(36)}`,
        type: "message",
        role: "assistant",
        content: [],
        model: aggregateModel,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });

    function onUpstreamEvent(event: StreamEvent): void {
      if (event.type === "content_block_start") {
        const cb = event.content_block;
        if (cb.type === "tool_use") {
          // Hide raw tool_use deltas from the client; emit a
          // synthetic event the UI can render as a progress chip.
          // Closes the active text block first so the chip lands
          // between text spans rather than inside one.
          closeTextBlock();
          writeFrame("tool_call_start", {
            type: "tool_call_start",
            name: cb.name,
          });
        } else if (cb.type === "text") {
          ensureTextBlockOpen();
        }
        // thinking blocks: not surfaced to the client; they ride
        // through the loop's internal message log only.
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          ensureTextBlockOpen();
          writeFrame("content_block_delta", {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: event.delta.text },
          });
          aggregatedText += event.delta.text;
        }
        // input_json_delta + thinking_delta + signature_delta:
        // intentionally hidden from the client.
      }
      // message_start/stop/delta are NOT forwarded — they're
      // synthesized once at the envelope level.
    }

    const responsePromise = (async () => {
      try {
        // History compression safety net (Phase 12E) lives inside
        // the response promise so a compressor failure folds into
        // the same error path that closes the stream cleanly.
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
          caller: defaultStreamingAnthropicCaller({
            apiKey,
            onEvent: onUpstreamEvent,
          }),
          model: aggregateModel,
          systemPrompt: TOOL_PATH_SYSTEM_PROMPT,
          messages,
          registry,
          ctx,
          maxIterations: 8,
          signal: abort.signal,
        });

        // If the loop bailed at maxIterations the model never wrote
        // a terminal text block — emit a synthesized truncation
        // surface so the client isn't left with a half-finished
        // chip-only stream.
        if (result.truncated) {
          appendSyntheticText(formatTruncationSurface(result));
        }

        closeTextBlock();
        writeFrame("message_delta", {
          type: "message_delta",
          delta: { stop_reason: result.truncated ? "max_tokens" : "end_turn" },
          usage: { input_tokens: 0, output_tokens: 0 },
        });
        writeFrame("message_stop", { type: "message_stop" });

        // Phase 19.2 — engineer-channel writeback fires off the
        // aggregated text after the stream closes. Failures never
        // affect the client response.
        const finalText = aggregatedText || result.finalText;
        const engineerMessages = extractEngineerMessages(finalText);
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
      } catch (err) {
        // Surface mid-stream errors as a final SSE event the client
        // can render. Don't 500 the whole response — by this point
        // the headers are already sent.
        const message = err instanceof Error ? err.message : String(err);
        appendSyntheticText(`\n\n[error] ${message}`);
        closeTextBlock();
        writeFrame("message_stop", { type: "message_stop" });
      } finally {
        clearTimeout(timeoutHandle);
        try {
          await writer.close();
        } catch {
          // already closed (client disconnect / abort)
        }
      }
    })();

    // Don't await responsePromise — the stream returns immediately
    // and the loop continues to write to it asynchronously.
    void responsePromise;

    return new Response(readable, {
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
