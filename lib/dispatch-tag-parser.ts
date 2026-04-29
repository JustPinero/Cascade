/**
 * Parser for the [DISPATCH] text tags the Overseer emits in chat
 * output. The dashboard renders Execute Sprint buttons from the
 * extracted actions; the Overseer's system prompt tells the model
 * to emit this exact format. Co-located here (Phase 14.6) so a
 * single test can verify both ends agree.
 */

export interface ParsedDispatchAction {
  project: string;
  action: "continue" | "audit" | "investigate" | "custom";
  prompt: string;
}

/**
 * The format documented in TOOL_PATH_SYSTEM_PROMPT:
 *   [DISPATCH] project-slug: mode — optional instructions
 *   [DISPATCH] project-slug: mode - optional instructions  (hyphen also OK)
 *   [DISPATCH] project-slug: mode                          (instructions optional)
 */
const DISPATCH_REGEX =
  /\[DISPATCH\]\s*(\S+)\s*:\s*(continue|audit|investigate|custom)\s*(?:—|-)?\s*(.*)/gi;

export function extractDispatchActions(content: string): ParsedDispatchAction[] {
  const actions: ParsedDispatchAction[] = [];
  // Reset lastIndex defensively — the regex is global and module-shared.
  DISPATCH_REGEX.lastIndex = 0;
  let match;
  while ((match = DISPATCH_REGEX.exec(content)) !== null) {
    actions.push({
      project: match[1],
      action: match[2].toLowerCase() as ParsedDispatchAction["action"],
      prompt: match[3]?.trim() ?? "",
    });
  }
  return actions;
}
