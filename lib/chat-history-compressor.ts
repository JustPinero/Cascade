import type { PrismaClient } from "@/app/generated/prisma/client";
import type { AnthropicMessage } from "@/lib/overseer-tools";

/**
 * Phase 12E — history compression safety net.
 *
 * Once a conversation exceeds the threshold, summarize the older
 * portion into one synthetic message and keep the most recent N
 * turns verbatim. The summary is cached on ChatSession so we don't
 * re-summarize the same content every turn.
 *
 * This is a SAFETY NET — the primary mechanism for "what was decided
 * earlier?" is workingMemory + get_session_state. Compression just
 * keeps the raw message log under control on extremely long sessions.
 */

export interface CompressorOptions {
  /** Threshold: compress only when messages.length exceeds this. */
  threshold: number;
  /** How many recent messages to keep verbatim. */
  keepRecent: number;
  /** Summarizer; receives the older portion and returns a string. */
  summarizer: MessageSummarizer;
  /** Optional abort signal forwarded to the summarizer. */
  signal?: AbortSignal;
}

export type MessageSummarizer = (
  messages: AnthropicMessage[],
  options?: { signal?: AbortSignal }
) => Promise<string>;

interface CachedSummary {
  summarizedThroughMessageCount: number;
  summary: string;
}

function parseCachedSummary(raw: string | null): CachedSummary | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.summarizedThroughMessageCount === "number" &&
      typeof parsed.summary === "string"
    ) {
      return parsed as CachedSummary;
    }
    return null;
  } catch {
    return null;
  }
}

function formatSummaryAsMessage(summary: string): AnthropicMessage {
  return {
    role: "user",
    content: `[Earlier conversation summary — older turns compressed for context window control]\n\n${summary}`,
  };
}

/**
 * Phase 14.2 — fallback synthetic message when the summarizer fails.
 * Compression is a SAFETY NET; it must not become a failure mode.
 * If Haiku is down, drop the older portion silently with a notice
 * rather than 500-ing the whole conversation.
 */
function formatTruncationNotice(droppedCount: number): AnthropicMessage {
  return {
    role: "user",
    content: `[Earlier conversation truncated — ${droppedCount} older turns dropped because the summarizer was unavailable. workingMemory remains the source of truth for confirmed facts.]`,
  };
}

/**
 * Returns a possibly-compressed message array. If the input is at or
 * below the threshold, returns it unchanged. Otherwise, returns
 * `[summary message, ...last N recent messages]`. Caches the summary
 * on the session so subsequent calls reuse it instead of re-summarizing.
 */
export async function compressMessagesForSession(
  prisma: PrismaClient,
  sessionId: string,
  messages: AnthropicMessage[],
  opts: CompressorOptions
): Promise<AnthropicMessage[]> {
  if (messages.length <= opts.threshold) return messages;

  const cutoff = messages.length - opts.keepRecent;
  const olderMessages = messages.slice(0, cutoff);
  const recentMessages = messages.slice(cutoff);

  const session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
  if (!session) {
    throw new Error(`ChatSession ${sessionId} not found`);
  }

  const cached = parseCachedSummary(session.compressedHistory);
  if (cached && cached.summarizedThroughMessageCount === olderMessages.length) {
    return [formatSummaryAsMessage(cached.summary), ...recentMessages];
  }

  // Phase 14.2 — summarizer failure must not cascade into a 500.
  // Fall back to raw truncation with a notice; conversation continues.
  let summary: string;
  try {
    summary = await opts.summarizer(olderMessages, { signal: opts.signal });
  } catch (err) {
    if (process.env.NODE_ENV !== "test") {
      console.warn(
        `[compressor] summarizer failed; falling back to raw truncation: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
    return [formatTruncationNotice(olderMessages.length), ...recentMessages];
  }

  // Phase 14.4 — wrap the cache update in $transaction so two parallel
  // requests can't overwrite each other's compressedHistory writes.
  await prisma.$transaction(async (tx) => {
    await tx.chatSession.update({
      where: { id: sessionId },
      data: {
        compressedHistory: JSON.stringify({
          summarizedThroughMessageCount: olderMessages.length,
          summary,
        }),
      },
    });
  });

  return [formatSummaryAsMessage(summary), ...recentMessages];
}

/**
 * Default summarizer — calls Claude Haiku via the Anthropic Messages
 * API. Returns the model's text output as the summary.
 */
export function defaultSummarizer(apiKey: string): MessageSummarizer {
  return async (messages, options) => {
    const transcript = messages
      .map((m) => {
        const role = m.role.toUpperCase();
        const content =
          typeof m.content === "string"
            ? m.content
            : m.content.map((b) => ("text" in b ? b.text : "[non-text block]")).join("");
        return `${role}: ${content}`;
      })
      .join("\n\n");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        system:
          "You summarize the older portion of an Overseer (Delamain) conversation into a compact briefing. Preserve: confirmed project states, decisions, blockers raised, dispatch proposals. Drop: greetings, repeated questions, conversational filler. Output a single paragraph in past tense — '...the developer confirmed... I proposed... we deferred...'.",
        messages: [
          { role: "user", content: `Conversation to summarize:\n\n${transcript}` },
        ],
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      throw new Error(`Summarizer API error: ${response.status}`);
    }
    const json = await response.json();
    const content = (json.content as Array<{ type: string; text?: string }>) ?? [];
    return content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
  };
}
