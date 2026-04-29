/**
 * Phase 19.2 — extract `[ENGINEER]` messages Delamain emits in chat
 * output. Mirrors the dispatch-tag-parser pattern so the channel
 * writeback path is symmetric with the existing dispatch flow.
 *
 * The Overseer system prompt advertises that Del can emit
 * `[ENGINEER] message text` to send notes to Kilroy. Without this
 * parser + the route's writeback (also Phase 19.2), those messages
 * stay buried in ChatMessage rows.
 *
 * Limitation: regex-based, not markdown-aware. A `[ENGINEER]` tag
 * inside a code block WILL be extracted. Acceptable for current
 * scope — Del controls the output and won't intentionally embed.
 */

const ENGINEER_REGEX = /\[ENGINEER\][^\n]*/gi;

export function extractEngineerMessages(content: string): string[] {
  // Reset lastIndex defensively — the regex is global and module-shared.
  ENGINEER_REGEX.lastIndex = 0;
  const messages: string[] = [];
  let match;
  while ((match = ENGINEER_REGEX.exec(content)) !== null) {
    const body = match[0].replace(/^\[ENGINEER\]/i, "").trim();
    if (body.length > 0) {
      messages.push(body);
    }
  }
  return messages;
}
