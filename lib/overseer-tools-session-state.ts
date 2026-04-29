import type { Tool } from "@/lib/overseer-tools";
import { readWorkingMemory } from "@/lib/chat-session";

type SessionStateInput = Record<string, never>;

interface SessionStateOutput {
  sessionId: string;
  activeFlow: string | null;
  workingMemory: Record<string, unknown>;
}

/**
 * get_session_state is read-only and INTENTIONALLY succeeds even when
 * the session has been closed (Phase 15). The write tools
 * (update_session_memory, set_active_flow) reject closed sessions via
 * `assertOpen` because writing to a closed session is a contract
 * violation. Reading is always safe — historical archeology of a
 * closed session is a legitimate use case (e.g. a follow-up
 * conversation that wants to inspect what was decided yesterday).
 */
export const sessionStateTool: Tool<SessionStateInput, SessionStateOutput> = {
  name: "get_session_state",
  description:
    "Get the canonical state of THIS conversation — the activeFlow you set and everything you've recorded via update_session_memory. Use this when you need to recall what's been confirmed earlier in the session before answering. Replaces 'I think you told me earlier...' guesswork.",
  inputSchema: {
    type: "object",
    properties: {},
  },
  handler: async (_input, ctx) => {
    if (!ctx.sessionId) {
      throw new Error(
        "get_session_state requires ctx.sessionId; route did not bind a session"
      );
    }
    const session = await ctx.prisma.chatSession.findUnique({
      where: { id: ctx.sessionId },
    });
    if (!session) {
      throw new Error(`ChatSession ${ctx.sessionId} not found`);
    }
    // Note: we do NOT check session.closedAt here. See module docstring above.
    const workingMemory = await readWorkingMemory(ctx.prisma, ctx.sessionId);
    return {
      sessionId: ctx.sessionId,
      activeFlow: session.activeFlow,
      workingMemory,
    };
  },
};
