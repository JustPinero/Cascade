import type { Tool } from "@/lib/overseer-tools";
import { setActiveFlow } from "@/lib/chat-session";

const VALID_FLOWS = ["inventory_walk", "dispatch_planning", "incident_triage"] as const;
type ValidFlow = (typeof VALID_FLOWS)[number];

interface SetFlowInput {
  flow: ValidFlow | null;
}

interface SetFlowOutput {
  flow: ValidFlow | null;
}

export const setActiveFlowTool: Tool<SetFlowInput, SetFlowOutput> = {
  name: "set_active_flow",
  description:
    "Declare what kind of conversation you're in. Use 'inventory_walk' when visiting each project to confirm state. 'dispatch_planning' once you're translating confirmed state into a dispatch plan. 'incident_triage' when investigating a single blocker deeply. Pass null to clear (back to free chat). Setting a flow is a hint to yourself for subsequent turns; nothing breaks if you forget.",
  inputSchema: {
    type: "object",
    properties: {
      flow: {
        type: ["string", "null"],
        enum: ["inventory_walk", "dispatch_planning", "incident_triage", null],
        description: "The active flow, or null to clear.",
      },
    },
    required: ["flow"],
  },
  handler: async (input, ctx) => {
    if (!ctx.sessionId) {
      throw new Error(
        "set_active_flow requires ctx.sessionId; route did not bind a session"
      );
    }
    if (input.flow !== null && !VALID_FLOWS.includes(input.flow)) {
      throw new Error(
        `Unknown flow "${input.flow}". Valid: ${VALID_FLOWS.join(", ")} or null.`
      );
    }
    await setActiveFlow(ctx.prisma, ctx.sessionId, input.flow);
    return { flow: input.flow };
  },
};
