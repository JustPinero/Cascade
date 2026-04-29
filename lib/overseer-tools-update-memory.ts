import type { Tool } from "@/lib/overseer-tools";
import { mergeWorkingMemory } from "@/lib/chat-session";

interface UpdateMemoryInput {
  patch: Record<string, unknown>;
}

interface UpdateMemoryOutput {
  newState: Record<string, unknown>;
}

export const updateSessionMemoryTool: Tool<
  UpdateMemoryInput,
  UpdateMemoryOutput
> = {
  name: "update_session_memory",
  description:
    "Record a structured fact you've confirmed with the developer this session — for example a project's progress, a blocker, a decision. Patch is deep-merged into the session's working memory; subsequent turns will see the merged state via get_session_state. Use this aggressively during inventory walks so confirmed answers don't get lost in conversation history.",
  inputSchema: {
    type: "object",
    properties: {
      patch: {
        type: "object",
        description:
          "Structured fragment to merge into working memory. Nested objects merge recursively; arrays and primitives overwrite. Examples: {covered: {medipal: {progress: 40, blocker: 'auth tests flaky'}}}, {decisions: ['ship phase-12B before next standup']}.",
      },
    },
    required: ["patch"],
  },
  handler: async (input, ctx) => {
    if (!ctx.sessionId) {
      throw new Error(
        "update_session_memory requires ctx.sessionId; route did not bind a session"
      );
    }
    const newState = await mergeWorkingMemory(ctx.prisma, ctx.sessionId, input.patch);
    return { newState };
  },
};
