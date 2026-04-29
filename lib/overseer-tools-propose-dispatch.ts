import type { Tool } from "@/lib/overseer-tools";
import { mergeWorkingMemory } from "@/lib/chat-session";

const VALID_MODES = ["continue", "audit", "investigate", "custom"] as const;
type DispatchMode = (typeof VALID_MODES)[number];

interface ProposeDispatchInput {
  slug: string;
  mode: DispatchMode;
  instructions?: string;
}

interface DispatchProposal {
  slug: string;
  mode: DispatchMode;
  instructions?: string;
  proposedAtISO: string;
}

interface ProposeDispatchOutput {
  proposal: DispatchProposal;
  totalProposed: number;
}

export const proposeDispatchTool: Tool<ProposeDispatchInput, ProposeDispatchOutput> = {
  name: "propose_dispatch",
  description:
    "Record a proposed dispatch in this session's working memory. Use this whenever you'd otherwise emit a [DISPATCH] tag — it's the structured equivalent. The user reviews proposals and explicitly executes them; nothing is dispatched until they click Execute Sprint.",
  inputSchema: {
    type: "object",
    properties: {
      slug: {
        type: "string",
        description: "Lowercase, hyphenated project slug.",
      },
      mode: {
        type: "string",
        enum: ["continue", "audit", "investigate", "custom"],
        description: "Dispatch mode.",
      },
      instructions: {
        type: "string",
        description:
          "Optional free-text guidance for the dispatched session (e.g. 'focus on finishing the auth tests').",
      },
    },
    required: ["slug", "mode"],
  },
  handler: async (input, ctx) => {
    if (!ctx.sessionId) {
      throw new Error(
        "propose_dispatch requires ctx.sessionId; route did not bind a session"
      );
    }
    if (!VALID_MODES.includes(input.mode)) {
      throw new Error(
        `Unknown mode "${input.mode}". Valid: ${VALID_MODES.join(", ")}.`
      );
    }
    const proposal: DispatchProposal = {
      slug: input.slug,
      mode: input.mode,
      proposedAtISO: new Date().toISOString(),
    };
    if (input.instructions) proposal.instructions = input.instructions;

    const session = await ctx.prisma.chatSession.findUnique({
      where: { id: ctx.sessionId },
    });
    const existing = session
      ? (() => {
          try {
            const wm = JSON.parse(session.workingMemory) as Record<string, unknown>;
            const list = wm.proposedDispatches;
            return Array.isArray(list) ? (list as DispatchProposal[]) : [];
          } catch {
            return [];
          }
        })()
      : [];

    const newList = [...existing, proposal];
    await mergeWorkingMemory(ctx.prisma, ctx.sessionId, {
      proposedDispatches: newList,
    });

    return { proposal, totalProposed: newList.length };
  },
};
