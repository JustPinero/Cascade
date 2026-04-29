import type { Tool } from "@/lib/overseer-tools";
import { readWorkingMemory } from "@/lib/chat-session";

type SessionStateInput = Record<string, never>;

interface SessionStateOutput {
  sessionId: string;
  activeFlow: string | null;
  workingMemory: Record<string, unknown>;
}

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
    const workingMemory = await readWorkingMemory(ctx.prisma, ctx.sessionId);
    return {
      sessionId: ctx.sessionId,
      activeFlow: session.activeFlow,
      workingMemory,
    };
  },
};
